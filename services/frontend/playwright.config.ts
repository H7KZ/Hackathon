import { defineConfig } from "@playwright/test";

/** Smoke e2e: `pnpm test:e2e` (first run: `pnpm --filter @s2d/frontend exec playwright install chromium`). */
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: [
    {
      command: "pnpm --filter @s2d/api start",
      env: { API_FAKE: process.env.API_FAKE ?? "all" }, // no LLM, no DuckDB
      url: "http://localhost:4000/health",
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
    },
    { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: !process.env.CI },
  ],
});
