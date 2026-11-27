/**
 * Standard daily series for the UI (no LLM SQL involved). Reads ONLY DuckDB schema `main`.
 *
 * For every observed table and every DATE/TIMESTAMP column: a row count per day (`metric: "rows"`) and
 * a per-day sum of every numeric non-key column (`metric: "<col>.sum"`). Row counts alone are flat for
 * snapshot tables like stock_daily, where the story is in the values. Days between the first and last
 * date are zero-filled; NULL dates are skipped, NULL values sum as 0.
 */
import type { Store } from "../store/duckdb";
import { isDateType, isKeyColumn, isNumericType, mainTables, quoteIdent } from "../store/columns";

export interface DailySeries {
  table: string;
  dateColumn: string;
  /** "rows" or "<column>.sum". */
  metric: string;
  points: { day: string; value: number }[];
}

const DAY_MS = 86_400_000;

function allDays(first: string, last: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(first); t <= Date.parse(last); t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

export async function dailySeries(store: Store): Promise<DailySeries[]> {
  const out: DailySeries[] = [];
  for (const { table, columns } of await mainTables(store)) {
    const numeric = columns.filter((c) => isNumericType(c.type) && !isKeyColumn(c.name));
    for (const date of columns.filter((c) => isDateType(c.type))) {
      const d = quoteIdent(date.name);
      const sums = numeric.map((c, i) => `COALESCE(SUM(${quoteIdent(c.name)}), 0)::DOUBLE AS m${i}`);
      const rows = await store.query(
        `SELECT CAST(CAST(${d} AS DATE) AS VARCHAR) AS day, count(*)::DOUBLE AS m_rows
         ${sums.map((s) => `, ${s}`).join("")}
         FROM main.${quoteIdent(table)} WHERE ${d} IS NOT NULL GROUP BY 1 ORDER BY 1`,
      );
      const first = rows[0];
      const last = rows.at(-1);
      if (!first || !last) continue;
      const byDay = new Map(rows.map((r) => [String(r.day), r]));
      const days = allDays(String(first.day), String(last.day));
      const series = (metric: string, key: string): DailySeries => ({
        table,
        dateColumn: date.name,
        metric,
        points: days.map((day) => ({ day, value: Number(byDay.get(day)?.[key] ?? 0) })),
      });
      out.push(series("rows", "m_rows"), ...numeric.map((c, i) => series(`${c.name}.sum`, `m${i}`)));
    }
  }
  return out;
}
