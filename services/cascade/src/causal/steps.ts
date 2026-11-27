/**
 * Agents 4a/4b of the causal design (docs/cascade-design.md D4). 4b runs the repair loop with
 * compileScenario on a placeholder scenario (flat lever curves, no story yet) + the trace checks.
 */
import type { Llm } from "@s2d/llm";
import { CausalMap, ProcessesPlan, type CompanySpec, type DataModel } from "@s2d/schema/artifacts";
import type { CurveDef, Scenario } from "@s2d/schema/scenario";
import { checkModelShape } from "../checks";
import { formatFeedback, repairLoop, type RepairLoopOptions } from "../loop";
import { CAUSAL_MAP, PROCESSES } from "../prompts/causal";
import { userPrompt } from "../prompts/index";
import type { CascadeInput } from "../steps";
import { checkTrace } from "./trace";

export function a4aCausalMap(
  llm: Llm,
  input: CascadeInput,
  company: CompanySpec,
  model: DataModel,
): Promise<CausalMap> {
  return llm.object({
    schemaName: "03a_causal_map",
    schema: CausalMap,
    instructions: CAUSAL_MAP,
    prompt: userPrompt({ Story: input.story, "01_company": company, "02_model": model }),
  });
}

/** Levers as flat curves at their baseline: lets 4b compile before the story overlay exists. */
export function flatLeverCurves(map: CausalMap): CurveDef[] {
  return map.nodes
    .filter((n) => n.kind === "lever")
    .map((n) => ({ id: n.id, baseline: n.baseline ?? 0, segments: [] }));
}

/** Date range for compiling 4b before the overlay picks the real one. */
export const PLACEHOLDER_RANGE = { start: "2025-01-01", end: "2025-12-31" } as const;

export function processesScenario(plan: ProcessesPlan, map: CausalMap): Scenario {
  return {
    meta: {
      id: "causal_processes",
      name: "causal processes",
      company: "",
      story: "",
      seed: 42,
      ...PLACEHOLDER_RANGE,
      locale: "cs-CZ",
    },
    entities: plan.entities,
    curves: flatLeverCurves(map),
    flows: plan.flows,
    processes: plan.processes,
    storyPoints: [],
    expectations: [],
  };
}

export function a4bProcesses(
  llm: Llm,
  a: { input: CascadeInput; model: DataModel; map: CausalMap },
  opts: Pick<RepairLoopOptions<ProcessesPlan>, "onEvent" | "signal" | "onRejected">,
) {
  let current: ProcessesPlan | undefined;
  return repairLoop<ProcessesPlan>({
    step: "03b_processes",
    ...opts,
    ask: (feedback, previous, n) =>
      llm.object({
        schemaName: "03b_processes",
        schema: ProcessesPlan,
        instructions: PROCESSES,
        prompt: userPrompt({
          Story: a.input.story,
          "02_model": a.model,
          "03a_causal_map": a.map,
          ...(feedback.length > 0 && {
            [`Previous attempt (this is attempt ${n})`]: previous ?? "(did not match the schema)",
            "Errors (fix all of them, keep everything else unchanged)": formatFeedback(feedback),
          }),
        }),
      }),
    assemble: (plan) => {
      current = plan;
      return { ok: true, scenario: processesScenario(plan, a.map) };
    },
    check: (s) => [...checkModelShape(s), ...(current ? checkTrace(current, a.map) : [])],
  });
}
