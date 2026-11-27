/**
 * Cascade orchestrator (SPEC §3.A). Every step writes runs/<runId>/NN_name.json.
 * An existing artifact file is reused instead of calling the agent again, so a hand-edited
 * artifact re-runs only the steps after it (SPEC §2 rule 9) — delete later files to recompute them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import { LlmCacheMiss, LlmOutputInvalid, type Llm } from "@s2d/llm";
import { CompanySpec, DataModel, Influences, StoryPlan, type ArtifactName } from "@s2d/schema/artifacts";
import { Scenario } from "@s2d/schema/scenario";
import { a5Detail } from "./a5_detail";
import type { OnEvent } from "./events";
import { formatFeedback } from "./loop";
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
}

const ORDER = ["01_company", "02_model", "03_influences", "04_story", "05_scenario"] as const;

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
  const until = opts.until ?? "05_scenario";
  const shouldRun = (name: ArtifactName) => ORDER.indexOf(name) <= ORDER.indexOf(until);

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
  const company = await step("01_company", CompanySpec, () => a1Company(opts.llm, input));
  if (!shouldRun("02_model")) return { dir, company };
  const model = await step("02_model", DataModel, () => a2Model(opts.llm, company));
  if (!shouldRun("03_influences")) return { dir, company, model };
  const influences = await step("03_influences", Influences, () => a3Influences(opts.llm, company, model));
  if (!shouldRun("04_story")) return { dir, company, model, influences };
  const story = await step("04_story", StoryPlan, () => a4Story(opts.llm, input, model, influences));
  if (!shouldRun("05_scenario")) return { dir, company, model, influences, story };
  const scenario = await step("05_scenario", Scenario, async () => {
    const res = await a5Detail(
      opts.llm,
      { input, runId: opts.runId, model, influences, story },
      { onEvent: opts.onEvent, signal: opts.signal },
    );
    if (res.ok) return res.scenario;
    opts.onEvent?.({
      type: "log",
      message: `Krok A5 ani po ${res.iterations} pokusech nesestavil platný scénář. Uprav 04_story nebo nahraj 05_scenario ručně.`,
    });
    throw new CascadeStepError(
      "05_scenario",
      new Error(`Scenario does not compile:\n${formatFeedback(res.feedback)}`),
    );
  });
  return { dir, company, model, influences, story, scenario };
}
