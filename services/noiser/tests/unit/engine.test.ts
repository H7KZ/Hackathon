/**
 * Engine TDD backlog (AGENTS.md "Required tests"). Turn each todo into a real test, then make it pass.
 * Order follows the Must list: entities -> arrival -> flows -> branch/derive -> snapshot -> truth.
 */
import { describe, expect, it } from "vitest";
import { Scenario } from "@s2d/schema/scenario";
import { loadScenarioFixture } from "@s2d/test-utils";
import { runScenario } from "../../src/engine/run";
import { table } from "../support/scenarios";

const supplierDelay = () => Scenario.parse(loadScenarioFixture("supplier_delay"));

describe("runScenario", () => {
  it("generates entities with ids `<idPrefix>-001` and declared fields", () => {
    const { tables } = runScenario(supplierDelay(), { seed: 42 });
    const suppliers = table(tables, "supplier");
    expect(suppliers.map((r) => r.id)).toEqual(["SUP-001", "SUP-002", "SUP-003"]);
    expect(table(tables, "customer")).toHaveLength(600);

    const products = table(tables, "product");
    expect(products).toHaveLength(24);
    expect(Object.keys(products[0] ?? {})).toEqual(["id", "name", "supplier_id", "category", "price"]);
    const supplierIds = new Set(suppliers.map((r) => r.id));
    for (const p of products) {
      expect(supplierIds).toContain(p.supplier_id);
      expect(["kuchyň", "koupelna", "zahrada", "úklid"]).toContain(p.category);
      expect(Number.isInteger(p.price) && (p.price as number) >= 30).toBe(true);
      expect(typeof p.name).toBe("string");
    }
    expect(tables.find((t) => t.name === "supplier")?.visibility).toBe("observed");
  });
  it.todo("arrival(schedule): one delivery per [store, product] every 7 days");
  it.todo("arrival(rate): Poisson count per stream scales with the curve");
  it.todo("flow effects apply on the `on` date and respect `min: 0`");
  it.todo("branch(flowGt): sale when stock > 0, lost_sale otherwise");
  it.todo("derive: child rows carry FK to source and respect lag");
  it.todo("snapshot: stock_daily has one row per [store, product, day]");
  it.todo("visibility: ground_truth tables are returned separately from observed");
  it.todo("scale: 0.2 shrinks entity counts and rates");
});
