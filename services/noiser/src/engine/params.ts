/** Param = constant | curve evaluated at (day, current record), times optional `scale`. */
import type { Param } from "@s2d/schema/scenario";
import { tryResolve } from "./context";
import { evaluateCurve } from "./curves";
import { EngineError } from "./errors";
import type { Ctx, Runtime } from "./types";

export function evalParam(param: Param, ctx: Ctx, rt: Runtime, at: string): number {
  if (typeof param === "number") return param;
  const curve = rt.curves.get(param.curve);
  if (!curve) throw new EngineError(`${at}.curve`, `Unknown curve "${param.curve}".`);
  // records outside the curve scope (or without the scope field yet) get the baseline
  const scopeValue = curve.scope ? tryResolve(curve.scope.field, ctx) : undefined;
  return evaluateCurve(curve, ctx.day, scopeValue) * (param.scale ?? 1);
}
