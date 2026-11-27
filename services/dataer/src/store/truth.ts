/**
 * Ground truth for SCORING the detective. Reads the FULL run database (schema `truth`), so it must never
 * be reachable from the LLM's SQL path: the detective loop only ever gets a sandbox.
 */
import { z } from "zod";
import { TruthPoint } from "@s2d/schema/detective";
import { openStore } from "./duckdb";

export async function readTruthPoints(dbPath: string): Promise<TruthPoint[]> {
  const store = await openStore(dbPath, { readOnly: true });
  try {
    const rows = await store.query(
      `SELECT CAST(id AS VARCHAR) AS id, CAST(entity_ids AS VARCHAR) AS entity_ids,
              CAST(CAST(start AS DATE) AS VARCHAR) AS start
       FROM truth.story_points ORDER BY id`,
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
