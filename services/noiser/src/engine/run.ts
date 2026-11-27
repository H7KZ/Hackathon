/**
 * Engine entry point (SPEC §3.C). Pure: scenario + seed in, in-memory tables out.
 * Persisting to DuckDB is @s2d/dataer's job.
 */
import type { RunResult } from "@s2d/schema/run";
import type { Scenario } from "@s2d/schema/scenario";

export const ENGINE_VERSION = "0.1.0";

export interface RunOptions {
  seed?: number;
  /** Multiplies entity counts and arrival rates (A5 loop uses 0.2). */
  scale?: number;
}

export function runScenario(_scenario: Scenario, _opts: RunOptions = {}): RunResult {
  // TDD: implement against tests/unit/engine.test.ts (currently todo).
  throw new Error("runScenario: not implemented yet");
}
