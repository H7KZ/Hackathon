import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

const ModelId = z
  .string()
  .regex(
    /^(anthropic|openai|groq):.+$/,
    'LLM_MODEL must be "anthropic:<model>", "openai:<model>" or "groq:<model>"',
  );

/** LLM_MODEL_<SCHEMA_NAME>, e.g. LLM_MODEL_05_SCENARIO, overrides the model for that call only. */
const PER_SCHEMA = /^LLM_MODEL_([A-Z0-9_]+)$/;

const Env = z.object({
  LLM_MODEL: ModelId.default("anthropic:claude-sonnet-5-5"),
  LLM_OFFLINE: z
    .enum(["0", "1", "true", "false"])
    .default("0")
    .transform((v) => v === "1" || v === "true"),
  LLM_CACHE_DIR: z.string().optional(),
});

export interface LlmEnv {
  model: string;
  /** schemaName (lower case, e.g. "05_scenario") -> model id. */
  modelBySchema: Record<string, string>;
  offline: boolean;
  cacheDir: string;
}

/** Walks up from `start` to the folder containing pnpm-workspace.yaml. */
export function findRepoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

/** Parse LLM env at the boundary; throws a readable error on misconfiguration. */
export function readLlmEnv(env: NodeJS.ProcessEnv = process.env): LlmEnv {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid LLM env:\n${z.prettifyError(parsed.error)}`);
  }
  const modelBySchema: Record<string, string> = {};
  const issues: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    const m = PER_SCHEMA.exec(k);
    if (!m?.[1] || v === undefined || v === "") continue;
    const id = ModelId.safeParse(v);
    if (id.success) modelBySchema[m[1].toLowerCase()] = id.data;
    else issues.push(`${k}: ${id.error.issues[0]?.message ?? "invalid"}`);
  }
  if (issues.length > 0) throw new Error(`Invalid LLM env:\n${issues.join("\n")}`);
  return {
    model: parsed.data.LLM_MODEL,
    modelBySchema,
    offline: parsed.data.LLM_OFFLINE,
    cacheDir: parsed.data.LLM_CACHE_DIR ?? join(findRepoRoot(), ".cache", "llm"),
  };
}
