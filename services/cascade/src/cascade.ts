/**
 * Cascade orchestrator (SPEC §3.A). Every step writes runs/<runId>/NN_name.json.
 * An existing artifact file is reused instead of calling the agent again, so a hand-edited
 * artifact re-runs only the steps after it (SPEC §2 rule 9) — delete later files to recompute them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import { LlmCacheMiss, LlmOutputInvalid, type Llm } from "@s2d/llm";
import { checkStoryRefs } from "@s2d/noiser";
import {
  CausalMap,
  CompanySpec,
  DataModel,
  Influences,
  ProcessesPlan,
  StoryPlan,
  type ArtifactName,
} from "@s2d/schema/artifacts";
import { Scenario } from "@s2d/schema/scenario";
import type { CompileError } from "@s2d/schema/api";
import { a5Detail } from "./a5_detail";
import { checkCausalMap } from "./causal/map";
import { a4aCausalMap, a4bProcesses } from "./causal/steps";
import {
  checkExpectationTables,
  checkInfluenceRefs,
  checkModelShape,
  checkStoryPlan,
} from "./checks";
import type { OnEvent } from "./events";
import { formatFeedback, withSchemaRetry } from "./loop";
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
   * expectations built by code). Not recorded in the demo cache yet.
   */
  design?: CascadeDesign;
}

export type CascadeDesign = "v1" | "causal";

/** Artifacts each design writes, in order. `until` must name one of them. */
export const DESIGN_STEPS: Record<CascadeDesign, readonly ArtifactName[]> = {
  v1: ["01_company", "02_model", "03_influences", "04_story", "05_scenario"],
  causal: ["01_company", "02_model", "03a_causal_map", "03b_processes"],
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
  const rejected = (name: ArtifactName) => (n: number, value: unknown) => {
    writeFileSync(join(dir, `${name}.rejected-${n}.json`), `${JSON.stringify(value, null, 2)}\n`);
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
    return { dir, company, model, causalMap, processes };
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
    const res = await a5Detail(
      opts.llm,
      { input, runId: opts.runId, model, influences, story },
      {
        onEvent: opts.onEvent,
        signal: opts.signal,
        verify: opts.verify,
        // kept next to the artifacts so a failed A5 can be inspected or fixed by hand
        onRejected: rejected("05_scenario"),
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
