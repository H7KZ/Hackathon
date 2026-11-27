/**
 * Referential integrity after a run is written (AGENTS.md rule 4).
 *
 * `RunResult` carries no FK metadata and FK names do not map 1:1 to tables (`home_store_id` -> store,
 * `attempt_id` -> purchase_attempt), so FKs are inferred BY VALUE: every `*_id` column (main + truth,
 * except the bookkeeping tables) must point at exactly one table that has an `id` column. The target is
 * the table holding most of the column's values; values outside it are dangling. NULLs are allowed
 * (noise `missing`).
 */
import type { RunResult } from "@s2d/schema/run";
import { openStore, writeRun, type Store } from "./duckdb";

export interface FkViolation {
  table: string;
  column: string;
  /** Inferred target table, or null when no value resolves anywhere. */
  target: string | null;
  dangling: number;
  /** Up to 5 dangling values, sorted. */
  examples: string[];
}

const MAX_EXAMPLES = 5;
const BOOKKEEPING = new Set(["truth.run_meta", "truth.story_points"]);
const q = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Every inferred FK column with its target (dangling = 0 when it resolves fully). */
export async function inferForeignKeys(store: Store): Promise<FkViolation[]> {
  const cols = (
    await store.query(
      `SELECT table_schema AS s, table_name AS t, column_name AS c FROM information_schema.columns
       WHERE table_catalog = current_database() AND table_schema IN ('main', 'truth')
       ORDER BY table_schema, table_name, ordinal_position`,
    )
  )
    .map((r) => ({ s: String(r.s), t: String(r.t), c: String(r.c) }))
    .filter((r) => !BOOKKEEPING.has(`${r.s}.${r.t}`));

  const idTables = cols.filter((r) => r.c === "id");
  const fkCols = cols.filter((r) => r.c.endsWith("_id"));
  if (fkCols.length === 0) return [];
  // no table with an `id` column: every non-NULL FK value is dangling
  const idsSql = idTables.length
    ? idTables
        .map((r) => `SELECT DISTINCT CAST(id AS VARCHAR) AS id, '${r.t}' AS tbl FROM ${q(r.s)}.${q(r.t)}`)
        .join(" UNION ALL ")
    : "SELECT NULL::VARCHAR AS id, NULL::VARCHAR AS tbl WHERE false";

  const fks: FkViolation[] = [];
  for (const fk of fkCols) {
    const rows = await store.query(
      `WITH ids AS (${idsSql}),
            vals AS (SELECT DISTINCT CAST(${q(fk.c)} AS VARCHAR) AS v FROM ${q(fk.s)}.${q(fk.t)}
                     WHERE ${q(fk.c)} IS NOT NULL)
       SELECT v, list(tbl ORDER BY tbl) FILTER (WHERE tbl IS NOT NULL) AS targets
       FROM vals LEFT JOIN ids ON ids.id = vals.v GROUP BY v ORDER BY v`,
    );
    const values = rows.map((r) => ({
      v: String(r.v),
      targets: Array.isArray(r.targets) ? r.targets.map(String) : [],
    }));
    const votes = new Map<string, number>();
    for (const { targets } of values) for (const t of targets) votes.set(t, (votes.get(t) ?? 0) + 1);
    const target =
      [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    const dangling = values.filter((x) => target === null || !x.targets.includes(target)).map((x) => x.v);
    fks.push({
      table: fk.t,
      column: fk.c,
      target,
      dangling: dangling.length,
      examples: dangling.slice(0, MAX_EXAMPLES),
    });
  }
  return fks;
}

/** FK columns with at least one dangling value; [] means the run is referentially intact. */
export async function checkIntegrity(store: Store): Promise<FkViolation[]> {
  return (await inferForeignKeys(store)).filter((fk) => fk.dangling > 0);
}

export function formatViolations(violations: FkViolation[]): string {
  return violations
    .map(
      (v) =>
        `${v.table}.${v.column} -> ${v.target ?? "(no table)"}: ${v.dangling} dangling value(s), e.g. ${v.examples.join(", ")}`,
    )
    .join("\n");
}

/** writeRun + integrity check. Throws a readable error listing every dangling FK column. */
export async function storeRun(path: string, run: RunResult): Promise<void> {
  await writeRun(path, run);
  const store = await openStore(path, { readOnly: true });
  let violations: FkViolation[];
  try {
    violations = await checkIntegrity(store);
  } finally {
    store.close();
  }
  if (violations.length > 0) {
    throw new Error(`Referential integrity failed:\n${formatViolations(violations)}`);
  }
}
