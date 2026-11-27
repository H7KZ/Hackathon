/**
 * Engine entry point (SPEC §3.C). Pure: scenario + seed in, in-memory tables out.
 * Persisting to DuckDB is @s2d/dataer's job.
 */
import type { RunResult } from "@s2d/schema/run";
import type { Scenario } from "@s2d/schema/scenario";
import { EngineError } from "./errors";

export const ENGINE_VERSION = "0.1.0";

export interface RunOptions {
  seed?: number;
  /** Multiplies entity counts and arrival rates (A5 loop uses 0.2). */
  scale?: number;
}

export function resolveOptions(scenario: Scenario, opts: RunOptions): { seed: number; scale: number } {
  const seed = opts.seed ?? scenario.meta.seed;
  const scale = opts.scale ?? scenario.meta.scale ?? 1;
  if (!Number.isSafeInteger(seed)) {
    throw new EngineError("options.seed", `seed must be an integer, got ${seed}.`);
  }
  if (!(Number.isFinite(scale) && scale > 0)) {
    throw new EngineError(
      "options.scale",
      `scale must be a finite number > 0 (e.g. 0.2 or 1), got ${scale}.`,
    );
  }
  return { seed, scale };
}

export function runScenario(scenario: Scenario, opts: RunOptions = {}): RunResult {
  resolveOptions(scenario, opts);
  // TDD: implement against tests/unit/engine.test.ts (currently todo).
  throw new Error("runScenario: not implemented yet");
}
