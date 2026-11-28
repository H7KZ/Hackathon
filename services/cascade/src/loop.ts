/**
 * Repair loop shared by A5 and whatIf (docs/cascade-design.md D5/D6): ask the agent, assemble the
 * scenario in code, `compileScenario`, feed the errors back. An optional `verify` (A5: the story gate)
 * runs the engine and the expectations on a scenario that compiled.
 */
import { createHash } from "node:crypto";
import { LlmOutputInvalid, type Llm, type ObjectRequest } from "@s2d/llm";
import { compileScenario } from "@s2d/noiser";
import type { CompileError } from "@s2d/schema/api";
import type { ArtifactName } from "@s2d/schema/artifacts";
import type { Scenario } from "@s2d/schema/scenario";
import type { OnEvent } from "./events";

export const MAX_ITERATIONS = 3;

export type Feedback = CompileError[] | string[];

/** How far an attempt got: later stages are better (a story-gate failure beats a compile error). */
export type Stage = "schema" | "compile" | "check" | "story gate";
const STAGE_RANK: Record<Stage, number> = { schema: 0, compile: 1, check: 2, "story gate": 3 };

/** One rejected attempt, for the history shown to the agent and for resuming. */
export interface Attempt {
  n: number;
  stage: Stage;
  feedback: Feedback;
}

/** Higher is better: the stage reached, then fewer errors. */
export const attemptRank = (a: Pick<Attempt, "stage" | "feedback">) =>
  STAGE_RANK[a.stage] * 1000 - a.feedback.length;

export interface RepairLoopOptions<T> {
  step: ArtifactName;
  /**
   * One agent call. `feedback` is empty on the first iteration; `previous` is the last agent output.
   * Put `n` into the prompt on retries: an identical prompt would replay the same cached answer.
   */
  ask: (feedback: Feedback, previous: unknown, n: number, history: readonly Attempt[]) => Promise<T>;
  /**
   * A5: `previous`/`feedback` are the BEST rejected attempt so far (stage reached, then fewest errors),
   * not the last one, so a regression is never what the agent edits next. Default: the last attempt.
   */
  keepBest?: boolean | undefined;
  /** Deterministic code: agent output -> candidate scenario, or errors (e.g. a patch on a non-Param). */
  assemble: (output: T) => { ok: true; scenario: unknown } | { ok: false; errors: CompileError[] };
  onEvent?: OnEvent | undefined;
  signal?: AbortSignal | undefined;
  maxIterations?: number;
  /** Story checks on a compiled scenario (see checks.ts); errors are fed back like compile errors. */
  check?: ((scenario: Scenario) => CompileError[]) | undefined;
  /** Slow checks on a scenario that compiled and passed `check` (e.g. the story gate, gate.ts). */
  verify?: ((scenario: Scenario) => Promise<CompileError[]>) | undefined;
  /** Start as a repair: errors found later (e.g. the story gate on 05) and the output they refer to. */
  initial?: { feedback: Feedback; previous: unknown; history?: Attempt[] | undefined } | undefined;
  /** Number of the first attempt (default 1): a resumed repair continues the numbering, so its prompts are new. */
  firstN?: number | undefined;
  /** A rejected attempt (raw agent output or assembled scenario) and why, e.g. to keep it or resume from it. */
  onRejected?: ((n: number, value: unknown, feedback: Feedback, stage: Stage) => void) | undefined;
  /**
   * Out of attempts, but some reached the story gate (compiled, passed the checks, ran): return the best
   * of those with `misses` instead of failing. A user-edited story can contradict a fixed hypothesis
   * that no parameter change can satisfy (user run: demand back to normal in March, "sales grow in May").
   */
  acceptGateMisses?: boolean | undefined;
}

export type RepairResult<T> =
  | { ok: true; scenario: Scenario; output: T; iterations: number; misses?: Feedback }
  | { ok: false; feedback: Feedback; iterations: number };

export async function repairLoop<T>(opts: RepairLoopOptions<T>): Promise<RepairResult<T>> {
  const max = opts.maxIterations ?? MAX_ITERATIONS;
  let feedback: Feedback = opts.initial?.feedback ?? [];
  let previous: unknown = opts.initial?.previous;
  const history: Attempt[] = [...(opts.initial?.history ?? [])];
  // the best attempt so far; a resumed repair starts from the attempt it was given
  let best: { rank: number; previous: unknown; feedback: Feedback } | undefined =
    opts.initial && opts.keepBest
      ? {
          rank: Math.max(...history.map(attemptRank), Number.NEGATIVE_INFINITY),
          previous: opts.initial.previous,
          feedback: opts.initial.feedback,
        }
      : undefined;
  const reject = (n: number, value: unknown, fb: Feedback, stage: Stage, raw: unknown) => {
    history.push({ n, stage, feedback: fb });
    opts.onRejected?.(n, value, fb, stage);
    const rank = attemptRank({ stage, feedback: fb });
    if (opts.keepBest && best && rank < best.rank) {
      ({ previous, feedback } = best);
      return;
    }
    if (raw !== undefined) previous = raw;
    feedback = fb;
    if (opts.keepBest) best = { rank, previous, feedback };
  };
  /** best attempt that ran and failed only the story gate (acceptGateMisses) */
  let gateBest: { scenario: Scenario; output: T; misses: Feedback } | undefined;
  const first = opts.firstN ?? 1;
  for (let n = first; n < first + max; n++) {
    opts.signal?.throwIfAborted();
    let output: T;
    try {
      output = await opts.ask(feedback, previous, n, history);
    } catch (err) {
      // Schema-invalid agent output is a repairable mistake, not a crash.
      if (!(err instanceof LlmOutputInvalid)) throw err;
      const fb = [...describeShape(err.raw), err.issues];
      opts.onEvent?.({ type: "loop.iteration", step: opts.step, n, ok: false, feedback: fb });
      reject(n, err.raw, fb, "schema", err.raw);
      continue;
    }
    const assembled = opts.assemble(output);
    const compiledRaw = assembled.ok ? compileScenario(assembled.scenario) : assembled;
    let checkErrors = compiledRaw.ok ? (opts.check?.(compiledRaw.scenario) ?? []) : [];
    let stage: Stage = compiledRaw.ok ? "check" : "compile";
    if (compiledRaw.ok && checkErrors.length === 0 && opts.verify) {
      opts.signal?.throwIfAborted();
      checkErrors = await opts.verify(compiledRaw.scenario);
      stage = "story gate";
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
    if (
      stage === "story gate" &&
      compiledRaw.ok &&
      (!gateBest || checkErrors.length < gateBest.misses.length)
    )
      gateBest = { scenario: compiledRaw.scenario, output, misses: checkErrors };
    reject(n, assembled.ok ? assembled.scenario : output, compiled.errors, stage, output);
  }
  if (opts.acceptGateMisses && gateBest) return { ok: true, ...gateBest, iterations: max };
  return { ok: false, feedback, iterations: max };
}

/** A rejected A1–A4 answer, kept so a new run of the step continues from it (`withSchemaRetry` resume). */
export interface RejectedAnswer {
  /** Identity of the step's first prompt: a resume only applies to the same inputs. */
  key: string;
  n: number;
  raw: unknown;
  issues: string;
  byCheck: boolean;
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
    /**
     * The last rejected answer of an earlier run for the same first prompt (`key`). With the disk
     * cache, starting over at attempt 1 would replay the same rejected answers (user run 76384e44:
     * "Zkusit znovu" failed A4 three times in a row in milliseconds), so the run continues from it.
     */
    resume?: ((key: string) => RejectedAnswer | undefined) | undefined;
    /** Called for every rejected answer (persist it for `resume`). */
    onRejected?: ((answer: RejectedAnswer) => void) | undefined;
  } = {},
): Llm {
  const max = opts.maxIterations ?? MAX_ITERATIONS;
  return {
    async object<T>(req: ObjectRequest<T>): Promise<T> {
      const key = promptKey(req);
      const earlier = opts.resume?.(key);
      let failed: { err: LlmOutputInvalid; byCheck: boolean } | undefined = earlier && {
        err: new LlmOutputInvalid(req.schemaName, earlier.issues, earlier.raw),
        byCheck: earlier.byCheck,
      };
      const first = earlier ? earlier.n + 1 : 1;
      for (let n = first; ; n++) {
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
          opts.onRejected?.({ key, n, raw: err.raw, issues: err.issues, byCheck });
          if (n >= first + max - 1) throw err;
          failed = { err, byCheck };
        }
      }
    },
  };
}

/** Identity of a step's first request (model aside): resuming applies only to the same inputs. */
function promptKey(req: ObjectRequest<unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify([req.schemaName, req.instructions ?? "", req.prompt]))
    .digest("hex")
    .slice(0, 16);
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

/**
 * Earlier attempts for the agent, oldest first: what each one failed on, and which errors came back
 * after an attempt that did not have them (podpora, live run 3: root-rule and story-gate errors alternated).
 */
export function formatHistory(history: readonly Attempt[]): string {
  const sig = (f: Feedback[number]) => (typeof f === "string" ? f : f.path + ": " + f.message).slice(0, 90);
  const short = (f: Feedback[number]) => {
    const t = typeof f === "string" ? f : `${f.path}: ${f.message}`;
    return t.length > 220 ? `${t.slice(0, 217)}...` : t;
  };
  const lines = history.map((a) => {
    const shown = a.feedback.slice(0, 4).map(short).join(" | ");
    const more = a.feedback.length > 4 ? ` (+${a.feedback.length - 4} more)` : "";
    return `- attempt ${a.n} (${a.stage}): ${shown}${more}`;
  });
  const back: string[] = [];
  history.forEach((a, k) => {
    for (const f of a.feedback) {
      const s = sig(f);
      const firstSeen = history.findIndex((h) => h.feedback.some((x) => sig(x) === s));
      const gap = history.slice(firstSeen + 1, k).some((h) => !h.feedback.some((x) => sig(x) === s));
      if (firstSeen < k && gap) back.push(`- "${short(f).slice(0, 120)}" came back in attempt ${a.n}`);
    }
  });
  return [
    ...lines,
    ...(back.length > 0
      ? ["Errors that came back after being fixed (do not undo the change that fixed them):", ...back]
      : []),
  ].join("\n");
}
