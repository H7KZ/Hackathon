/**
 * Cascade orchestrator (SPEC §3.A). Every step writes runs/<runId>/NN_name.json.
 * An existing artifact file is reused instead of calling the agent again, so a hand-edited
 * artifact re-runs only the steps after it (SPEC §2 rule 9) — delete later files to recompute them.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import { LlmCacheMiss, LlmOutputInvalid, type Llm } from "@s2d/llm";
import { checkStoryRefs } from "@s2d/noiser";
import {
  CausalMap,
  CompanySpec,
  DataModel,
  ExpectationQueries,
  ExpectationsPlan,
  Influences,
  ProcessesPlan,
  StoryOverlay,
  StoryPlan,
  type ArtifactName,
} from "@s2d/schema/artifacts";
import { Scenario } from "@s2d/schema/scenario";
import type { CompileError } from "@s2d/schema/api";
import { a5Detail } from "./a5_detail";
import { seedRobust } from "./gate";
import { checkCausalMap } from "./causal/map";
import { finishCausal } from "./causal/assemble";
import { deriveHypotheses } from "./causal/hypotheses";
import { checkOverlayScenario } from "./causal/overlay";
import { a4bExpectations, causalStory, checkQueries } from "./causal/sql";
import { a4aCausalMap, a4bProcesses, a4Overlay } from "./causal/steps";
import {
  checkCurveScopes,
  checkExpectationTables,
  checkInfluenceRefs,
  checkModelShape,
  checkStoryPlan,
} from "./checks";
import type { OnEvent } from "./events";
import {
  attemptRank,
  formatFeedback,
  withSchemaRetry,
  type Attempt,
  type Feedback,
  type Stage,
} from "./loop";
import { a1Company, a2Model, a3Influences, a4Story, type CascadeInput } from "./steps";

export interface CascadeOptions {
  llm: Llm;
  runsDir: string;
  runId: string;
  /** Stop after this step (inclusive). Default: 05_scenario. */
  until?: ArtifactName;
  onEvent?: OnEvent;
  /** Checked between steps and between A5 iterations (a running LLM call is not interrupted). */
  signal?: AbortSignal;
  /** Story gate for A5 (gate.ts `storyGate`): engine + expectations; failures go back to the agent. */
  verify?: (scenario: Scenario) => Promise<CompileError[]>;
  /**
   * "v1" (default): A1 company -> A2 model -> A3 influences -> A4 story -> A5 detail.
   * "causal": docs/cascade-design.md D1–D4 (typed causal map, 4a/4b with trace, curves and
   * expectations built by code). Both designs have a passing eval recording (docs/handoffs/cascade.md).
   */
  design?: CascadeDesign;
}

export type CascadeDesign = "v1" | "causal";

/** Causal design: how many times a failed story gate on 05 goes back to 4b. */
export const GATE_REPAIRS = 3;

/** Artifacts each design writes, in order. `until` must name one of them. */
export const DESIGN_STEPS: Record<CascadeDesign, readonly ArtifactName[]> = {
  v1: ["01_company", "02_model", "03_influences", "04_story", "05_scenario"],
  causal: [
    "01_company",
    "02_model",
    "03a_causal_map",
    "03b_processes",
    "04a_overlay",
    "04b_expectations",
    "04_story",
    "05_scenario",
  ],
};

/** An agent step could not produce its artifact (invalid LLM output, or no cache entry offline). */
export class CascadeStepError extends Error {
  constructor(
    readonly step: ArtifactName,
    cause: Error,
  ) {
    super(cause.message, { cause });
    this.name = "CascadeStepError";
  }
}

/** The run dir belongs to another story/company. */
export class CascadeRunMismatch extends Error {
  constructor(runId: string) {
    super(`Run "${runId}" was created for a different story/company. Use a new runId.`);
    this.name = "CascadeRunMismatch";
  }
}

export async function runCascade(input: CascadeInput, opts: CascadeOptions) {
  const dir = join(opts.runsDir, opts.runId);
  mkdirSync(dir, { recursive: true });
  const order = DESIGN_STEPS[opts.design ?? "v1"];
  const until = opts.until ?? order[order.length - 1] ?? "05_scenario";
  if (!order.includes(until))
    throw new CascadeStepError(
      until,
      new Error(`Design "${opts.design ?? "v1"}" has no step ${until}. Steps: ${order.join(", ")}.`),
    );
  const shouldRun = (name: ArtifactName) => order.indexOf(name) <= order.indexOf(until);

  async function step<T>(name: ArtifactName, schema: z.ZodType<T>, produce: () => Promise<T>): Promise<T> {
    opts.signal?.throwIfAborted();
    const file = join(dir, `${name}.json`);
    if (existsSync(file)) {
      opts.onEvent?.({ type: "step.done", step: name, cached: true });
      return schema.parse(JSON.parse(readFileSync(file, "utf8")));
    }
    opts.onEvent?.({ type: "step.started", step: name });
    let value: T;
    try {
      value = await produce();
    } catch (err) {
      if (err instanceof LlmOutputInvalid || err instanceof LlmCacheMiss)
        throw new CascadeStepError(name, err);
      throw err;
    }
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    opts.onEvent?.({ type: "step.done", step: name, cached: false });
    return value;
  }

  // Reusing a run dir with a different story would silently mix artifacts of two stories.
  const inputFile = join(dir, "00_input.json");
  const inputJson = `${JSON.stringify(input, null, 2)}\n`;
  if (existsSync(inputFile) && readFileSync(inputFile, "utf8") !== inputJson) {
    throw new CascadeRunMismatch(opts.runId);
  }
  writeFileSync(inputFile, inputJson);
  const rejected =
    (name: ArtifactName, key?: string) => (n: number, value: unknown, feedback: Feedback, stage: Stage) => {
      // a schema-invalid answer may have no value at all; keep the file parseable for a resume
      writeFileSync(join(dir, `${name}.rejected-${n}.json`), `${JSON.stringify(value ?? null, null, 2)}\n`);
      if (key !== undefined)
        writeFileSync(
          join(dir, `${name}.rejected-${n}.feedback.json`),
          `${JSON.stringify({ key, stage, feedback }, null, 2)}\n`,
        );
    };
  const llm = (name: ArtifactName, check?: (value: unknown) => CompileError[]) =>
    withSchemaRetry(opts.llm, name, { onEvent: opts.onEvent, signal: opts.signal, check });
  const company = await step("01_company", CompanySpec, () => a1Company(llm("01_company"), input));
  if (!shouldRun("02_model")) return { dir, company };
  const model = await step("02_model", DataModel, () =>
    a2Model(
      llm("02_model", (v) => checkModelShape(DataModel.parse(v))),
      input,
      company,
    ),
  );
  if (opts.design === "causal") {
    if (!shouldRun("03a_causal_map")) return { dir, company, model };
    const causalMap = await step("03a_causal_map", CausalMap, () =>
      a4aCausalMap(
        llm("03a_causal_map", (v) => checkCausalMap(CausalMap.parse(v))),
        input,
        company,
        model,
      ),
    );
    if (!shouldRun("03b_processes")) return { dir, company, model, causalMap };
    const processes = await step("03b_processes", ProcessesPlan, async () => {
      const res = await a4bProcesses(
        opts.llm,
        { input, model, map: causalMap },
        { onEvent: opts.onEvent, signal: opts.signal, onRejected: rejected("03b_processes") },
      );
      if (res.ok) return res.output;
      throw new CascadeStepError(
        "03b_processes",
        new Error(`Processes do not realize the map:\n${formatFeedback(res.feedback)}`),
      );
    });
    if (!shouldRun("04a_overlay")) return { dir, company, model, causalMap, processes };
    const overlay = await step("04a_overlay", StoryOverlay, () =>
      a4Overlay(
        llm("04a_overlay", (v) =>
          checkOverlayScenario(input, opts.runId, causalMap, processes, StoryOverlay.parse(v)),
        ),
        { input, map: causalMap, plan: processes },
      ),
    );
    if (!shouldRun("04b_expectations")) return { dir, company, model, causalMap, processes, overlay };
    const expectations = await step("04b_expectations", ExpectationsPlan, async () => {
      const hypotheses = deriveHypotheses(causalMap, overlay, processes);
      if (hypotheses.length === 0)
        throw new CascadeStepError(
          "04b_expectations",
          new Error(
            "No hypothesis follows from 04a_overlay: no lever moves, or no observed event/state table lies on a path. Edit 03a_causal_map or 04a_overlay.",
          ),
        );
      const sql = await a4bExpectations(
        llm("04b_expectations", (v) =>
          checkQueries(hypotheses, ExpectationQueries.parse(v).queries, processes),
        ),
        { hypotheses, plan: processes, overlay },
      );
      return { hypotheses, queries: sql.queries };
    });
    if (!shouldRun("04_story")) return { dir, company, model, causalMap, processes, overlay, expectations };
    // code only: the UI timeline edits 04_story, and 05 is rebuilt from it
    const story = await step("04_story", StoryPlan, () =>
      Promise.resolve(causalStory(causalMap, overlay, expectations, processes)),
    );
    if (!shouldRun("05_scenario"))
      return { dir, company, model, causalMap, processes, overlay, expectations, story };
    let plan = processes;
    const scenario = await step("05_scenario", Scenario, async () => {
      // Story gate failures (weak effect, drift) go back to 4b, which owns rates, counts and initial
      // values; map, overlay, curves and SQL stay fixed. Same idea as v1, where A5 gets them.
      // The code-derived story must also hold on >= 4/5 other seeds (live run 4: seed 42 was luck).
      const verify = opts.verify && seedRobust(opts.verify);
      for (let round = 0; ; round++) {
        const res = finishCausal({ input, runId: opts.runId, plan, overlay, story });
        const errors = res.ok ? ((await verify?.(res.scenario)) ?? []) : res.errors;
        if (res.ok && errors.length === 0) return res.scenario;
        const repairable = res.ok && round < GATE_REPAIRS;
        if (repairable) {
          opts.onEvent?.({
            type: "log",
            message: `Story gate neprošel, krok 4b opravuje parametry (${round + 1}/${GATE_REPAIRS}).`,
          });
          const fixed = await a4bProcesses(
            opts.llm,
            { input, model, map: causalMap },
            {
              onEvent: opts.onEvent,
              signal: opts.signal,
              onRejected: rejected("03b_processes"),
              initial: {
                // the round keeps each repair prompt distinct (an identical prompt replays the cache)
                feedback: [
                  {
                    path: "story_gate",
                    message: `Story gate round ${round + 1}/${GATE_REPAIRS}: the generated data does not show the story. Fix the parameters below.`,
                  },
                  ...errors,
                ],
                previous: plan,
              },
            },
          );
          // the SQL reads the tables and columns of the old plan; a fix must keep them
          const sqlErrors = fixed.ok
            ? checkQueries(expectations.hypotheses, expectations.queries, fixed.output)
            : [];
          if (fixed.ok && sqlErrors.length === 0) {
            plan = fixed.output;
            writeFileSync(join(dir, "03b_processes.json"), `${JSON.stringify(plan, null, 2)}\n`);
            continue;
          }
        }
        opts.onEvent?.({
          type: "log",
          message: "Složený scénář neprošel kontrolami. Uprav 04_story (nebo 03b_processes) a spusť znovu.",
        });
        throw new CascadeStepError(
          "05_scenario",
          new Error(`Causal scenario fails the checks:\n${formatFeedback(errors)}`),
        );
      }
    });
    return { dir, company, model, causalMap, processes: plan, overlay, expectations, story, scenario };
  }
  if (!shouldRun("03_influences")) return { dir, company, model };
  const influences = await step("03_influences", Influences, () =>
    a3Influences(
      llm("03_influences", (v) => checkInfluenceRefs(Influences.parse(v), model)),
      input,
      company,
      model,
    ),
  );
  if (!shouldRun("04_story")) return { dir, company, model, influences };
  const story = await step("04_story", StoryPlan, () =>
    a4Story(
      llm("04_story", (v) => {
        const plan = StoryPlan.parse(v);
        // curves and story points go into 05 verbatim, so A5 cannot repair them: check them here
        return [
          ...checkStoryPlan(plan),
          ...checkCurveScopes(plan, model.entities),
          ...checkExpectationTables(plan.expectations, model),
          ...checkStoryRefs({ entities: model.entities, curves: plan.curves, storyPoints: plan.storyPoints }),
        ];
      }),
      input,
      model,
      influences,
    ),
  );
  if (!shouldRun("05_scenario")) return { dir, company, model, influences, story };
  const scenario = await step("05_scenario", Scenario, async () => {
    // a new run after A5 gave up continues from its best rejected attempt for the same story, with the
    // history of all of them: with the disk cache, starting over at attempt 1 would only replay the same answers
    const key = storyKey(story);
    const resume = bestRejected(dir, "05_scenario", key);
    const res = await a5Detail(
      opts.llm,
      { input, runId: opts.runId, model, influences, story },
      {
        onEvent: opts.onEvent,
        signal: opts.signal,
        // seed 42 alone can be luck (causal, run 4); v1 demands >= 4/5 of seeds 1..5 too (run 5: all
        // four run-4 v1 scenarios already passed that, so it costs no extra attempt there)
        verify: opts.verify && seedRobust(opts.verify),
        // kept next to the artifacts so a failed A5 can be inspected, fixed by hand or resumed
        onRejected: rejected("05_scenario", key),
        ...(resume && {
          initial: { previous: resume.previous, feedback: resume.feedback, history: resume.history },
          firstN: resume.lastN + 1,
        }),
      },
    );
    if (res.ok) return res.scenario;
    opts.onEvent?.({
      type: "log",
      message: `Krok A5 ani po ${res.iterations} pokusech nesestavil platný scénář. Neúspěšné pokusy jsou v 05_scenario.rejected-N.json; uprav 04_story nebo nahraj 05_scenario ručně.`,
    });
    throw new CascadeStepError(
      "05_scenario",
      new Error(`Scenario does not compile:\n${formatFeedback(res.feedback)}`),
    );
  });
  return { dir, company, model, influences, story, scenario };
}

/** Identity of the story an A5 attempt was made for (an edited 04_story must not resume old attempts). */
function storyKey(story: { storyPoints: unknown; curves: unknown; expectations: unknown }): string {
  return createHash("sha256")
    .update(JSON.stringify([story.storyPoints, story.curves, story.expectations]))
    .digest("hex")
    .slice(0, 16);
}

/**
 * The rejected attempts of `name` made for this story: the best one (stage reached, then fewest errors;
 * the later one on a tie) with its feedback, the history of all of them, and the highest attempt number.
 */
function bestRejected(dir: string, name: ArtifactName, key: string) {
  const suffix = ".feedback.json";
  const prefix = `${name}.rejected-`;
  const ns = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
    .map((f) => Number(f.slice(prefix.length, -suffix.length)))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  const history: Attempt[] = [];
  let best: { n: number; rank: number; feedback: Feedback; previous: unknown } | undefined;
  for (const n of ns) {
    const side = JSON.parse(readFileSync(join(dir, `${prefix}${n}${suffix}`), "utf8")) as {
      key: string;
      stage?: Stage;
      feedback: Feedback;
    };
    if (side.key !== key) continue;
    // files written before stages were stored: an expectation failure means the story gate was reached
    const stage: Stage =
      side.stage ??
      (side.feedback.some((f) => typeof f !== "string" && f.path.startsWith("expectations"))
        ? "story gate"
        : "check");
    history.push({ n, stage, feedback: side.feedback });
    const rank = attemptRank({ stage, feedback: side.feedback });
    if (best && rank < best.rank) continue;
    let previous: unknown;
    try {
      previous = JSON.parse(readFileSync(join(dir, `${prefix}${n}.json`), "utf8"));
    } catch {
      continue; // an older run wrote "undefined" for an answer that had no value
    }
    best = { n, rank, feedback: side.feedback, previous };
  }
  if (!best) return undefined;
  return { previous: best.previous, feedback: best.feedback, history, lastN: history.at(-1)?.n ?? best.n };
}
