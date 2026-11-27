/**
 * Story curve = a parameter curve bent at story points (mirrors `CurveDef.segments` in the scenario:
 * each knot is a ramp segment `{ start, end?, to: level, storyPointId }`). This is a parameter the user
 * edits, not generated data: the engine turns it into records later.
 */

export type Knot = { id: string; start: string; end?: string; level: number };

const DAY = 86_400_000;
export const addDays = (iso: string, n: number) =>
  new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const byStart = (a: Knot, b: Knot) => a.start.localeCompare(b.start);

/** Value on `day`: baseline, then a smooth ramp (rampDays) to each knot's level; `end` ramps back to baseline. */
export function curveAt(day: string, baseline: number, knots: Knot[], rampDays = 14): number {
  let v = baseline;
  const ramp = Math.max(1, rampDays);
  for (const k of [...knots].sort(byStart)) {
    if (day < k.start) break;
    const from = v;
    v = from + (k.level - from) * ease(daysBetween(k.start, day) / ramp);
    if (k.end && day >= k.end) {
      const at = v;
      v = at + (baseline - at) * ease(daysBetween(k.end, day) / ramp);
    }
  }
  return v;
}

export function sampleCurve(
  baseline: number,
  knots: Knot[],
  from: string,
  to: string,
  stepDays = 1,
  rampDays = 14,
): { day: string; value: number }[] {
  const out: { day: string; value: number }[] = [];
  for (let d = from; d <= to; d = addDays(d, stepDays)) {
    out.push({ day: d, value: curveAt(d, baseline, knots, rampDays) });
  }
  return out;
}

/** Next free id like `sp4`. */
export function nextId(knots: { id: string }[]): string {
  const n = knots.reduce((max, k) => Math.max(max, Number(/^sp(\d+)$/.exec(k.id)?.[1] ?? 0)), 0);
  return `sp${String(n + 1)}`;
}

/** Ramp length that fits the range: never longer than 1/8 of it (14 days on a 2-week range would hide everything). */
export function effectiveRamp(rampDays: number, from: string, to: string): number {
  return Math.max(1, Math.min(Math.round(rampDays) || 1, Math.floor((daysBetween(from, to) + 1) / 8)));
}

/** Moves points into [from, to] keeping their order and relative spacing (10 % margins). */
export function fitInto<T extends Knot>(knots: T[], from: string, to: string): T[] {
  if (!knots.length) return knots;
  const days = knots.flatMap((k) => (k.end ? [k.start, k.end] : [k.start])).sort();
  const lo = days[0] ?? from;
  const hi = days.at(-1) ?? to;
  const srcSpan = Math.max(1, daysBetween(lo, hi));
  const span = daysBetween(from, to);
  const a = addDays(from, Math.round(span * 0.1));
  const dst = Math.max(1, Math.round(span * 0.8));
  const map = (d: string) => addDays(a, Math.round((daysBetween(lo, d) / srcSpan) * dst));
  return knots.map((k) => ({ ...k, start: map(k.start), ...(k.end && { end: map(k.end) }) }));
}
