/** Code-only assembly of the causal design's scenario (docs/cascade-design.md D5/D6). */
import type { ProcessesPlan, StoryOverlay, StoryPlan } from "@s2d/schema/artifacts";
import type { Scenario } from "@s2d/schema/scenario";
import { DEFAULT_SEED, scenarioId } from "../a5_detail";
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
