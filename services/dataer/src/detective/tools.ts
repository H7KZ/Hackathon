/**
 * Read-only SQL tool for the blind detective (SPEC §3.E).
 * SECURITY BOUNDARY = the sandbox database (store/duckdb.ts `exportSandbox` + `openSandbox`):
 * it contains only schema `main`, is read-only, has external access disabled and config locked.
 * `guardSql` is only a friendly pre-check that gives the LLM actionable messages.
 */
import type { Row } from "@s2d/schema/run";
import type { Store } from "../store/duckdb";

export const DETECTIVE_ROW_LIMIT = 200;

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

export function guardSql(sql: string): GuardResult {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (trimmed.length === 0) return { ok: false, reason: "Empty query." };
  if (trimmed.includes(";")) return { ok: false, reason: "Only one statement is allowed." };
  if (!/^(select|with|from|describe|show)\b/i.test(trimmed)) {
    return { ok: false, reason: "Only read queries (SELECT / WITH / DESCRIBE / SHOW) are allowed." };
  }
  return { ok: true, sql: trimmed };
}

/** Runs a detective query on a SANDBOX store; returns rows (max DETECTIVE_ROW_LIMIT) or an error message. */
export async function runDetectiveSql(
  sandbox: Store,
  sql: string,
): Promise<{ ok: true; rows: Row[]; truncated: boolean } | { ok: false; error: string }> {
  const guard = guardSql(sql);
  if (!guard.ok) return { ok: false, error: guard.reason };
  try {
    const rows = await sandbox.query(guard.sql, { maxRows: DETECTIVE_ROW_LIMIT + 1 });
    return {
      ok: true,
      rows: rows.slice(0, DETECTIVE_ROW_LIMIT),
      truncated: rows.length > DETECTIVE_ROW_LIMIT,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
