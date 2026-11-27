/** Param = constant | curve evaluated at (day, current record). */
import type { Param } from "@s2d/schema/scenario";
import { EngineError } from "./errors";
import type { Ctx, Runtime } from "./types";

export function evalParam(param: Param, _ctx: Ctx, _rt: Runtime, at: string): number {
  if (typeof param === "number") return param;
  throw new EngineError(at, "curve params are not supported yet");
}
