/**
 * The ONLY entry point to LLMs in the repo (AGENTS.md rule 7).
 * Structured output, validated by zod at the boundary, cached on disk so the demo runs offline.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { generateText, jsonSchema, NoObjectGeneratedError, Output, zodSchema, type LanguageModel } from "ai";
import { z } from "zod";
import { DiskCache, cacheKey } from "./cache";
import { readLlmEnv } from "./env";

export interface ObjectRequest<T> {
  /** Stable name used in cache entries and logs, e.g. "a1_company". */
  schemaName: string;
  schema: z.ZodType<T>;
  instructions?: string;
  prompt: string;
  /** Overrides LLM_MODEL for this call. */
  model?: string;
}

/** Raw provider call. Swap for a fake in tests (see @s2d/test-utils fakeGenerate). */
export type Generate = (req: {
  schemaName: string;
  schema: z.ZodType;
  instructions: string;
  prompt: string;
  model: string;
}) => Promise<unknown>;

export class LlmCacheMiss extends Error {
  constructor(schemaName: string, key: string) {
    super(`LLM_OFFLINE=1 and no cache entry for ${schemaName} (key ${key}). Run once online to record it.`);
    this.name = "LlmCacheMiss";
  }
}

export class LlmOutputInvalid extends Error {
  constructor(
    schemaName: string,
    readonly issues: string,
    /** The rejected output, so a caller can show the model its own answer when asking for a fix. */
    readonly raw?: unknown,
  ) {
    super(`LLM output for ${schemaName} failed validation:\n${issues}`);
    this.name = "LlmOutputInvalid";
  }
}

/** Groq speaks the OpenAI Chat Completions API (its Responses API is partial), key in GROQ_API_KEY. */
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/** "anthropic:claude-sonnet-5-5" / "groq:openai/gpt-oss-120b" -> provider model instance. */
export function resolveModel(id: string): LanguageModel {
  const [provider, ...rest] = id.split(":");
  const name = rest.join(":");
  if (provider === "anthropic") return anthropic(name);
  if (provider === "openai") return openai(name);
  if (provider === "groq")
    return createOpenAI({ name: "groq", baseURL: GROQ_BASE_URL, apiKey: process.env.GROQ_API_KEY }).chat(
      name,
    );
  throw new Error(`Unknown LLM provider in "${id}"`);
}

/** Per-request limit (LLM_TIMEOUT_MS, default 4 min): one hung HTTP call must not block a job forever. */
const timeoutMs = (schemaName: string) =>
  Number(process.env.LLM_TIMEOUT_MS) ||
  // a healthy detective step answers in 2–12 s (live, LLM_DEBUG=1); stalls happen: retry soon
  (schemaName.startsWith("detective") ? 60_000 : 240_000);
const isTimeout = (e: unknown) =>
  e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

/** Runs one model request with a timeout; a timed-out request is retried once (live: a step hung 15+ min). */
async function withTimeout<T>(schemaName: string, run: (abortSignal: AbortSignal) => Promise<T>): Promise<T> {
  const ms = timeoutMs(schemaName);
  // LLM_DEBUG=1: one stderr line per request (duration, finish reason, output tokens) to tell a slow
  // long answer from a stalled connection
  const debug = process.env.LLM_DEBUG === "1";
  for (let attempt = 1; ; attempt++) {
    const t0 = Date.now();
    try {
      const out = await run(AbortSignal.timeout(ms));
      if (debug) {
        const r = out as { finishReason?: string; usage?: { outputTokens?: number } };
        console.error(
          `[llm] ${schemaName} ${String(Date.now() - t0)} ms ${r.finishReason ?? ""} out=${String(r.usage?.outputTokens ?? "?")}`,
        );
      }
      return out;
    } catch (err) {
      if (debug) console.error(`[llm] ${schemaName} ${String(Date.now() - t0)} ms failed: ${String(err)}`);
      if (!isTimeout(err)) throw err;
      if (attempt >= 2)
        throw new Error(
          `The model did not answer within ${String(Math.round(ms / 1000))} s (2 tries, ${schemaName}).`,
          { cause: err },
        );
    }
  }
}

export const aiSdkGenerate: Generate = async ({ schemaName, schema, instructions, prompt, model }) => {
  if (model.startsWith("anthropic:"))
    return anthropicJsonText({ schemaName, schema, instructions, prompt, model });
  try {
    const result = await withTimeout(schemaName, (abortSignal) =>
      generateText({
        abortSignal,
        model: resolveModel(model),
        // an empty system block is rejected by some providers
        instructions: instructions || undefined,
        prompt,
        output: Output.object({ schema: providerSafeSchema(schema) }),
        // Groq: strict mode needs every field required (ours has optional ones; zod validates anyway),
        // and gpt-oss spends most of the output budget on reasoning unless told otherwise.
        ...(model.startsWith("groq:") && {
          providerOptions: { openai: { strictJsonSchema: false, reasoningEffort: "low" } },
        }),
        // OpenAI strict mode needs every property required; ours has optional ones (zod validates anyway)
        ...(model.startsWith("openai:") && { providerOptions: { openai: { strictJsonSchema: false } } }),
      }),
    );
    return result.output;
  } catch (err) {
    if (!NoObjectGeneratedError.isInstance(err)) throw err;
    if (err.finishReason === "length")
      throw new Error(`LLM output was cut off (token limit) for ${model}; the JSON is incomplete.`, {
        cause: err,
      });
    // Complete JSON that misses the schema: hand it back so the caller's zod parse reports
    // LlmOutputInvalid, which the cascade repair loops turn into feedback for the agent.
    const raw = parseJson(err.text);
    if (raw === undefined) throw err;
    return raw;
  }
};

/**
 * Anthropic: the JSON Schema goes into the system prompt and the answer is plain text. Our schemas
 * exceed what native `output_format` accepts (more than 10 optional properties, open maps), so the AI
 * SDK fell back to a forced "json" tool, which Sonnet 5.5 rejects ("toolChoice 'required' is not
 * supported", a warning on every call, then `auto` and often prose around the JSON anyway). The cache
 * key is computed from the caller's instructions, not this suffix, so recordings stay valid.
 */
async function anthropicJsonText({
  schemaName,
  schema,
  instructions,
  prompt,
  model,
}: {
  schemaName: string;
  schema: z.ZodType;
  instructions: string;
  prompt: string;
  model: string;
}): Promise<unknown> {
  const js = JSON.stringify(untuple(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })));
  const directive =
    "Answer with exactly one JSON object and nothing else (no prose, no code fence). " +
    `It must validate against this JSON Schema:\n${js}`;
  const system = instructions ? `${instructions}\n\n${directive}` : directive;
  const read = (r: { text: string; finishReason: string }) => {
    if (r.finishReason === "length")
      throw new Error(`LLM output was cut off (token limit) for ${model}; the JSON is incomplete.`);
    return parseJson(r.text);
  };
  const first = await withTimeout(schemaName, (abortSignal) =>
    generateText({ abortSignal, model: resolveModel(model), instructions: system, prompt }),
  );
  const raw = read(first);
  // valid: done. Otherwise one follow-up turn with the model's own answer and what is wrong with it
  // (live run 5: a detective step answered with prose only, another left out the `action` wrapper;
  // a forced tool used to steer the shape, text mode needs this correction instead)
  const issues =
    raw === undefined
      ? "Your answer contained no JSON object."
      : ((r) =>
          r.success ? undefined : `Your JSON does not match the schema:\n${z.prettifyError(r.error)}`)(
          schema.safeParse(raw),
        );
  if (issues === undefined) return raw;
  const again = await withTimeout(schemaName, (abortSignal) =>
    generateText({
      abortSignal,
      model: resolveModel(model),
      instructions: system,
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: first.text },
        { role: "user", content: `${issues}\nReply with only the corrected JSON object.` },
      ],
    }),
  );
  const retried = read(again);
  if (retried === undefined) throw new Error(`LLM answer for ${model} contained no JSON object.`);
  // still invalid: the caller's zod parse reports it (repair loops turn it into feedback)
  return retried;
}

/**
 * The zod schema as JSON Schema, rewritten where providers reject valid JSON Schema. Tuples
 * (`items: [...]`, e.g. CurveDef.clamp) are refused by Anthropic structured output ("Array types must
 * be specified with a single object schema for 'items'"), so they become plain arrays with the shape
 * in the description. `oneOf` (zod discriminated unions) is refused by OpenAI structured output
 * ("'oneOf' is not permitted"); with a discriminator the branches are exclusive anyway, so it becomes
 * `anyOf`. Validation still runs the original zod schema, so tuples and unions are enforced. The cache
 * key is computed from the zod schema, not from this rewrite, so recordings stay valid.
 */
export function providerSafeSchema<T>(schema: z.ZodType<T>) {
  const zs = zodSchema(schema);
  return jsonSchema<T>(() => untuple(zs.jsonSchema) as typeof zs.jsonSchema, {
    ...(zs.validate && { validate: zs.validate }),
  });
}

function untuple(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(untuple);
  if (typeof node !== "object" || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k === "oneOf" ? "anyOf" : k] = untuple(v);
  const items = out.items;
  if (Array.isArray(items)) {
    const unique = [...new Map(items.map((i) => [JSON.stringify(i), i])).values()];
    out.items = unique.length === 1 ? unique[0] : { anyOf: unique };
    delete out.additionalItems;
    delete out.minItems;
    delete out.maxItems;
    const shape = `exactly ${items.length} items`;
    out.description = typeof out.description === "string" ? `${out.description} (${shape})` : shape;
  }
  return out;
}

/**
 * The JSON in a model's text answer: the whole text, else a fenced ```json block, else the span from
 * the first "{" to the last "}". Models without forced tool choice (Sonnet 5.5: toolChoice "required"
 * falls back to "auto") sometimes explain their fix in prose and put the object in a code block; a
 * live cascade run crashed on that instead of validating the object.
 */
function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/i.exec(text)?.[1];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  const span = first >= 0 && last > first ? text.slice(first, last + 1) : undefined;
  for (const candidate of [text, fenced, span]) {
    if (candidate === undefined) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

export interface LlmOptions {
  generate?: Generate;
  cacheDir?: string;
  offline?: boolean;
  model?: string;
  /** Per-call model by schemaName (e.g. { "05_scenario": "anthropic:claude-sonnet-5-5" }). */
  modelBySchema?: Record<string, string>;
}

export interface Llm {
  object<T>(req: ObjectRequest<T>): Promise<T>;
}

export function createLlm(opts: LlmOptions = {}): Llm {
  const needEnv = opts.cacheDir === undefined || opts.offline === undefined || opts.model === undefined;
  const env = needEnv ? readLlmEnv() : { cacheDir: "", offline: false, model: "", modelBySchema: {} };
  const cache = new DiskCache(opts.cacheDir ?? env.cacheDir, process.env.LLM_CACHE_TRACE || undefined);
  const offline = opts.offline ?? env.offline;
  const defaultModel = opts.model ?? env.model;
  const modelBySchema = opts.modelBySchema ?? env.modelBySchema;
  const generate = opts.generate ?? aiSdkGenerate;

  return {
    async object<T>(req: ObjectRequest<T>): Promise<T> {
      const model = req.model ?? modelBySchema[req.schemaName] ?? defaultModel;
      const instructions = req.instructions ?? "";
      const key = cacheKey({
        model,
        instructions,
        prompt: req.prompt,
        jsonSchema: z.toJSONSchema(req.schema, { io: "input", unrepresentable: "any" }),
      });

      // Cache stores the RAW provider output so schemas with transforms/defaults re-parse cleanly.
      const hit = cache.get(key);
      if (hit) {
        const parsed = req.schema.safeParse(hit.output);
        if (parsed.success) return parsed.data;
        if (offline) throw new LlmOutputInvalid(req.schemaName, z.prettifyError(parsed.error), hit.output);
        // online: a stale/invalid entry is treated as a miss and re-recorded below
      } else if (offline) {
        throw new LlmCacheMiss(req.schemaName, key);
      }

      const raw = await generate({
        schemaName: req.schemaName,
        schema: req.schema,
        instructions,
        prompt: req.prompt,
        model,
      });
      const value = parseOrThrow(req, raw);
      cache.set({ key, model, schemaName: req.schemaName, output: raw });
      return value;
    },
  };
}

function parseOrThrow<T>(req: ObjectRequest<T>, raw: unknown): T {
  const parsed = req.schema.safeParse(raw);
  if (!parsed.success) throw new LlmOutputInvalid(req.schemaName, z.prettifyError(parsed.error), raw);
  return parsed.data;
}
