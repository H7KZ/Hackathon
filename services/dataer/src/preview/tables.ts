/**
 * Table preview for the UI "Data" view: observed tables only (schema `main`), opened READ-ONLY.
 * The table name is matched against the catalog, never spliced into SQL as given.
 */
import { existsSync } from "node:fs";
import type { TableInfo, TablePreview } from "@s2d/schema/evidence";
import type { Row } from "@s2d/schema/run";
import { openStore, type Store } from "../store/duckdb";
import { isNumericType, mainTables, quoteIdent } from "../store/columns";

export const PREVIEW_MAX_ROWS = 200;

async function withStore<T>(dbPath: string, fn: (s: Store) => Promise<T>): Promise<T> {
  if (!existsSync(dbPath)) throw new Error(`No database at ${dbPath}`);
  const store = await openStore(dbPath, { readOnly: true });
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}

async function tablesOf(store: Store): Promise<TableInfo[]> {
  const out: TableInfo[] = [];
  for (const { table, columns } of await mainTables(store)) {
    const [row] = await store.query(`SELECT count(*)::DOUBLE AS n FROM main.${quoteIdent(table)}`);
    out.push({ name: table, rows: Number(row?.n ?? 0), columns });
  }
  return out;
}

export const listTables = (dbPath: string): Promise<TableInfo[]> => withStore(dbPath, tablesOf);

/** BIGINT/HUGEINT arrive as strings from DuckDB's JSON reader; safe integers become numbers again. */
function jsonSafe(row: Row, numeric: Set<string>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    const n = typeof v === "string" && numeric.has(k) ? Number(v) : NaN;
    out[k] = Number.isSafeInteger(n) ? n : v;
  }
  return out;
}

export function previewTable(dbPath: string, table: string, limit: number): Promise<TablePreview> {
  return withStore(dbPath, async (store) => {
    const info = (await tablesOf(store)).find((t) => t.name === table);
    if (!info) throw new Error(`Tabulka "${table}" neexistuje.`);
    const n = Math.min(PREVIEW_MAX_ROWS, Math.max(1, Math.floor(limit) || 1));
    const order = info.columns.some((c) => c.name === "id") ? ` ORDER BY ${quoteIdent("id")}` : "";
    const rows = await store.query(`SELECT * FROM main.${quoteIdent(info.name)}${order} LIMIT ${String(n)}`);
    const numeric = new Set(info.columns.filter((c) => isNumericType(c.type)).map((c) => c.name));
    return { ...info, rowsShown: rows.map((r) => jsonSafe(r, numeric)) };
  });
}
