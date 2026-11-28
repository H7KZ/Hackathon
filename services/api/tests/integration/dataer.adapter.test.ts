/** The real dataer adapter on a real supplier_delay run (fake LLM for the detective). */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLlm } from "@s2d/llm";
import { compileScenario, runScenario } from "@s2d/noiser";
import { fakeGenerate, loadScenarioFixture, makeTempDir } from "@s2d/test-utils";
import type { RunResult } from "@s2d/schema/run";
import { DatasetEvidence, DetectiveResult } from "@s2d/schema/api";
import { dataerPort } from "../../src/adapters/dataer";

const scenario = (() => {
  const r = compileScenario(loadScenarioFixture("supplier_delay"));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.scenario;
})();

const report = {
  narrative: "Dodavatel SUP-002 zpožďuje dodávky.",
  findings: [
    {
      claim: "Zpoždění SUP-002",
      entities: ["SUP-002"],
      start: scenario.storyPoints[0]?.start ?? "2025-03-01",
      supportingSql: "SELECT 1",
    },
  ],
};

const tmp = makeTempDir("dataer-adapter");
const dataDir = join(tmp.dir, "d1");
const db = join(dataDir, "db.duckdb");
let run: RunResult;

const port = (responses: unknown[] = []) => {
  const fake = fakeGenerate(responses);
  const llm = createLlm({
    generate: fake.generate,
    cacheDir: join(tmp.dir, `cache-${Math.random()}`),
    offline: false,
    model: "test:model",
  });
  return { port: dataerPort({ llm }), calls: fake.calls };
};

beforeAll(async () => {
  run = runScenario(scenario, { seed: 42 });
  await port().port.store(run, db);
});
afterAll(() => {
  tmp.cleanup();
});

describe("dataer adapter (real)", () => {
  it("evidence: expectations pass, series are non-empty and contract-valid, no sandbox left behind", async () => {
    const evidence = DatasetEvidence.parse(await port().port.evidence(db, scenario.expectations));
    expect(evidence.expectations.every((e) => e.pass)).toBe(true);
    expect(evidence.series.length).toBeGreaterThan(0);
    const metrics = evidence.series.map((s) => `${s.table}.${s.dateColumn}.${s.metric}`);
    expect(metrics).toContain("stock_daily.date.value.sum");
    expect(metrics).toContain("delivery.actual_date.rows");
    expect(readdirSync(dataDir)).toEqual(["db.duckdb"]);
  });

  it("compare returns metrics", async () => {
    const diff = await port().port.compare(db, db);
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.find((d) => d.metric === "sale.rows")?.delta).toBe(0);
  });

  it("detective returns a contract-valid result with score.recall and logs SQL", async () => {
    const { port: p } = port([
      { action: { tool: "run_sql", sql: "SELECT count(*) FROM delivery" } },
      { action: { tool: "report", report } },
    ]);
    const events: unknown[] = [];
    const result = DetectiveResult.parse(
      await p.detective(db, { onEvent: (e) => events.push(e), signal: new AbortController().signal }),
    );
    expect(result.score.recall).toBeGreaterThan(0);
    expect(events).toEqual([{ type: "log", message: "SQL: SELECT count(*) FROM delivery" }]);
    expect(readdirSync(dataDir)).toEqual(["db.duckdb"]);
  });

  it("evidence and detective run concurrently on the same db", async () => {
    const { port: p } = port([{ action: { tool: "report", report } }]);
    const [e, d] = await Promise.all([
      p.evidence(db, scenario.expectations),
      p.detective(db, { onEvent: () => {}, signal: new AbortController().signal }),
    ]);
    expect(e.series.length).toBeGreaterThan(0);
    expect(d.report).toEqual(report);
  });

  it("store rejects a run with a dangling FK", async () => {
    const broken = structuredClone(run);
    const sale = broken.tables.find((t) => t.name === "sale");
    if (!sale?.rows[0]) throw new Error("fixture: no sale rows");
    sale.rows[0].customer_id = "CUS-NOPE";
    await expect(port().port.store(broken, join(tmp.dir, "broken.duckdb"))).rejects.toThrow(
      /sale\.customer_id.*CUS-NOPE/s,
    );
  });
});
