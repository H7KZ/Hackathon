/**
 * Ground truth for SCORING the detective. Reads the FULL run database (schema `truth`), so it must never
 * be reachable from the LLM's SQL path: the detective loop only ever gets a sandbox.
 */
import { z } from "zod";
import { TruthPoint } from "@s2d/schema/detective";
import { openStore } from "./duckdb";

/**
 * Only FINDABLE story points count: phase >= 1 (phase 0 is the "normal operation" baseline, not an
 * event) and with at least one entity id (a finding can only match by entity). Live run #2 had a
 * baseline point in the answer key, which capped recall at 2/3.
 */
export async function readTruthPoints(dbPath: string): Promise<TruthPoint[]> {
  const store = await openStore(dbPath, { readOnly: true });
  try {
    const rows = await store.query(
      `SELECT CAST(id AS VARCHAR) AS id, CAST(entity_ids AS VARCHAR) AS entity_ids,
              CAST(CAST(start AS DATE) AS VARCHAR) AS start
       FROM truth.story_points
       WHERE TRY_CAST(phase AS INTEGER) >= 1 AND coalesce(CAST(entity_ids AS VARCHAR), '') <> ''
       ORDER BY id`,
    );
    return z.array(TruthPoint).parse(
      rows.map((r) => ({
        id: r.id,
        entityIds: typeof r.entity_ids === "string" && r.entity_ids !== "" ? r.entity_ids.split(",") : [],
        start: r.start,
      })),
    );
  } finally {
    store.close();
  }
}
