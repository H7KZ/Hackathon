/**
 * D2: the LLM gives lever values per period (story point); code builds the CurveDefs.
 * Periods of one lever must be contiguous (end of period i = start of period i+1). A period with an
 * end returns the lever to its baseline afterwards; an open last period keeps its value.
 */
import type { CompileError } from "@s2d/schema/api";
import type { CausalMap, LeverRow, StoryOverlay } from "@s2d/schema/artifacts";
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

const isProbability = (xs: number[]) => xs.every((x) => x >= 0 && x <= 1);

/** One curve per lever of the map (flat at baseline when the overlay does not move it). */
export function buildCurves(
  map: CausalMap,
  overlay: Pick<StoryOverlay, "levers" | "storyPoints">,
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
      return {
        id: n.id,
        baseline,
        ...(row?.scope && { scope: row.scope }),
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
