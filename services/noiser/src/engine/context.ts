/** Path resolution ("day" | "self.x" | "source.x" | "key.entity") and value coercion. */
import type { Cell } from "@s2d/schema/run";
import { fromDay, toDay } from "./days";
import { EngineError } from "./errors";
import type { Ctx } from "./types";

const own = (obj: Readonly<Record<string, Cell>> | undefined, name: string): Cell | undefined =>
  obj !== undefined && Object.hasOwn(obj, name) ? obj[name] : undefined;

/** Value of `path` in `ctx`, or undefined if the path is not available there. */
export function tryResolve(path: string, ctx: Ctx): Cell | undefined {
  if (path === "day") return fromDay(ctx.day);
  const dot = path.indexOf(".");
  const name = path.slice(dot + 1);
  switch (path.slice(0, dot)) {
    case "self":
      return own(ctx.self, name);
    case "source":
      return own(ctx.source, name);
    case "key":
      return own(ctx.key, name);
    default:
      return undefined;
  }
}

export function resolve(path: string, ctx: Ctx, at: string): Cell {
  const value = tryResolve(path, ctx);
  if (value === undefined) {
    throw new EngineError(
      at,
      `"${path}" is not available here. self.* may reference only fields declared earlier in the same record, ` +
        "source.* only fields of the source record (branch/derive), key.* only entities in `per` (arrival).",
    );
  }
  return value;
}

export function toNumber(value: Cell, at: string, what: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new EngineError(at, `${what} must be a finite number, got ${JSON.stringify(value)}.`);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** ISO date cell -> day index. */
export function toDayIndex(value: Cell, at: string, what: string): number {
  if (typeof value === "string" && ISO.test(value)) {
    const day = toDay(value);
    if (Number.isFinite(day) && fromDay(day) === value) return day;
  }
  throw new EngineError(at, `${what} must be an ISO date YYYY-MM-DD, got ${JSON.stringify(value)}.`);
}
