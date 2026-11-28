/**
 * Ground truth for SCORING the detective. Reads the FULL run database (schema `truth`), so it must never
 * be reachable from the LLM's SQL path: the detective loop only ever gets a sandbox.
 */
import { z } from "zod";
import { TruthPoint } from "@s2d/schema/detective";
import { openStore } from "./duckdb";

/**
 * Only FINDABLE story points count: phase >= 1 (phase 0 is the "normal operation" baseline, not an
 * event) and with at least one entity id or segment value (a finding matches by naming one). Live run #2
 * had a baseline point in the answer key, which capped recall at 2/3. Databases written before the
 * segment columns existed have no `segment_values`; they are read without it.
 */
export async function readTruthPoints(dbPath: string): Promise<TruthPoint[]> {
  const store = await openStore(dbPath, { readOnly: true });
  try {
    const cols = await store.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'truth' AND table_name = 'story_points'",
    );
    const seg = cols.some((c) => c.column_name === "segment_values")
      ? "CAST(segment_values AS VARCHAR)"
      : "CAST(NULL AS VARCHAR)";
    const rows = await store.query(
      `SELECT * FROM (
         SELECT CAST(id AS VARCHAR) AS id, CAST(entity_ids AS VARCHAR) AS entity_ids,
                ${seg} AS segment_values, CAST(CAST(start AS DATE) AS VARCHAR) AS start,
                TRY_CAST(phase AS INTEGER) AS phase
         FROM truth.story_points)
       WHERE phase >= 1 AND (coalesce(entity_ids, '') <> '' OR coalesce(segment_values, '') <> '')
       ORDER BY id`,
    );
    return z.array(TruthPoint).parse(
      rows.map((r) => {
        const values = parseValues(r.segment_values);
        return {
          id: r.id,
          entityIds: typeof r.entity_ids === "string" && r.entity_ids !== "" ? r.entity_ids.split(",") : [],
          ...(values.length > 0 ? { segmentValues: values } : {}),
          start: r.start,
        };
      }),
    );
  } finally {
    store.close();
  }
}

function parseValues(raw: unknown): string[] {
  if (typeof raw !== "string" || raw === "") return [];
  const parsed = z.array(z.string()).safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : [];
}
