/**
 * The ONLY entry point to LLMs in the repo (AGENTS.md rule 7).
 * Structured output, validated by zod at the boundary, cached on disk so the demo runs offline.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { generateText, Output, type LanguageModel } from "ai";
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
  const result = await generateText({
    model: resolveModel(model),
    // an empty system block is rejected by some providers
    instructions: instructions || undefined,
    prompt,
    output: Output.object({ schema }),
    // Groq strict mode needs every field required; our schemas have optional fields, zod validates anyway
    ...(model.startsWith("groq:") && { providerOptions: { openai: { strictJsonSchema: false } } }),
  });
  return result.output;
};

export interface LlmOptions {
  generate?: Generate;
  cacheDir?: string;
  offline?: boolean;
  model?: string;
}

export interface Llm {
  object<T>(req: ObjectRequest<T>): Promise<T>;
}

export function createLlm(opts: LlmOptions = {}): Llm {
  const needEnv = opts.cacheDir === undefined || opts.offline === undefined || opts.model === undefined;
  const env = needEnv ? readLlmEnv() : { cacheDir: "", offline: false, model: "" };
  const cache = new DiskCache(opts.cacheDir ?? env.cacheDir);
  const offline = opts.offline ?? env.offline;
  const defaultModel = opts.model ?? env.model;
  const generate = opts.generate ?? aiSdkGenerate;

  return {
    async object<T>(req: ObjectRequest<T>): Promise<T> {
      const model = req.model ?? defaultModel;
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
        if (offline) throw new LlmOutputInvalid(req.schemaName, z.prettifyError(parsed.error));
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
  if (!parsed.success) throw new LlmOutputInvalid(req.schemaName, z.prettifyError(parsed.error));
  return parsed.data;
}
