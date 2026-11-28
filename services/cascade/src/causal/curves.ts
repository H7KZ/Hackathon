/**
 * D2: the LLM gives lever values per period (story point); code builds the CurveDefs.
 * Periods of one lever must be contiguous (end of period i = start of period i+1). A period with an
 * end returns the lever to its baseline afterwards; an open last period keeps its value.
 */
import type { CompileError } from "@s2d/schema/api";
import type { CausalMap, LeverRow, ProcessesPlan, StoryOverlay } from "@s2d/schema/artifacts";
import type { CurveDef, Segment, StoryPoint } from "@s2d/schema/scenario";

export interface Period {
  storyPoint: StoryPoint;
  value: number;
}

/** A row's periods sorted by start; values naming unknown story points are dropped (checkOverlay reports them). */
export function leverPeriods(row: LeverRow, storyPoints: readonly StoryPoint[]): Period[] {
  return row.values
    .flatMap((v) => {
      const sp = storyPoints.find((p) => p.id === v.storyPointId);
      return sp ? [{ storyPoint: sp, value: v.value }] : [];
    })
    .sort((a, b) => a.storyPoint.start.localeCompare(b.storyPoint.start));
}

/** Every field map of the plan (arrival / derive fields, branch outcomes) with the process keys outside them. */
function fieldMaps(plan: Pick<ProcessesPlan, "processes">) {
  return plan.processes.map((p) => {
    const { fields, then, else: otherwise, ...rest } = p as Record<string, unknown>;
    const outs = [then, otherwise] as ({ fields?: Record<string, unknown> } | undefined)[];
    const maps = [fields as Record<string, unknown> | undefined, ...outs.map((o) => o?.fields)].filter(
      (m): m is Record<string, unknown> => m !== undefined,
    );
    // branch outcomes may carry effects or conditions outside their fields
    const outRest = outs.map((o) => (o ? { ...o, fields: undefined } : undefined));
    return { maps, rest: { ...rest, outRest } };
  });
}

/**
 * The scope a lever needs when its story points are about specific entity rows (SUP-001): code sets
 * `self.<entity>_id in ids`, so the lever moves exactly the rows the answer key names. Live run 4: the
 * overlay named SUP-001 but left the lever unscoped; every supplier got late and the detective, who
 * saw that, scored 0. Only when every record using the lever has the `<entity>_id` field before the
 * field that reads the lever (a process-level use, like a rate, cannot be scoped by a record field).
 */
export function entityScope(
  leverId: string,
  moved: readonly StoryPoint[],
  plan: Pick<ProcessesPlan, "processes">,
): CurveDef["scope"] {
  const entities = moved.map((p) => p.entity);
  const first = entities[0];
  if (!first || first.ids.length === 0) return undefined;
  const ids = [...first.ids].sort().join();
  if (!entities.every((e) => e && e.name === first.name && [...e.ids].sort().join() === ids))
    return undefined;
  const ref = `"curve":"${leverId}"`;
  const field = `${first.name}_id`;
  let used = false;
  for (const { maps, rest } of fieldMaps(plan)) {
    if (JSON.stringify(rest).includes(ref)) return undefined;
    for (const fields of maps) {
      const keys = Object.keys(fields);
      const at = keys.indexOf(field);
      for (const [i, k] of keys.entries()) {
        if (!JSON.stringify(fields[k]).includes(ref)) continue;
        if (at < 0 || at > i) return undefined;
        used = true;
      }
    }
  }
  return used ? { field: `self.${field}`, ids: [...first.ids] } : undefined;
}

const isProbability = (xs: number[]) => xs.every((x) => x >= 0 && x <= 1);

/** One curve per lever of the map (flat at baseline when the overlay does not move it). */
export function buildCurves(
  map: CausalMap,
  overlay: Pick<StoryOverlay, "levers" | "storyPoints">,
  /** 03b processes: lets code scope a lever to the entity rows its story points name */
  plan?: Pick<ProcessesPlan, "processes">,
): CurveDef[] {
  return map.nodes
    .filter((n) => n.kind === "lever")
    .map((n) => {
      const baseline = n.baseline ?? 0;
      const row = overlay.levers.find((r) => r.lever === n.id);
      const periods = row ? leverPeriods(row, overlay.storyPoints) : [];
      const segments: Segment[] = periods
        .filter((p) => p.value !== baseline)
        .map((p) => ({
          kind: "step",
          start: p.storyPoint.start,
          ...(p.storyPoint.end !== undefined && { end: p.storyPoint.end }),
          to: p.value,
          storyPointId: p.storyPoint.id,
        }));
      const values = [baseline, ...periods.map((p) => p.value)];
      const moved = periods.filter((p) => p.value !== baseline).map((p) => p.storyPoint);
      const scope = row?.scope ?? (plan && moved.length > 0 ? entityScope(n.id, moved, plan) : undefined);
      return {
        id: n.id,
        baseline,
        ...(scope && { scope }),
        segments,
        ...(isProbability(values) &&
          n.baseline !== undefined &&
          n.baseline < 1 && { clamp: [0, 1] as [number, number] }),
      };
    });
}

export function checkOverlay(overlay: StoryOverlay, map: CausalMap): CompileError[] {
  const errors: CompileError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const levers = map.nodes.filter((n) => n.kind === "lever").map((n) => n.id);
  const points = overlay.storyPoints.map((p) => p.id);
  points.forEach((id, i) => {
    if (points.indexOf(id) !== i) err(`storyPoints.${i}.id`, `Duplicate story point id "${id}".`);
  });
  overlay.storyPoints.forEach((p, i) => {
    if (p.end !== undefined && p.end <= p.start)
      err(`storyPoints.${i}.end`, `end (${p.end}) must be after start (${p.start}).`);
  });
  overlay.levers.forEach((row, i) => {
    if (!levers.includes(row.lever))
      err(
        `levers.${i}.lever`,
        `"${row.lever}" is not a lever of 03a_causal_map. Only levers get values: ${levers.join(", ")}. Outcomes must emerge from the chain.`,
      );
    if (overlay.levers.findIndex((r) => r.lever === row.lever) !== i)
      err(`levers.${i}.lever`, `Lever "${row.lever}" has two rows; put all its periods into one row.`);
    row.values.forEach((v, j) => {
      if (!points.includes(v.storyPointId))
        err(
          `levers.${i}.values.${j}.storyPointId`,
          `Unknown story point "${v.storyPointId}". Story points: ${points.join(", ")}.`,
        );
      if (row.values.findIndex((w) => w.storyPointId === v.storyPointId) !== j)
        err(
          `levers.${i}.values.${j}`,
          `Story point "${v.storyPointId}" appears twice for lever "${row.lever}".`,
        );
    });
    const periods = leverPeriods(row, overlay.storyPoints);
    periods.slice(0, -1).forEach((p, k) => {
      const next = periods[k + 1]?.storyPoint;
      if (next && p.storyPoint.end !== next.start)
        err(
          `levers.${i}.values`,
          `Periods of lever "${row.lever}" must be contiguous: story point "${p.storyPoint.id}" ends ${p.storyPoint.end ?? "(open)"}, the next one ("${next.id}") starts ${next.start}. Set "${p.storyPoint.id}".end = ${next.start}.`,
        );
    });
  });
  return errors;
}
