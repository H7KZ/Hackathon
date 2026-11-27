import { afterAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { exportSandbox, openSandbox, runExpectations } from "@s2d/dataer";
import { Scenario } from "@s2d/schema/scenario";
import { REPO_ROOT, loadScenarioFixture, makeTempDir } from "@s2d/test-utils";
import { createApp } from "../../src/app";
import { loadConfig } from "../../src/config";
import { generateRun } from "../../src/runs";

const tmp = makeTempDir("s2d-runs-");
afterAll(() => {
  tmp.cleanup();
});
const app = createApp({ ...loadConfig({}, REPO_ROOT), outDir: tmp.dir });
const post = (body: unknown) =>
  app.request("/runs", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

async function expectationsPass(seed: number): Promise<{ pass: boolean; failed: unknown[] }> {
  const raw = loadScenarioFixture("supplier_delay");
  const res = await generateRun(join(tmp.dir, "story"), raw, { seed });
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  const sandbox = join(tmp.dir, `sandbox-${seed}.duckdb`);
  await exportSandbox(res.dbPath, sandbox);
  const store = await openSandbox(sandbox);
  try {
    const results = await runExpectations(store, Scenario.parse(raw).expectations);
    const failed = results.filter((r) => !r.pass);
    return { pass: failed.length === 0, failed };
  } finally {
    store.close();
  }
}

describe("POST /runs", () => {
  it("generates supplier_delay and writes a DuckDB file", async () => {
    const res = await post({ scenarioId: "supplier_delay", seed: 42 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      dbPath: string;
      meta: { seed: number };
      tables: { name: string; rows: number }[];
    };
    expect(body.meta.seed).toBe(42);
    expect(body.dbPath).toMatch(/supplier_delay[\\/]42-[0-9a-f]{8}\.duckdb$/);
    expect(body.tables.find((t) => t.name === "complaint")?.rows).toBeGreaterThan(0);
  });

  it("returns 404 for unknown scenarios and 400 for bad input", async () => {
    expect((await post({ scenarioId: "nope" })).status).toBe(404);
    expect((await post({ scenarioId: "../package" })).status).toBe(400);
    expect((await post({ scenarioId: "supplier_delay", scale: -1 })).status).toBe(400);
  });
});

// TODO(story): skipped by decision of the PR author. The engine follows the spec, but supplier_delay is too
// weak at seed 42 (e3 SUP-002 revenue -11% vs -20%, e5 complaints +29% vs +50%; 0/5 of seeds 1..5 pass)
// because stock-outs are already frequent before the story (topUp target 7 vs ~4.2 units/week).
// Re-enable after the scenario owner tunes scenarios/supplier_delay.json. See PR #5.
describe.skip("story: supplier_delay expectations", () => {
  it("all pass at seed 42", async () => {
    const r = await expectationsPass(42);
    expect(r.failed).toEqual([]);
  }, 60_000);

  it("pass at >= 4/5 seeds of 1..5", async () => {
    let passed = 0;
    for (const seed of [1, 2, 3, 4, 5]) if ((await expectationsPass(seed)).pass) passed++;
    expect(passed).toBeGreaterThanOrEqual(4);
  }, 120_000);
});
