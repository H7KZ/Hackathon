/**
 * Real dataer on the real supplier_delay scenario (dataer itself may not import @s2d/noiser,
 * so these cross-service checks live here).
 */
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { inferForeignKeys, openStore, storeRun } from "@s2d/dataer";
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
