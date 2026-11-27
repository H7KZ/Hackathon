/** Metrics of a finished run for comparing two runs (SPEC §3.F). Both databases are opened READ-ONLY. */
import { existsSync } from "node:fs";
import type { MetricDiff } from "@s2d/schema/evidence";
import { openStore, type Store } from "../store/duckdb";
import { isKeyColumn, isNumericType, mainTables, quoteIdent } from "../store/columns";
import { diffMetrics } from "./diff";

/** `<table>.rows` for every observed table, `<table>.<column>.sum` for numeric non-key columns. */
export async function collectMetrics(store: Store): Promise<Record<string, number>> {
  const metrics: Record<string, number> = {};
  for (const { table, columns } of await mainTables(store)) {
    const numeric = columns.filter((c) => isNumericType(c.type) && !isKeyColumn(c.name));
    const sums = numeric.map((c, i) => `, COALESCE(SUM(${quoteIdent(c.name)}), 0)::DOUBLE AS m${i}`);
    const [row] = await store.query(
      `SELECT count(*)::DOUBLE AS n${sums.join("")} FROM main.${quoteIdent(table)}`,
    );
    metrics[`${table}.rows`] = Number(row?.n ?? 0);
    numeric.forEach((c, i) => (metrics[`${table}.${c.name}.sum`] = Number(row?.[`m${i}`] ?? 0)));
  }
  return metrics;
}

async function metricsOf(path: string): Promise<Record<string, number>> {
  if (!existsSync(path)) throw new Error(`No database at ${path}`);
  const store = await openStore(path, { readOnly: true });
  try {
    return await collectMetrics(store);
  } finally {
    store.close();
  }
}

export async function compareRuns(dbPathA: string, dbPathB: string): Promise<MetricDiff[]> {
  return diffMetrics(await metricsOf(dbPathA), await metricsOf(dbPathB));
}
