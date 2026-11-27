/** Code-only assembly of the causal design's scenario (docs/cascade-design.md D5/D6). */
import { compileScenario } from "@s2d/noiser";
import type { CompileError } from "@s2d/schema/api";
import type { ProcessesPlan, StoryOverlay, StoryPlan } from "@s2d/schema/artifacts";
import type { Scenario } from "@s2d/schema/scenario";
import { DEFAULT_SEED, scenarioId } from "../a5_detail";
import {
  checkCurveCoverage,
  checkEntityIds,
  checkExpectationTables,
  checkModelShape,
  checkStoryPlan,
} from "../checks";
import type { CascadeInput } from "../steps";

export interface CausalParts {
  input: CascadeInput;
  runId: string;
  plan: ProcessesPlan;
  overlay: Pick<StoryOverlay, "name" | "start" | "end">;
  story: Pick<StoryPlan, "storyPoints" | "curves" | "expectations">;
}

export function assembleCausal(a: CausalParts): Scenario {
  return {
    meta: {
      id: scenarioId(a.runId),
      name: a.overlay.name,
      company: a.input.company,
      story: a.input.story,
      seed: DEFAULT_SEED,
      start: a.overlay.start,
      end: a.overlay.end,
      locale: "cs-CZ",
    },
    entities: a.plan.entities,
    curves: a.story.curves,
    flows: a.plan.flows,
    processes: a.plan.processes,
    storyPoints: a.story.storyPoints,
    expectations: a.story.expectations,
  };
}

/** 05_scenario of the causal design: code only, compileScenario + the story checks (D5/D6). */
export function finishCausal(
  a: CausalParts,
): { ok: true; scenario: Scenario } | { ok: false; errors: CompileError[] } {
  const compiled = compileScenario(assembleCausal(a));
  if (!compiled.ok) return compiled;
  const s = compiled.scenario;
  const story = { ...a.story, storyPoints: s.storyPoints, curves: s.curves, expectations: s.expectations };
  const errors = [
    ...checkStoryPlan(story),
    ...checkModelShape(s),
    ...checkCurveCoverage(s, story),
    ...checkExpectationTables(s.expectations, s),
    ...checkEntityIds(story, s.entities),
  ];
  return errors.length > 0 ? { ok: false, errors } : { ok: true, scenario: s };
}
