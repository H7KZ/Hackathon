import { defineConfig } from "vitest/config";

// Root config: `pnpm test:watch` runs every workspace project in one watcher (TDD loop).
export default defineConfig({
  test: {
    projects: ["packages/*", "services/*"],
  },
});
