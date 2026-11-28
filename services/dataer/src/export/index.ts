/**
 * Dataset downloads for the UI: the observed tables (schema `main`) only, never `truth` (the answer
 * key stays out of every export). CSV and Parquet are written by DuckDB and zipped; xlsx is built
 * here (one sheet per table); "duckdb" is the sandbox copy.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exportSandbox, openStore, type Store } from "../store/duckdb";
import { isNumericType, mainTables, quoteIdent } from "../store/columns";
import { xlsx } from "./xlsx";
import { zip } from "./zip";

export const EXPORT_FORMATS = ["csv", "parquet", "xlsx", "duckdb"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportResult = { file: string; filename: string; contentType: string };

const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

async function withStore<T>(dbPath: string, fn: (s: Store) => Promise<T>): Promise<T> {
  const store = await openStore(dbPath, { readOnly: true });
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}

/** Writes the export into `outDir` (created, reused) and returns the file to send. */
export async function exportDataset(
  dbPath: string,
  format: ExportFormat,
  outDir: string,
): Promise<ExportResult> {
  mkdirSync(outDir, { recursive: true });
  if (format === "duckdb") {
    const file = join(outDir, "dataset.duckdb");
    await exportSandbox(dbPath, file);
    return { file, filename: "dataset.duckdb", contentType: "application/octet-stream" };
  }
  if (format === "xlsx") {
    const sheets = await withStore(dbPath, async (s) => {
      const out = [];
      for (const t of await mainTables(s)) {
        const rows = await s.query(`SELECT * FROM main.${quoteIdent(t.table)}`);
        const numeric = new Set(t.columns.filter((c) => isNumericType(c.type)).map((c) => c.name));
        out.push({ name: t.table, columns: t.columns.map((c) => c.name), numeric, rows });
      }
      return out;
    });
    const file = join(outDir, "dataset.xlsx");
    writeFileSync(file, xlsx(sheets));
    return {
      file,
      filename: "dataset.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }
  const ext = format === "csv" ? "csv" : "parquet";
  const tmp = join(outDir, `${ext}-parts`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const names = await withStore(dbPath, async (s) => {
    const tables = await mainTables(s);
    for (const t of tables) {
      const target = quoteLiteral(join(tmp, `${t.table}.${ext}`).replaceAll("\\", "/"));
      const opts = format === "csv" ? "(HEADER, DELIMITER ',')" : "(FORMAT parquet)";
      await s.conn.run(`COPY (SELECT * FROM main.${quoteIdent(t.table)}) TO ${target} ${opts}`);
    }
    return tables.map((t) => `${t.table}.${ext}`);
  });
  const file = join(outDir, `dataset-${ext}.zip`);
  writeFileSync(file, zip(names.map((name) => ({ name, data: readFileSync(join(tmp, name)) }))));
  rmSync(tmp, { recursive: true, force: true });
  return { file, filename: `dataset-${ext}.zip`, contentType: "application/zip" };
}
