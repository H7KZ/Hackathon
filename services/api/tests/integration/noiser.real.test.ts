/**
 * The real noiser through the API: HTTP validation, then the real noiser + dataer adapters
 * (runScenario -> writeRun into DuckDB -> expectations on the sandbox), with the `noise` block on.
 */
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { stopEngineWorker } from "@s2d/noiser";
import { openStore } from "@s2d/dataer";
import { compileScenario } from "@s2d/noiser";
import { REPO_ROOT, loadScenarioFixture, makeTempDir } from "@s2d/test-utils";
import type { Scenario } from "@s2d/schema/scenario";
import { dataerPort } from "../../src/adapters/dataer";
import { noiserPort } from "../../src/adapters/noiser";
import { createApp } from "../../src/app";
import { loadConfig } from "../../src/config";

const NOISE = {
  missing: { "sale.unit_price": 0.03, "delivery.actual_date": 0.02 },
  duplicates: { sale: 0.01, complaint: 0.02 },
  hourJitter: true,
};
const noisy = () => ({ ...(loadScenarioFixture("supplier_delay") as object), noise: NOISE });
const compiled = (raw: unknown): Scenario => {
  const r = compileScenario(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.scenario;
};

const tmp = makeTempDir("noiser-real");
afterAll(async () => {
  tmp.cleanup();
  await stopEngineWorker();
});

const app = createApp(loadConfig({}, REPO_ROOT));
const validate = (body: unknown) =>
  app.request("/scenarios/validate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("real noiser via the API", () => {
  it("POST /scenarios/validate accepts a noise block and rejects a bad one with a fixable path", async () => {
    expect((await validate(noisy())).status).toBe(200);
    const res = await validate({ ...noisy(), noise: { missing: { "lost_sale.store_id": 0.1 } } });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      ok: false,
      errors: [{ path: 'noise.missing["lost_sale.store_id"]' }],
    });
  });

  it("noisy supplier_delay: stored in DuckDB via the real adapters, all expectations still pass", async () => {
    const scenario = compiled(noisy());
    const dataer = dataerPort();
    const db = join(tmp.dir, "noisy.duckdb");
    const run = await noiserPort().run(scenario, 42);
    await dataer.store(run, db);
    const evidence = await dataer.evidence(db, scenario.expectations);
    expect(evidence.expectations.map((e) => [e.id, e.pass])).toEqual(
      scenario.expectations.map((e) => [e.id, true]),
    );
    const sale = run.tables.find((t) => t.name === "sale");
    expect(sale?.columns).toContain("ts");
    expect(sale?.rows.some((r) => r.unit_price === null)).toBe(true);

    const store = await openStore(db, { readOnly: true });
    try {
      const types = await store.query(
        "SELECT column_name, data_type FROM information_schema.columns " +
          "WHERE table_schema = 'main' AND table_name = 'sale' AND column_name IN ('ts', 'unit_price')",
      );
      expect(Object.fromEntries(types.map((r) => [r.column_name, r.data_type]))).toEqual({
        ts: "TIMESTAMP",
        unit_price: "BIGINT",
      });
    } finally {
      store.close();
    }
  });

  it("the API answers GET /health while a large generation runs (engine in a worker thread)", async () => {
    const big = compiled({
      ...(loadScenarioFixture("supplier_delay") as object),
      meta: { ...(loadScenarioFixture("supplier_delay") as { meta: object }).meta, scale: 3 },
    });
    let settled = false;
    const job = Promise.resolve(noiserPort().run(big, 42)).then((r) => {
      settled = true;
      return r;
    });
    const t0 = performance.now();
    const res = await app.request("/health");
    const latency = performance.now() - t0;
    expect(res.status).toBe(200);
    expect(settled).toBe(false);
    expect(latency).toBeLessThan(250);
    const run = await job;
    expect(run.tables.find((t) => t.name === "sale")?.rows.length).toBeGreaterThan(0);
  });
});
