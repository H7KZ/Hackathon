/**
 * Magnitudes a reader would call nonsense although every other check passes (user session: A5 made late
 * deliveries 90–150 days late to push complaints over the story gate, which also ran delivered dates
 * months past the period end). Domain-agnostic: a date offset is a duration, and a duration longer than a
 * third of the simulated period (at most 60 days) is not a delay anyone believes.
 */
import type { CompileError } from "@s2d/schema/api";
import type { FieldGen, Param, Scenario } from "@s2d/schema/scenario";
import { toDay } from "../engine/days";

/** Longest believable date offset for a period of `periodDays` days. */
export const maxOffsetDays = (periodDays: number) => Math.min(60, Math.max(7, Math.round(periodDays / 3)));

type Fields = Record<string, FieldGen>;

/** Upper bound of a numeric field, `undefined` when it cannot be known statically. */
function upper(
  gen: FieldGen | undefined,
  fields: Fields,
  param: (p: Param) => number,
  seen: Set<string>,
): number | undefined {
  if (!gen) return undefined;
  switch (gen.gen) {
    case "const":
      return typeof gen.value === "number" ? gen.value : undefined;
    case "uniformInt":
      return param(gen.max);
    case "normal":
      return gen.max ?? param(gen.mean) + 3 * param(gen.sd);
    case "poisson": {
      const l = param(gen.lambda);
      return l + 3 * Math.sqrt(l);
    }
    case "if": {
      const a = upper(gen.then, fields, param, seen);
      const b = upper(gen.else, fields, param, seen);
      return a === undefined || b === undefined ? undefined : Math.max(a, b);
    }
    case "ref": {
      const name = /^self\.(\w+)$/.exec(gen.path)?.[1];
      if (!name || seen.has(name)) return undefined;
      return upper(fields[name], fields, param, new Set([...seen, name]));
    }
    default:
      return undefined;
  }
}

export function checkMagnitudes(s: Scenario): CompileError[] {
  const errors: CompileError[] = [];
  const period = toDay(s.meta.end) - toDay(s.meta.start) + 1;
  const limit = maxOffsetDays(period);
  const curveMax = (id: string) => {
    const c = s.curves.find((x) => x.id === id);
    return c ? Math.max(c.baseline, ...c.segments.map((g) => g.to)) : 0;
  };
  const param = (p: Param) => (typeof p === "number" ? p : curveMax(p.curve) * (p.scale ?? 1));
  const check = (fields: Fields, at: string) => {
    for (const [name, gen] of Object.entries(fields)) {
      if (gen.gen !== "dateOffset") continue;
      const daysField = /^self\.(\w+)$/.exec(gen.days)?.[1];
      if (!daysField) continue;
      const max = upper(fields[daysField], fields, param, new Set([daysField]));
      if (max === undefined || max <= limit) continue;
      errors.push({
        path: `${at}.fields.${daysField}`,
        message: `Field "${daysField}" (the days of "${name}") can reach ${String(Math.round(max))} days, implausible in a ${String(period)}-day period: a reader does not believe a delay or lead time that long, and the dates run past meta.end. Keep it at most ${String(limit)} days. To make the story stronger, raise a probability or let it affect more records instead of stretching the magnitude.`,
      });
    }
  };
  s.entities.forEach((e, i) => {
    check(e.fields, `entities[${String(i)}]`);
  });
  s.processes.forEach((p, i) => {
    if ("fields" in p) check(p.fields, `processes[${String(i)}]`);
  });
  return errors;
}
