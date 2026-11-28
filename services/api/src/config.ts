import { join, resolve } from "node:path";
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
  /** Cascade design (docs/cascade-design.md): "v1" A1–A5 (default, demo cache) or "causal" D1–D4. */
  CASCADE_DESIGN: z.enum(["v1", "causal"]).default("v1"),
  /** Session state folder (default <repo>/runs). Two API processes must never share one: each marks the other's busy sessions interrupted on startup. */
  RUNS_DIR: z.string().optional(),
});

export interface ApiConfig {
  port: number;
  /** Services served by fake ports (API_FAKE). */
  fake: FakeService[];
  cascadeDesign: "v1" | "causal";
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
    cascadeDesign: parsed.data.CASCADE_DESIGN,
    corsOrigin: parsed.data.CORS_ORIGIN,
    root,
    scenariosDir: join(root, "scenarios"),
    runsDir: parsed.data.RUNS_DIR ? resolve(root, parsed.data.RUNS_DIR) : join(root, "runs"),
    outDir: join(root, "out"),
  };
}
