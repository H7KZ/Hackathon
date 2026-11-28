/** Checks on 04a_overlay: the matrix itself, then the scenario it builds must compile (no engine, D5). */
import { compileScenario } from "@s2d/noiser";
import type { CompileError } from "@s2d/schema/api";
import type { CausalMap, ProcessesPlan, StoryOverlay } from "@s2d/schema/artifacts";
import type { CascadeInput } from "../steps";
import { assembleCausal } from "./assemble";
import { checkCurveScopes } from "../checks";
import { buildCurves, checkOverlay } from "./curves";

export function checkOverlayScenario(
  input: CascadeInput,
  runId: string,
  map: CausalMap,
  plan: ProcessesPlan,
  overlay: StoryOverlay,
): CompileError[] {
  const own = checkOverlay(overlay, map);
  if (own.length > 0) return own;
  const curves = buildCurves(map, overlay, plan);
  const story = { storyPoints: overlay.storyPoints, curves, expectations: [] };
  // a lever left unscoped although its story points name entity rows would move every row
  const scopes = checkCurveScopes(story, plan.entities);
  if (scopes.length > 0) return scopes;
  // compileScenario includes checkStoryRefs (scope and story point entity ids)
  const compiled = compileScenario(assembleCausal({ input, runId, plan, overlay, story }));
  return compiled.ok ? [] : compiled.errors;
}
