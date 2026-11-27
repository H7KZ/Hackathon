import { join } from "node:path";
import { z } from "zod";
import { findRepoRoot } from "@s2d/llm";

const Env = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
});

export interface ApiConfig {
  port: number;
  corsOrigin: string;
  root: string;
  scenariosDir: string;
  runsDir: string;
  outDir: string;
}

/** Validated at startup so misconfiguration fails fast with a readable message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, root = findRepoRoot()): ApiConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid API env:\n${z.prettifyError(parsed.error)}`);
  return {
    port: parsed.data.API_PORT,
    corsOrigin: parsed.data.CORS_ORIGIN,
    root,
    scenariosDir: join(root, "scenarios"),
    runsDir: join(root, "runs"),
    outDir: join(root, "out"),
  };
}
