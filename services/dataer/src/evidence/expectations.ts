/**
 * Evaluates expectations (SQL hypotheses) against DuckDB. Reads ONLY the database:
 * the scenario is never imported here (SPEC §2 rule 7, enforced by eslint + dependency-cruiser).
 * The SQL is LLM-written: always pass a SANDBOX store (`openSandbox`), never the full run database.
 */
import type { Expectation, ExpectationCheck, ExpectationResult } from "@s2d/schema/evidence";
import type { Row } from "@s2d/schema/run";
import type { Store } from "../store/duckdb";

/**
 * Pure decision on before/after values. A zero baseline never passes increase/decrease: relative change
 * is undefined, so the expectation must pick a window where the metric is non-zero before the story.
 */
export function judge(
  before: number,
  after: number,
  check: ExpectationCheck,
): { pass: boolean; relChange: number | null } {
  const relChange = before === 0 ? (after === 0 ? 0 : null) : (after - before) / Math.abs(before);
  switch (check.kind) {
    case "increase":
      return { pass: before !== 0 && relChange !== null && relChange >= check.minRelChange, relChange };
    case "decrease":
      return { pass: relChange !== null && -relChange >= check.minRelChange, relChange };
    case "stable":
      return { pass: relChange !== null && Math.abs(relChange) < check.minRelChange, relChange };
  }
}

export function pickPeriods(rows: Row[]): { before: number; after: number } | { error: string } {
  const get = (p: string) => {
    const row = rows.find((r) => r.period === p);
    const v = row?.value;
    if (v === undefined || v === null || v === "" || typeof v === "boolean") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const before = get("before");
  const after = get("after");
  if (before === undefined || after === undefined) {
    return {
      error:
        "SQL must return rows with period 'before' and 'after' and a finite numeric value (use COALESCE for NULL)",
    };
  }
  return { before, after };
}

export async function runExpectations(
  store: Store,
  expectations: Expectation[],
): Promise<ExpectationResult[]> {
  const results: ExpectationResult[] = [];
  for (const e of expectations) {
    try {
      const periods = pickPeriods(await store.query(e.sql));
      if ("error" in periods) {
        results.push({
          id: e.id,
          pass: false,
          before: null,
          after: null,
          relChange: null,
          error: periods.error,
        });
        continue;
      }
      const verdict = judge(periods.before, periods.after, e.check);
      results.push({ id: e.id, ...periods, ...verdict });
    } catch (err) {
      results.push({ id: e.id, pass: false, before: null, after: null, relChange: null, error: String(err) });
    }
  }
  return results;
}
