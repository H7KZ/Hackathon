/**
 * Repair loop shared by A5 and whatIf (docs/cascade-design.md D5/D6): ask the agent, assemble the
 * scenario in code, `compileScenario`, feed the errors back. An optional `verify` (A5: the story gate)
 * runs the engine and the expectations on a scenario that compiled.
 */
import { LlmOutputInvalid, type Llm, type ObjectRequest } from "@s2d/llm";
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
  ask: (feedback: Feedback, previous: unknown, n: number) => Promise<T>;
  /** Deterministic code: agent output -> candidate scenario, or errors (e.g. a patch on a non-Param). */
  assemble: (output: T) => { ok: true; scenario: unknown } | { ok: false; errors: CompileError[] };
  onEvent?: OnEvent | undefined;
  signal?: AbortSignal | undefined;
  maxIterations?: number;
  /** Story checks on a compiled scenario (see checks.ts); errors are fed back like compile errors. */
  check?: ((scenario: Scenario) => CompileError[]) | undefined;
  /** Slow checks on a scenario that compiled and passed `check` (e.g. the story gate, gate.ts). */
  verify?: ((scenario: Scenario) => Promise<CompileError[]>) | undefined;
  /** A rejected attempt (raw agent output or assembled scenario), e.g. to keep it for debugging. */
  onRejected?: ((n: number, value: unknown) => void) | undefined;
}

export type RepairResult<T> =
  | { ok: true; scenario: Scenario; output: T; iterations: number }
  | { ok: false; feedback: Feedback; iterations: number };

export async function repairLoop<T>(opts: RepairLoopOptions<T>): Promise<RepairResult<T>> {
  const max = opts.maxIterations ?? MAX_ITERATIONS;
  let feedback: Feedback = [];
  let previous: unknown;
  for (let n = 1; n <= max; n++) {
    opts.signal?.throwIfAborted();
    let output: T;
    try {
      output = await opts.ask(feedback, previous, n);
    } catch (err) {
      // Schema-invalid agent output is a repairable mistake, not a crash.
      if (!(err instanceof LlmOutputInvalid)) throw err;
      feedback = [...describeShape(err.raw), err.issues];
      if (err.raw !== undefined) previous = err.raw;
      opts.onRejected?.(n, err.raw);
      opts.onEvent?.({ type: "loop.iteration", step: opts.step, n, ok: false, feedback });
      continue;
    }
    previous = output;
    const assembled = opts.assemble(output);
    const compiledRaw = assembled.ok ? compileScenario(assembled.scenario) : assembled;
    let checkErrors = compiledRaw.ok ? (opts.check?.(compiledRaw.scenario) ?? []) : [];
    if (compiledRaw.ok && checkErrors.length === 0 && opts.verify) {
      opts.signal?.throwIfAborted();
      checkErrors = await opts.verify(compiledRaw.scenario);
    }
    const compiled = checkErrors.length > 0 ? { ok: false as const, errors: checkErrors } : compiledRaw;
    opts.onEvent?.({
      type: "loop.iteration",
      step: opts.step,
      n,
      ok: compiled.ok,
      feedback: compiled.ok ? [] : compiled.errors,
    });
    if (compiled.ok) return { ok: true, scenario: compiled.scenario, output, iterations: n };
    opts.onRejected?.(n, assembled.ok ? assembled.scenario : output);
    feedback = compiled.errors;
  }
  return { ok: false, feedback, iterations: max };
}

/**
 * Wraps an Llm so a schema-invalid answer is re-asked with the zod issues appended to the prompt
 * (A1–A4 have no compile step; A5/whatIf use repairLoop). Emits `loop.iteration` per attempt.
 */
export function withSchemaRetry(
  llm: Llm,
  step: ArtifactName,
  opts: {
    onEvent?: OnEvent | undefined;
    signal?: AbortSignal | undefined;
    maxIterations?: number;
    /** Extra checks on the schema-valid value; errors are fed back like schema issues. */
    check?: ((value: unknown) => CompileError[]) | undefined;
  } = {},
): Llm {
  const max = opts.maxIterations ?? MAX_ITERATIONS;
  return {
    async object<T>(req: ObjectRequest<T>): Promise<T> {
      let failed: { err: LlmOutputInvalid; byCheck: boolean } | undefined;
      for (let n = 1; ; n++) {
        opts.signal?.throwIfAborted();
        const prompt =
          failed === undefined
            ? req.prompt
            : `${req.prompt}\n\n${fixRequest(n - 1, failed.err, failed.byCheck)}`;
        let byCheck = false;
        try {
          const value = await llm.object({ ...req, prompt });
          const problems = opts.check?.(value) ?? [];
          byCheck = problems.length > 0;
          if (byCheck) throw new LlmOutputInvalid(req.schemaName, formatFeedback(problems), value);
          if (n > 1) opts.onEvent?.({ type: "loop.iteration", step, n, ok: true, feedback: [] });
          return value;
        } catch (err) {
          if (!(err instanceof LlmOutputInvalid)) throw err;
          opts.onEvent?.({ type: "loop.iteration", step, n, ok: false, feedback: [err.issues] });
          if (n >= max) throw err;
          failed = { err, byCheck };
        }
      }
    },
  };
}

/**
 * A hint when the answer is not one plain object, or is the object wrapped in a single key
 * (e.g. {"scenario": {...}}). Correct top-level keys get no hint: the schema issues say enough.
 */
export function describeShape(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return [`Your answer was ${Array.isArray(raw) ? "an array" : typeof raw}, expected one JSON object.`];
  const entries = Object.entries(raw);
  const [only] = entries;
  if (entries.length !== 1 || !only || typeof only[1] !== "object" || only[1] === null) return [];
  return [`Your answer wrapped everything in "${only[0]}"; put the fields directly at the top level.`];
}

/** Retry section: the model's own rejected answer + the issues, so it edits instead of starting over. */
function fixRequest(attempt: number, err: LlmOutputInvalid, byCheck: boolean): string {
  return [
    byCheck
      ? `## Your previous answer (attempt ${attempt}) is valid JSON but fails the story checks`
      : `## Your previous answer (attempt ${attempt}) failed schema validation`,
    byCheck
      ? "Return the corrected object: fix every listed problem (add or change what it asks for); keep everything else unchanged."
      : "Return the same object with ONLY the listed paths fixed; keep everything else unchanged.",
    err.raw === undefined ? "" : `### Previous answer\n${JSON.stringify(err.raw)}`,
    `### Issues\n${err.issues}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatFeedback(feedback: Feedback): string {
  return feedback.map((f) => (typeof f === "string" ? `- ${f}` : `- ${f.path}: ${f.message}`)).join("\n");
}
