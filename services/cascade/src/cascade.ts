/**
 * Cascade orchestrator (SPEC §3.A). Every step writes runs/<runId>/NN_name.json.
 * An existing artifact file is reused instead of calling the agent again, so a hand-edited
 * artifact re-runs only the steps after it (SPEC §2 rule 9) — delete later files to recompute them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import type { Llm } from "@s2d/llm";
import { CompanySpec, DataModel, Influences, StoryPlan, type ArtifactName } from "@s2d/schema/artifacts";
import { a1Company, a2Model, a3Influences, a4Story, type CascadeInput } from "./steps";

export interface CascadeOptions {
  llm: Llm;
  runsDir: string;
  runId: string;
  /** Stop after this step (inclusive). Default: 04_story until A5 is implemented. */
  until?: Exclude<ArtifactName, "05_scenario">;
  onStep?: (name: ArtifactName, status: "cached" | "done") => void;
}

const ORDER = ["01_company", "02_model", "03_influences", "04_story"] as const;

export async function runCascade(input: CascadeInput, opts: CascadeOptions) {
  const dir = join(opts.runsDir, opts.runId);
  mkdirSync(dir, { recursive: true });
  const until = opts.until ?? "04_story";
  const shouldRun = (name: (typeof ORDER)[number]) => ORDER.indexOf(name) <= ORDER.indexOf(until);

  async function step<T>(name: ArtifactName, schema: z.ZodType<T>, produce: () => Promise<T>): Promise<T> {
    const file = join(dir, `${name}.json`);
    if (existsSync(file)) {
      opts.onStep?.(name, "cached");
      return schema.parse(JSON.parse(readFileSync(file, "utf8")));
    }
    const value = await produce();
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    opts.onStep?.(name, "done");
    return value;
  }

  // Reusing a run dir with a different story would silently mix artifacts of two stories.
  const inputFile = join(dir, "00_input.json");
  const inputJson = `${JSON.stringify(input, null, 2)}\n`;
  if (existsSync(inputFile) && readFileSync(inputFile, "utf8") !== inputJson) {
    throw new Error(`Run "${opts.runId}" was created for a different story/company. Use a new runId.`);
  }
  writeFileSync(inputFile, inputJson);
  const company = await step("01_company", CompanySpec, () => a1Company(opts.llm, input));
  if (!shouldRun("02_model")) return { dir, company };
  const model = await step("02_model", DataModel, () => a2Model(opts.llm, company));
  if (!shouldRun("03_influences")) return { dir, company, model };
  const influences = await step("03_influences", Influences, () => a3Influences(opts.llm, company, model));
  if (!shouldRun("04_story")) return { dir, company, model, influences };
  const story = await step("04_story", StoryPlan, () => a4Story(opts.llm, input, model, influences));
  // TODO(A5): compile -> engine on scale 1 -> expectations -> feedback loop (max 3) -> 05_scenario.json
  return { dir, company, model, influences, story };
}
