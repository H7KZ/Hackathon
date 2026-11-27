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

export const aiSdkGenerate: Generate = async ({ schema, instructions, prompt, model }) => {
  try {
    const result = await generateText({
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
    });
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
 * The zod schema as JSON Schema, rewritten where providers reject valid JSON Schema. Tuples
 * (`items: [...]`, e.g. CurveDef.clamp) are refused by Anthropic structured output ("Array types must
 * be specified with a single object schema for 'items'"), so they become plain arrays with the shape
 * in the description. Validation still runs the original zod schema, so the tuple is enforced.
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
  for (const [k, v] of Object.entries(node)) out[k] = untuple(v);
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

function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
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
  const cache = new DiskCache(opts.cacheDir ?? env.cacheDir);
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
