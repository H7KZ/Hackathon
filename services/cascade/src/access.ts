/**
 * Access functions for the API and CLI, same pattern as @s2d/noiser `generate()`:
 * bad input and agent failures come back as `{ ok: false, errors: { path, message }[] }`, never thrown.
 * Unexpected errors (fs, bugs) still throw; the API turns them into a 500.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import type { CompileError } from "@s2d/schema/api";
import { ArtifactName, CompanySpec, DataModel, Influences, StoryPlan } from "@s2d/schema/artifacts";
import { Scenario } from "@s2d/schema/scenario";
import { CascadeRunMismatch, CascadeStepError, runCascade, type CascadeOptions } from "./cascade";
import type { CascadeInput } from "./steps";

export type AccessResult<T> = ({ ok: true } & T) | { ok: false; errors: CompileError[] };

export interface RunView {
  runId: string;
  input: CascadeInput;
  /** Raw JSON of every artifact file present in the run dir, keyed by artifact name. */
  artifacts: Partial<Record<ArtifactName, unknown>>;
}

const RUN_ID = /^[A-Za-z0-9_-]+$/;
const INPUT_FILE = "00_input.json";
const SCHEMAS: Record<ArtifactName, z.ZodType> = {
  "01_company": CompanySpec,
  "02_model": DataModel,
  "03_influences": Influences,
  "04_story": StoryPlan,
  "05_scenario": Scenario,
};

const fail = (path: string, message: string) => ({ ok: false as const, errors: [{ path, message }] });

/** Fresh runId, e.g. `run-2026-11-27T20-30-00-000Z`. */
export function newRunId(now: Date): string {
  return `run-${now.toISOString().replace(/[:.]/g, "-")}`;
}

/** Run (or resume) the cascade. Existing artifacts are reused, missing ones are produced by the agents. */
export async function cascade(
  input: CascadeInput,
  opts: CascadeOptions,
): Promise<AccessResult<{ run: RunView }>> {
  if (!RUN_ID.test(opts.runId)) return fail("runId", "runId must match [A-Za-z0-9_-]+");
  if (!input.story.trim()) return fail("story", "story must be a non-empty text");
  if (!input.company.trim()) return fail("company", "company must be a non-empty text");
  try {
    await runCascade(input, opts);
  } catch (err) {
    if (err instanceof CascadeStepError) return fail(err.step, err.message);
    if (err instanceof CascadeRunMismatch) return fail("runId", err.message);
    throw err;
  }
  return getRun(opts.runsDir, opts.runId);
}

/** Ids of all runs in runsDir (dirs that have 00_input.json), sorted. */
export function listRuns(runsDir: string): string[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(runsDir, d.name, INPUT_FILE)))
    .map((d) => d.name)
    .sort();
}

export function getRun(runsDir: string, runId: string): AccessResult<{ run: RunView }> {
  const dir = runDir(runsDir, runId);
  if (!dir) return fail("runId", `Run "${runId}" not found`);
  const input = JSON.parse(readFileSync(join(dir, INPUT_FILE), "utf8")) as CascadeInput;
  const artifacts: RunView["artifacts"] = {};
  for (const name of ArtifactName.options) {
    const file = join(dir, `${name}.json`);
    if (existsSync(file)) artifacts[name] = JSON.parse(readFileSync(file, "utf8"));
  }
  return { ok: true, run: { runId, input, artifacts } };
}

/**
 * Save a hand-edited artifact (SPEC §2 rule 9). It must validate against its schema.
 * Later artifacts are deleted so the next `cascade()` recomputes them from the edit.
 */
export function saveArtifact(
  runsDir: string,
  runId: string,
  name: string,
  raw: unknown,
): AccessResult<{ invalidated: ArtifactName[] }> {
  const artifact = ArtifactName.safeParse(name);
  if (!artifact.success)
    return fail("name", `Unknown artifact "${name}". Valid: ${ArtifactName.options.join(", ")}`);
  const dir = runDir(runsDir, runId);
  if (!dir) return fail("runId", `Run "${runId}" not found`);

  const parsed = SCHEMAS[artifact.data].safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        path: [artifact.data, ...i.path.map(String)].join("."),
        message: i.message,
      })),
    };
  }

  writeFileSync(join(dir, `${artifact.data}.json`), `${JSON.stringify(parsed.data, null, 2)}\n`);
  const later = ArtifactName.options.slice(ArtifactName.options.indexOf(artifact.data) + 1);
  const invalidated = later.filter((n) => existsSync(join(dir, `${n}.json`)));
  for (const n of invalidated) rmSync(join(dir, `${n}.json`));
  return { ok: true, invalidated };
}

/** Path of an existing run, or undefined (also for ids that could escape runsDir). */
function runDir(runsDir: string, runId: string): string | undefined {
  if (!RUN_ID.test(runId)) return undefined;
  const dir = join(runsDir, runId);
  return existsSync(join(dir, INPUT_FILE)) ? dir : undefined;
}
