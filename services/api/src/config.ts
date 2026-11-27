import { join } from "node:path";
import { z } from "zod";
import { findRepoRoot } from "@s2d/llm";

const SERVICES = ["cascade", "noiser", "dataer"] as const;
export type FakeService = (typeof SERVICES)[number];

const Env = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  /** Services to replace with deterministic fakes (no LLM, no DuckDB): "cascade,noiser,dataer" or "all". */
  API_FAKE: z
    .string()
    .default("")
    .transform((s) =>
      (s.trim() === "all" ? [...SERVICES] : s.split(",")).map((x) => x.trim()).filter(Boolean),
    )
    .pipe(z.array(z.enum(SERVICES, { error: `must be a comma list of ${SERVICES.join(", ")} or "all"` }))),
});

export interface ApiConfig {
  port: number;
  /** Services served by fake ports (API_FAKE). */
  fake: FakeService[];
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
    fake: parsed.data.API_FAKE,
    corsOrigin: parsed.data.CORS_ORIGIN,
    root,
    scenariosDir: join(root, "scenarios"),
    runsDir: join(root, "runs"),
    outDir: join(root, "out"),
  };
}
