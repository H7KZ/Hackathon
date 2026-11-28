import { defineConfig } from "@playwright/test";

/**
 * E2E: `pnpm test:e2e` (first run: `pnpm --filter @s2d/frontend exec playwright install chromium`).
 * Own ports (API 4310, UI 3310) so a dev server already running on 4000/3000 is never reused by mistake.
 * API_FAKE defaults to "all" (no LLM, no DuckDB). `E2E_REAL=1` runs the real services instead
 * (tests/e2e/real.spec.ts; offline from the LLM cache unless LLM_OFFLINE is unset).
 */
const API_PORT = Number(process.env.E2E_API_PORT ?? 4310);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3310);
const real = process.env.E2E_REAL === "1";

export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: real ? [] : ["**/real.spec.ts"],
  timeout: real ? 15 * 60_000 : 90_000,
  expect: { timeout: real ? 10 * 60_000 : 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${String(WEB_PORT)}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @s2d/api start",
      env: {
        API_PORT: String(API_PORT),
        CORS_ORIGIN: `http://localhost:${String(WEB_PORT)}`,
        API_FAKE: real ? "" : (process.env.API_FAKE ?? "all"),
        // never share runs/ with a dev server: each API marks the other one's busy sessions interrupted
        RUNS_DIR: process.env.E2E_RUNS_DIR ?? "runs-e2e",
      },
      url: `http://localhost:${String(API_PORT)}/health`,
      reuseExistingServer: false,
      cwd: "../..",
      timeout: 120_000,
    },
    {
      command: `pnpm exec next dev --port ${String(WEB_PORT)}`,
      env: { NEXT_PUBLIC_API_URL: `http://localhost:${String(API_PORT)}` },
      url: `http://localhost:${String(WEB_PORT)}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
