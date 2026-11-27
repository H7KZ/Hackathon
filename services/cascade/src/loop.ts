/**
 * Repair loop shared by A5 and whatIf (docs/cascade-design.md D5/D6): ask the agent, assemble the
 * scenario in code, `compileScenario`, feed the errors back. No engine run, no expectations here.
 */
import { LlmOutputInvalid } from "@s2d/llm";
import { compileScenario } from "@s2d/noiser";
import type { CompileError } from "@s2d/schema/api";
import type { ArtifactName } from "@s2d/schema/artifacts";
import type { Scenario } from "@s2d/schema/scenario";
import type { OnEvent } from "./events";

export const MAX_ITERATIONS = 3;

export type Feedback = CompileError[] | string[];

export interface RepairLoopOptions<T> {
  step: ArtifactName;
  /**
   * One agent call. `feedback` is empty on the first iteration; `previous` is the last agent output.
   * Put `n` into the prompt on retries: an identical prompt would replay the same cached answer.
   */
  ask: (feedback: Feedback, previous: T | undefined, n: number) => Promise<T>;
  /** Deterministic code: agent output -> candidate scenario, or errors (e.g. a patch on a non-Param). */
  assemble: (output: T) => { ok: true; scenario: unknown } | { ok: false; errors: CompileError[] };
  onEvent?: OnEvent | undefined;
  signal?: AbortSignal | undefined;
  maxIterations?: number;
}

export type RepairResult<T> =
  | { ok: true; scenario: Scenario; output: T; iterations: number }
  | { ok: false; feedback: Feedback; iterations: number };

export async function repairLoop<T>(opts: RepairLoopOptions<T>): Promise<RepairResult<T>> {
  const max = opts.maxIterations ?? MAX_ITERATIONS;
  let feedback: Feedback = [];
  let previous: T | undefined;
  for (let n = 1; n <= max; n++) {
    opts.signal?.throwIfAborted();
    let output: T;
    try {
      output = await opts.ask(feedback, previous, n);
    } catch (err) {
      // Schema-invalid agent output is a repairable mistake, not a crash.
      if (!(err instanceof LlmOutputInvalid)) throw err;
      feedback = [err.issues];
      opts.onEvent?.({ type: "loop.iteration", step: opts.step, n, ok: false, feedback });
      continue;
    }
    previous = output;
    const assembled = opts.assemble(output);
    const compiled = assembled.ok ? compileScenario(assembled.scenario) : assembled;
    opts.onEvent?.({
      type: "loop.iteration",
      step: opts.step,
      n,
      ok: compiled.ok,
      feedback: compiled.ok ? [] : compiled.errors,
    });
    if (compiled.ok) return { ok: true, scenario: compiled.scenario, output, iterations: n };
    feedback = compiled.errors;
  }
  return { ok: false, feedback, iterations: max };
}

export function formatFeedback(feedback: Feedback): string {
  return feedback.map((f) => (typeof f === "string" ? `- ${f}` : `- ${f.path}: ${f.message}`)).join("\n");
}
