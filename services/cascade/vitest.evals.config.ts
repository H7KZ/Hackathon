import { project } from "../../vitest.shared.ts";

/**
 * Agent evals: `pnpm evals` (offline from .cache/llm by default, `EVAL_LIVE=1` to call the model and record).
 * Kept out of `pnpm test` because they depend on recorded LLM outputs.
 */
export default project("cascade-evals", {
  include: ["tests/evals/**/*.eval.ts"],
  testTimeout: 300_000,
});
