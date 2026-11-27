/**
 * The one call API and CLI need: compile (validate + topo order) and run the engine.
 * Never throws for bad input: compiler and engine errors come back as `{ path, message }[]`.
 */
import type { CompileError } from "@s2d/schema/api";
import type { RunResult } from "@s2d/schema/run";
import { compileScenario } from "./compiler/validate";
import { EngineError } from "./engine/errors";
import { runScenario, type RunOptions } from "./engine/run";

export type GenerateResult =
  { ok: true; run: RunResult; order: string[] } | { ok: false; errors: CompileError[] };

export function generate(input: unknown, opts: RunOptions = {}): GenerateResult {
  const compiled = compileScenario(input);
  if (!compiled.ok) return compiled;
  try {
    return { ok: true, run: runScenario(compiled.scenario, opts), order: compiled.order };
  } catch (err) {
    if (err instanceof EngineError) return { ok: false, errors: [{ path: err.path, message: err.message }] };
    throw err;
  }
}
