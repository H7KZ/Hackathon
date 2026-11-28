/**
 * DuckDB persistence. Layout (SPEC §3.C):
 *   main.<table>  observed data (what analysts & the detective see)
 *   truth.<table> ground truth + truth.run_meta + truth.story_points
 *
 * Evidence and the detective must query a SANDBOX (`exportSandbox` + `openSandbox`): a separate file
 * holding only `main`, opened read-only with external access disabled and configuration locked.
 * A keyword blocklist on SQL text is not a security boundary.
 */
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { GeneratedTable, Row, RunResult } from "@s2d/schema/run";

export interface Store {
  conn: DuckDBConnection;
  /** Runs SQL and returns rows as JSON-safe objects; `maxRows` truncates the result. */
  query(sql: string, opts?: { maxRows?: number }): Promise<Row[]>;
  close(): void;
}

async function open(path: string, config: Record<string, string>): Promise<Store> {
  const instance = await DuckDBInstance.create(path, config);
  const conn = await instance.connect();
  return {
    conn,
    async query(sql, opts = {}) {
      const reader = await conn.runAndReadAll(sql);
      const rows = reader.getRowObjectsJson() as Row[];
      return opts.maxRows === undefined ? rows : rows.slice(0, opts.maxRows);
    },
    close() {
      conn.closeSync();
      instance.closeSync();
    },
  };
}

export async function openStore(path: string, opts: { readOnly?: boolean } = {}): Promise<Store> {
  if (!opts.readOnly && path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  return open(path, opts.readOnly ? { access_mode: "READ_ONLY" } : {});
}

/**
 * Read-only, no file/network access, configuration locked. Use for evidence and the detective.
 * Single-threaded: LLM SQL often has GROUP BY / string_agg without ORDER BY, whose row order varies with
 * threads; the detective's next prompt contains those rows, so a varying order broke the offline replay.
 */
export function openSandbox(path: string): Promise<Store> {
  return open(path, {
    access_mode: "READ_ONLY",
    enable_external_access: "false",
    threads: "1",
    lock_configuration: "true",
  });
}

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;
const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Loads rows via a temp NDJSON file so DuckDB infers column types (incl. DATE from ISO strings). */
async function writeTable(
  conn: DuckDBConnection,
  schema: string,
  table: GeneratedTable,
  tmp: string,
): Promise<void> {
  const target = `${schema}.${quoteIdent(table.name)}`;
  if (table.rows.length === 0) {
    const cols = table.columns?.length ? table.columns : ["id"];
    await conn.run(`CREATE TABLE ${target} (${cols.map((c) => `${quoteIdent(c)} VARCHAR`).join(", ")})`);
    return;
  }
  const file = join(tmp, `${schema}-${table.name}.ndjson`);
  writeFileSync(file, table.rows.map((r) => JSON.stringify(r)).join("\n"));
  await conn.run(
    `CREATE TABLE ${target} AS SELECT * FROM read_json(${quoteLiteral(file.replaceAll("\\", "/"))}, format = 'newline_delimited', sample_size = -1)`,
  );
}

/** Tables with the same name and visibility (e.g. two processes writing `complaint`) are concatenated. */
export function mergeTables(tables: readonly GeneratedTable[]): GeneratedTable[] {
  const merged = new Map<string, GeneratedTable>();
  for (const t of tables) {
    const key = `${t.visibility}:${t.name}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...t, rows: [...t.rows] });
    } else {
      prev.rows.push(...t.rows);
      if (t.columns) prev.columns = [...new Set([...(prev.columns ?? []), ...t.columns])];
    }
  }
  const names = new Map<string, string>();
  for (const t of merged.values()) {
    const other = names.get(t.name);
    if (other !== undefined && other !== t.visibility) {
      throw new Error(`Table "${t.name}" is both observed and ground_truth`);
    }
    names.set(t.name, t.visibility);
  }
  return [...merged.values()];
}

/** Persist one engine run into a fresh database file (an existing file is replaced). */
export async function writeRun(path: string, run: RunResult): Promise<void> {
  rmSync(path, { force: true });
  rmSync(`${path}.wal`, { force: true });
  const store = await openStore(path);
  const tmp = mkdtempSync(join(tmpdir(), "s2d-run-"));
  try {
    await store.conn.run("CREATE SCHEMA truth");
    for (const t of mergeTables(run.tables)) {
      await writeTable(store.conn, t.visibility === "observed" ? "main" : "truth", t, tmp);
    }
    await writeTable(
      store.conn,
      "truth",
      { name: "run_meta", visibility: "ground_truth", rows: [run.meta] },
      tmp,
    );
    await writeTable(
      store.conn,
      "truth",
      {
        name: "story_points",
        visibility: "ground_truth",
        columns: [
          "id",
          "phase",
          "title",
          "description",
          "entity_name",
          "entity_ids",
          "segment_field",
          "segment_values",
          "start",
          "end",
        ],
        rows: run.storyPoints.map((sp) => ({
          id: sp.id,
          phase: sp.phase,
          title: sp.title,
          description: sp.description,
          entity_name: sp.entity?.name ?? null,
          entity_ids: sp.entity?.ids.join(",") ?? null,
          segment_field: sp.segment?.field ?? null,
          // JSON: category values may contain commas
          segment_values: sp.segment ? JSON.stringify(sp.segment.values) : null,
          start: sp.start,
          end: sp.end ?? null,
        })),
      },
      tmp,
    );
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Copy only schema `main` of `srcPath` into a new file `destPath` (for evidence / detective). */
export async function exportSandbox(srcPath: string, destPath: string): Promise<void> {
  if (!existsSync(srcPath)) throw new Error(`No database at ${srcPath}`);
  rmSync(destPath, { force: true });
  const dest = await openStore(destPath);
  try {
    await dest.conn.run(`ATTACH ${quoteLiteral(srcPath.replaceAll("\\", "/"))} AS src (READ_ONLY)`);
    const tables = await dest.query(
      "SELECT table_name FROM duckdb_tables() WHERE database_name = 'src' AND schema_name = 'main'",
    );
    for (const { table_name } of tables) {
      const name = quoteIdent(String(table_name));
      await dest.conn.run(`CREATE TABLE main.${name} AS SELECT * FROM src.main.${name}`);
    }
    await dest.conn.run("DETACH src");
  } finally {
    dest.close();
  }
}
