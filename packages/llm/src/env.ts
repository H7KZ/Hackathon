import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

const Env = z.object({
  LLM_MODEL: z
    .string()
    .regex(
      /^(anthropic|openai|groq):.+$/,
      'LLM_MODEL must be "anthropic:<model>", "openai:<model>" or "groq:<model>"',
    )
    .default("anthropic:claude-sonnet-5-5"),
  LLM_OFFLINE: z
    .enum(["0", "1", "true", "false"])
    .default("0")
    .transform((v) => v === "1" || v === "true"),
  LLM_CACHE_DIR: z.string().optional(),
});

export interface LlmEnv {
  model: string;
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
  return {
    model: parsed.data.LLM_MODEL,
    offline: parsed.data.LLM_OFFLINE,
    cacheDir: parsed.data.LLM_CACHE_DIR ?? join(findRepoRoot(), ".cache", "llm"),
  };
}
