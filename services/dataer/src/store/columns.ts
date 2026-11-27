/** Column metadata of the observed tables (schema `main`), read from DuckDB only. */
import type { Store } from "./duckdb";

export interface TableColumns {
  table: string;
  /** In ordinal order. */
  columns: { name: string; type: string }[];
}

export const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

export const isDateType = (type: string) => /^(DATE|TIMESTAMP)/i.test(type);
export const isNumericType = (type: string) =>
  /^(U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?|FLOAT|DOUBLE|REAL|DECIMAL)/i.test(type);
/** `id` and `*_id` are keys, not quantities: never summed. */
export const isKeyColumn = (name: string) => name === "id" || name.endsWith("_id");

/** Tables of schema `main` in the current database, sorted by name. */
export async function mainTables(store: Store): Promise<TableColumns[]> {
  const rows = await store.query(
    `SELECT table_name AS t, column_name AS c, data_type AS d FROM information_schema.columns
     WHERE table_catalog = current_database() AND table_schema = 'main'
     ORDER BY table_name, ordinal_position`,
  );
  const byTable = new Map<string, TableColumns>();
  for (const r of rows) {
    const table = String(r.t);
    const entry = byTable.get(table) ?? { table, columns: [] };
    entry.columns.push({ name: String(r.c), type: String(r.d) });
    byTable.set(table, entry);
  }
  return [...byTable.values()];
}
