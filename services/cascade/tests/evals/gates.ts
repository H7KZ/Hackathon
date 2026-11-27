/**
 * Gate 3 of the agent evals (AGENTS.md "Verification for LLM agents"): the scenario's expectations
 * must pass on the generated data at --seed 42 and on >= 4 of seeds 1..5. Runs engine + evidence the
 * same way the API does (writeRun -> exportSandbox -> openSandbox -> runExpectations).
 */
import { join } from "node:path";
import { exportSandbox, openSandbox, runExpectations, writeRun } from "@s2d/dataer";
import { runScenario } from "@s2d/noiser";
import type { ExpectationResult } from "@s2d/schema/evidence";
import type { Scenario } from "@s2d/schema/scenario";

export const GATE_SEED = 42;
export const ROBUST_SEEDS = [1, 2, 3, 4, 5];
export const MIN_ROBUST_PASSES = 4;

export interface SeedResult {
  seed: number;
  pass: boolean;
  failed: ExpectationResult[];
}

export interface ExpectationGate {
  pass: boolean;
  main: SeedResult;
  robust: SeedResult[];
}

export async function evidenceAt(scenario: Scenario, seed: number, dir: string): Promise<SeedResult> {
  const db = join(dir, `seed-${seed}.duckdb`);
  const sandbox = join(dir, `seed-${seed}.sandbox.duckdb`);
  await writeRun(db, runScenario(scenario, { seed }));
  await exportSandbox(db, sandbox);
  const store = await openSandbox(sandbox);
  try {
    const results = await runExpectations(store, scenario.expectations);
    const failed = results.filter((r) => !r.pass);
    return { seed, pass: failed.length === 0, failed };
  } finally {
    store.close();
  }
}

export async function expectationGate(scenario: Scenario, dir: string): Promise<ExpectationGate> {
  const main = await evidenceAt(scenario, GATE_SEED, dir);
  const robust: SeedResult[] = [];
  for (const seed of ROBUST_SEEDS) robust.push(await evidenceAt(scenario, seed, dir));
  const passes = robust.filter((r) => r.pass).length;
  return { pass: main.pass && passes >= MIN_ROBUST_PASSES, main, robust };
}
