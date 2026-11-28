/**
 * A5 `detail` (SPEC §3.A, docs/cascade-design.md D5/D6). The agent fills in every parameter of the
 * model; code takes meta, curves, story points and expectations from the input and 04_story verbatim,
 * then `compileScenario` errors go back to the agent (max 3 iterations).
 */
import { z } from "zod";
import type { Llm } from "@s2d/llm";
import type { DataModel, Influences, StoryPlan } from "@s2d/schema/artifacts";
import { Scenario } from "@s2d/schema/scenario";
import { A5_DETAIL, userPrompt } from "./prompts/index";
import {
  checkCurveCoverage,
  checkCurvesOnRoots,
  checkEntityIds,
  checkExpectationTables,
  checkLeadIn,
  checkModelShape,
} from "./checks";
import { formatFeedback, formatHistory, repairLoop, type RepairLoopOptions } from "./loop";
import { describeLeverReach } from "./reach";
import type { CascadeInput } from "./steps";

/** What the A5 agent returns: only the parts code cannot derive. Not an artifact (05 is the Scenario). */
export const ScenarioDetail = z.object({
  name: Scenario.shape.meta.shape.name,
  start: Scenario.shape.meta.shape.start,
  end: Scenario.shape.meta.shape.end,
  entities: Scenario.shape.entities,
  flows: Scenario.shape.flows,
  processes: Scenario.shape.processes,
});
export type ScenarioDetail = z.infer<typeof ScenarioDetail>;

export const DEFAULT_SEED = 42;

/**
 * A5 gets more attempts than the other loops: with the story gate it converges slowly (live runs:
 * revenue -6.6% -> -8.7% for a -10% target within 3 attempts, one attempt lost to a non-JSON answer).
 */
export const A5_MAX_ITERATIONS = 5;

export interface A5Input {
  input: CascadeInput;
  runId: string;
  model: DataModel;
  influences: Influences;
  story: StoryPlan;
}

export function assembleScenario(a: A5Input, d: ScenarioDetail): Scenario {
  return {
    meta: {
      id: scenarioId(a.runId),
      name: d.name,
      company: a.input.company,
      story: a.input.story,
      seed: DEFAULT_SEED,
      start: d.start,
      end: d.end,
      locale: "cs-CZ",
    },
    entities: d.entities,
    curves: a.story.curves,
    flows: d.flows,
    processes: d.processes,
    storyPoints: a.story.storyPoints,
    expectations: a.story.expectations,
  };
}

/** meta.id must match ^[a-z0-9_-]+$; run ids may contain upper case or other characters. */
export function scenarioId(runId: string): string {
  return runId.toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "scenario";
}

export function a5Detail(
  llm: Llm,
  a: A5Input,
  opts: Pick<
    RepairLoopOptions<ScenarioDetail>,
    "onEvent" | "signal" | "onRejected" | "verify" | "initial" | "firstN"
  >,
) {
  const verify = opts.verify;
  return repairLoop<ScenarioDetail>({
    step: "05_scenario",
    maxIterations: A5_MAX_ITERATIONS,
    ...opts,
    // the agent always edits its best attempt so far, never a regression (live run 3, podpora)
    keepBest: true,
    // out of attempts but runnable: generate and let the evidence show which hypotheses fail
    acceptGateMisses: true,
    // a failed expectation also says where the levers sit and whether a chain reaches the measured table
    verify:
      verify &&
      (async (s) => {
        const errors = await verify(s);
        return errors.length > 0 ? [...errors, ...describeLeverReach(s, errors, a.influences)] : errors;
      }),
    ask: (feedback, previous, n, history) =>
      llm.object({
        schemaName: "05_scenario",
        schema: ScenarioDetail,
        instructions: A5_DETAIL,
        prompt: userPrompt({
          Story: a.input.story,
          "02_model": a.model,
          "03_influences": a.influences,
          "04_story": a.story,
          ...(feedback.length > 0 && {
            [`Best attempt so far (this is attempt ${n})`]: previous ?? "(did not match the schema)",
            "Errors of that attempt (fix all of them, keep everything else unchanged)":
              formatFeedback(feedback),
          }),
          ...(history.length > 1 && {
            "Earlier attempts (what each one failed on; do not repeat a change that made it worse)":
              formatHistory(history),
          }),
        }),
      }),
    assemble: (d) => ({ ok: true, scenario: assembleScenario(a, d) }),
    check: (s) => [
      ...checkModelShape(s),
      ...checkCurveCoverage(s, a.story),
      // AGENTS.md rule 3 in code: a curve may drive only a root of 03_influences
      ...checkCurvesOnRoots(s, a.influences),
      // expectations come from 04_story; A5 must keep the table names and visibility they rely on
      ...checkExpectationTables(s.expectations, s),
      // curve scopes / story point entities from 04_story must still name existing rows
      ...checkEntityIds(a.story, s.entities),
      // a long lead-in only makes the story gate slow (user run 5813f06c: 640 days, 10 min)
      ...checkLeadIn(s),
    ],
  });
}
