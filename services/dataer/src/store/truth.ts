/**
 * Ground truth for SCORING the detective. Reads the FULL run database (schema `truth`), so it must never
 * be reachable from the LLM's SQL path: the detective loop only ever gets a sandbox.
 */
import { z } from "zod";
import { TruthPoint } from "@s2d/schema/detective";
import { quoteIdent } from "./columns";
import { openStore, type Store } from "./duckdb";

const ENTITY_ID = /^[A-Z][A-Z0-9]*-\d+$/;
/** A segment names a group; it stands for its entity rows only when they are few and not all of them. */
const MAX_SEGMENT_ROWS = 10;

/**
 * Entity ids whose attribute holds one of the segment values (segment "self.supplier_profile" =
 * ["problémový"] is supplier SUP-001): a finding naming that supplier found the point (run 7, v1 eval:
 * the detective named SUP-001, scored 0). Only entity tables (ids like SUP-001), only a few rows, never
 * every row: a broad category (105 sport products) stays a group the detective must name as such.
 */
async function segmentEntityIds(store: Store, field: unknown, values: string[]): Promise<string[]> {
  if (typeof field !== "string" || values.length === 0) return [];
  const column = field.split(".").at(-1) ?? "";
  if (!column) return [];
  const lit = (v: string) => `'${v.replaceAll("'", "''")}'`;
  const cols = await store.query(
    `SELECT table_schema, table_name, column_name FROM information_schema.columns
     WHERE table_schema IN ('main', 'truth') AND table_name <> 'story_points'
       AND table_name IN (SELECT table_name FROM information_schema.columns WHERE column_name = ${lit(column)})`,
  );
  // the id the attribute belongs to: an entity table's own "id", or "<e>_id" next to "<e>_<attr>" in a
  // record table (purchase_order.supplier_profile describes purchase_order.supplier_id)
  const owners = new Map<string, string[]>();
  for (const c of cols) {
    const name = String(c.column_name);
    const owns = name === "id" || (name.endsWith("_id") && column.startsWith(name.slice(0, -2)));
    if (!owns) continue;
    const from = `${quoteIdent(String(c.table_schema))}.${quoteIdent(String(c.table_name))}`;
    owners.set(from, [...(owners.get(from) ?? []), name]);
  }
  const ids: string[] = [];
  for (const [from, idCols] of owners)
    for (const idCol of idCols) {
      const all = await store.query(
        `SELECT DISTINCT CAST(${quoteIdent(idCol)} AS VARCHAR) AS id, CAST(${quoteIdent(column)} AS VARCHAR) AS v FROM ${from}`,
      );
      if (!all.every((r) => typeof r.id === "string" && ENTITY_ID.test(r.id))) continue;
      const total = new Set(all.map((r) => r.id)).size;
      const hit = [
        ...new Set(
          all.filter((r) => typeof r.v === "string" && values.includes(r.v)).map((r) => String(r.id)),
        ),
      ];
      if (hit.length > 0 && hit.length <= MAX_SEGMENT_ROWS && hit.length < total) ids.push(...hit);
    }
  return [...new Set(ids)];
}

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
    const has = (c: string) => cols.some((x) => x.column_name === c);
    const seg = has("segment_values") ? "CAST(segment_values AS VARCHAR)" : "CAST(NULL AS VARCHAR)";
    const segField = has("segment_field") ? "CAST(segment_field AS VARCHAR)" : "CAST(NULL AS VARCHAR)";
    const rows = await store.query(
      `SELECT * FROM (
         SELECT CAST(id AS VARCHAR) AS id, CAST(entity_ids AS VARCHAR) AS entity_ids,
                ${seg} AS segment_values, ${segField} AS segment_field, CAST(CAST(start AS DATE) AS VARCHAR) AS start,
                TRY_CAST(phase AS INTEGER) AS phase
         FROM truth.story_points)
       WHERE phase >= 1 AND (coalesce(entity_ids, '') <> '' OR coalesce(segment_values, '') <> '')
       ORDER BY id`,
    );
    const points = [];
    for (const r of rows) {
      const values = parseValues(r.segment_values);
      const own = typeof r.entity_ids === "string" && r.entity_ids !== "" ? r.entity_ids.split(",") : [];
      const viaSegment = await segmentEntityIds(store, r.segment_field, values);
      points.push({
        id: r.id,
        entityIds: [...new Set([...own, ...viaSegment])],
        ...(values.length > 0 ? { segmentValues: values } : {}),
        start: r.start,
      });
    }
    return z.array(TruthPoint).parse(points);
  } finally {
    store.close();
  }
}

function parseValues(raw: unknown): string[] {
  if (typeof raw !== "string" || raw === "") return [];
  const parsed = z.array(z.string()).safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : [];
}
