/**
 * Root curves (SPEC §2 rule 4): the story changes PARAMETERS over time, never outcomes.
 * Segments are applied in order on top of the value produced by previous segments.
 */
import type { CurveDef, Segment } from "@s2d/schema/scenario";
import { clamp } from "./random";
import { toDay } from "./days";

function applySegment(prev: number, seg: Segment, day: number): number {
  const start = toDay(seg.start);
  if (day < start) return prev;
  const end = seg.end === undefined ? undefined : toDay(seg.end);

  switch (seg.kind) {
    case "step":
      return end !== undefined && day >= end ? prev : seg.to;
    case "ramp": {
      if (end === undefined || end <= start || day >= end) return seg.to;
      return prev + ((seg.to - prev) * (day - start)) / (end - start);
    }
    case "spike": {
      // jump to `to` at start, linear return to prev by end (one-day spike if no end)
      const stop = end ?? start + 1;
      if (day >= stop) return prev;
      return seg.to + ((prev - seg.to) * (day - start)) / (stop - start);
    }
    case "decay": {
      // jump to `to`, exponential return to prev; end - start = half-life in days
      const halfLife = end !== undefined && end > start ? end - start : 7;
      return prev + (seg.to - prev) * Math.pow(0.5, (day - start) / halfLife);
    }
  }
}

/**
 * Value of a curve on `day` for a record. `scopeValue` is the record's value of `curve.scope.field`;
 * records outside the scope always get the baseline.
 */
export function evaluateCurve(curve: CurveDef, day: number, scopeValue?: unknown): number {
  if (curve.scope && !curve.scope.ids.includes(String(scopeValue))) return curve.baseline;
  const value = curve.segments.reduce((v, seg) => applySegment(v, seg, day), curve.baseline);
  return clamp(value, curve.clamp?.[0], curve.clamp?.[1]);
}
