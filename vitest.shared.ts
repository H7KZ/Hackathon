import { defineProject, type ViteUserConfig } from "vitest/config";

/**
 * Shared vitest project config. Test folder layout per package:
 *   tests/unit/        fast, pure, no I/O — run by `verify:fast` and the agent hook
 *   tests/integration/ real DuckDB / filesystem / HTTP app (in-process)
 *   tests/property/    fast-check invariants (determinism, isolation, integrity)
 *   tests/golden/      hashes of generated tables for reference scenarios
 *   tests/evals/       LLM agent evals (cascade only, separate script)
 */
export function project(name: string, overrides: ViteUserConfig["test"] = {}) {
  return defineProject({
    test: {
      name,
      include: ["tests/{unit,integration,property,golden}/**/*.test.{ts,tsx}"],
      environment: "node",
      testTimeout: 20_000,
      ...overrides,
    },
  });
}
