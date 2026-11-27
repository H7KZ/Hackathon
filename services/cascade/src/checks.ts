/**
 * Deterministic story checks (no engine, docs/cascade-design.md D5). compileScenario accepts a
 * scenario that is valid but carries no story; these catch that and go back to the agent as feedback.
 * A real Haiku run produced a single-process model with an unused late-delivery curve.
 */
import type { CompileError } from "@s2d/schema/api";
import type { DataModel, StoryPlan } from "@s2d/schema/artifacts";

/** The effect needs a chain to travel through: at least one branch or derive after an arrival. */
export function checkModelShape(model: Pick<DataModel, "processes">): CompileError[] {
  const hasChain = model.processes.some((p) => p.type === "branch" || p.type === "derive");
  if (hasChain) return [];
  return [
    {
      path: "processes",
      message:
        "The model has no causal chain: add branch/derive processes so the story's lever (an arrival or a field probability) leads to the outcome tables, e.g. order -> branch on stock -> sale / lost_sale -> derive complaint.",
    },
  ];
}

/** Every curve planned in 04_story must drive some Param, otherwise its story point never shows. */
export function checkCurveCoverage(scenario: unknown, story: Pick<StoryPlan, "curves">): CompileError[] {
  const used = new Set<string>();
  collectCurveRefs(scenario, used);
  return story.curves
    .filter((c) => !used.has(c.id))
    .map((c) => ({
      path: `curves.${c.id}`,
      message: `Curve "${c.id}" from 04_story is not used. Reference it as {"curve": "${c.id}"} in the Param it drives (an arrival rate or a bernoulli p in entities/processes).`,
    }));
}

function collectCurveRefs(node: unknown, used: Set<string>, key?: string): void {
  // the scenario's own curve list defines curves, it does not use them
  if (key === "curves") return;
  if (Array.isArray(node)) {
    for (const n of node) collectCurveRefs(n, used);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const rec = node as Record<string, unknown>;
  if (typeof rec.curve === "string") used.add(rec.curve);
  for (const [k, v] of Object.entries(rec)) collectCurveRefs(v, used, k);
}
