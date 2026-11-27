/**
 * Real dataer on the real supplier_delay scenario (dataer itself may not import @s2d/noiser,
 * so these cross-service checks live here).
 */
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { compareRuns, inferForeignKeys, listTables, openStore, previewTable, storeRun } from "@s2d/dataer";
import { compileScenario, runScenario } from "@s2d/noiser";
import { loadScenarioFixture, makeTempDir } from "@s2d/test-utils";
import type { Scenario } from "@s2d/schema/scenario";

const compiled = (raw: unknown): Scenario => {
  const r = compileScenario(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.scenario;
};

/** Oracle: the FK list pinned in services/noiser/tests/golden/supplier_delay.golden.test.ts. */
const GOLDEN_FKS: [string, string, string][] = [
  ["product", "supplier_id", "supplier"],
  ["customer", "home_store_id", "store"],
  ["delivery", "store_id", "store"],
  ["delivery", "product_id", "product"],
  ["delivery", "supplier_id", "supplier"],
  ["purchase_attempt", "customer_id", "customer"],
  ["purchase_attempt", "store_id", "store"],
  ["purchase_attempt", "product_id", "product"],
  ["sale", "customer_id", "customer"],
  ["sale", "store_id", "store"],
  ["sale", "product_id", "product"],
  ["lost_sale", "attempt_id", "purchase_attempt"],
  ["lost_sale", "customer_id", "customer"],
  ["complaint", "customer_id", "customer"],
  ["complaint", "store_id", "store"],
  ["complaint", "product_id", "product"],
  ["stock_daily", "store_id", "store"],
  ["stock_daily", "product_id", "product"],
];

const NOISE = {
  missing: { "sale.unit_price": 0.03, "delivery.actual_date": 0.02 },
  duplicates: { sale: 0.01, complaint: 0.02 },
  hourJitter: true,
};

const tmp = makeTempDir("dataer-real");
afterAll(() => {
  tmp.cleanup();
});

describe("FK integrity on supplier_delay", () => {
  it.each([
    ["clean", {}],
    ["noisy", { noise: NOISE }],
  ])("%s run at seed 42: storeRun passes and inferred FKs match the golden list", async (name, extra) => {
    const scenario = compiled({ ...(loadScenarioFixture("supplier_delay") as object), ...extra });
    const db = join(tmp.dir, `${name}.duckdb`);
    await storeRun(db, runScenario(scenario, { seed: 42 }));
    const store = await openStore(db, { readOnly: true });
    try {
      const fks = await inferForeignKeys(store);
      expect(fks.filter((f) => f.dangling > 0)).toEqual([]);
      const inferred = new Map(fks.map((f) => [`${f.table}.${f.column}`, f.target]));
      for (const [table, column, target] of GOLDEN_FKS) {
        expect(inferred.get(`${table}.${column}`), `${table}.${column}`).toBe(target);
      }
    } finally {
      store.close();
    }
  });
});

describe("table preview on supplier_delay", () => {
  it("lists observed tables only and previews JSON-safe rows", async () => {
    const db = join(tmp.dir, "preview.duckdb");
    await storeRun(db, runScenario(compiled(loadScenarioFixture("supplier_delay")), { seed: 42 }));
    const tables = await listTables(db);
    const names = tables.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["sale", "delivery", "store", "stock_daily"]));
    expect(names).not.toContain("story_points");
    expect(names).not.toContain("run_meta");
    expect(tables.every((t) => t.rows > 0)).toBe(true);
    const sale = await previewTable(db, "sale", 5);
    expect(sale.rowsShown).toHaveLength(5);
    const first = sale.rowsShown[0] ?? {};
    expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.parse(JSON.stringify(sale))).toEqual(sale);
  });
});

describe("compare on supplier_delay", () => {
  it("same seed, weaker late_prob ramp: downstream story tables differ, entity tables do not", async () => {
    const raw = loadScenarioFixture("supplier_delay") as Scenario;
    const variant = structuredClone(raw);
    const seg = variant.curves.find((c) => c.id === "late_prob")?.segments[0];
    if (!seg || seg.kind !== "ramp") throw new Error("fixture changed: late_prob ramp missing");
    seg.to = 0.1;
    const dbA = join(tmp.dir, "cmp-a.duckdb");
    const dbB = join(tmp.dir, "cmp-b.duckdb");
    await storeRun(dbA, runScenario(compiled(raw), { seed: 42 }));
    await storeRun(dbB, runScenario(compiled(variant), { seed: 42 }));
    const diff = new Map((await compareRuns(dbA, dbB)).map((d) => [d.metric, d]));
    // unrelated processes (entities, the delivery schedule, the daily stock grid) are untouched
    for (const m of ["store.rows", "supplier.rows", "product.rows", "product.price.sum", "customer.rows"]) {
      expect(diff.get(m)?.delta, m).toBe(0);
    }
    for (const m of ["delivery.rows", "stock_daily.rows"]) expect(diff.get(m)?.delta, m).toBe(0);
    // the story: far fewer delay days -> more sales, fewer complaints
    expect(diff.get("delivery.delay_days.sum")?.relChange).toBeLessThan(-0.5);
    expect(diff.get("sale.rows")?.delta).toBeGreaterThan(0);
    expect(diff.get("complaint.rows")?.delta).toBeLessThan(0);
  });
});
