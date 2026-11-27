/**
 * Engine TDD backlog (AGENTS.md "Required tests"). Turn each todo into a real test, then make it pass.
 * Order follows the Must list: entities -> arrival -> flows -> branch/derive -> snapshot -> truth.
 */
import { describe, expect, it } from "vitest";
import { Scenario } from "@s2d/schema/scenario";
import { loadScenarioFixture } from "@s2d/test-utils";
import { runScenario } from "../../src/engine/run";
import { fromDay, toDay } from "../../src/engine/days";
import { mini, table } from "../support/scenarios";

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
  it("arrival(schedule): one delivery per [store, product] every 7 days", () => {
    const deliveries = table(runScenario(supplierDelay(), { seed: 42 }).tables, "delivery");
    const byStream = new Map<string, number[]>();
    for (const d of deliveries) {
      const k = `${String(d.store_id)}|${String(d.product_id)}`;
      byStream.set(k, [...(byStream.get(k) ?? []), toDay(String(d.planned_date))]);
    }
    expect(byStream.size).toBe(5 * 24);
    const phases = new Set<number>();
    for (const days of byStream.values()) {
      days.slice(1).forEach((d, i) => {
        expect(d - (days[i] ?? 0)).toBe(7);
      });
      phases.add(((days[0] ?? 0) - toDay("2025-01-01")) % 7);
    }
    expect(phases.size).toBeGreaterThan(1); // phase: random
    expect(deliveries[0]?.id).toMatch(/^delivery-\d{6}$/);
  });

  it("arrival(rate): Poisson count per stream scales with the curve", () => {
    const count = (to: number) =>
      table(
        runScenario(
          mini({
            meta: { end: "2025-03-31" },
            curves: [
              {
                id: "r",
                baseline: 1,
                segments: [{ kind: "step", start: "2025-02-15", to, storyPointId: "sp" }],
              },
            ],
            storyPoints: [
              {
                id: "sp",
                phase: 1,
                title: "t",
                description: "d",
                entity: { name: "store", ids: ["STO-001", "STO-002"] },
                start: "2025-02-15",
              },
            ],
            processes: [
              {
                type: "arrival",
                id: "visit",
                table: "visit",
                per: ["store"],
                rate: { curve: "r", scale: 2 },
                fields: {
                  id: { gen: "id" },
                  store_id: { gen: "ref", path: "key.store" },
                  date: { gen: "ref", path: "day" },
                },
              },
            ],
          }),
        ).tables,
        "visit",
      );
    const rows = count(3);
    const before = rows.filter((r) => String(r.date) < "2025-02-15").length / 45 / 2;
    const after = rows.filter((r) => String(r.date) >= "2025-02-15").length / 45 / 2;
    expect(before).toBeGreaterThan(1.6);
    expect(before).toBeLessThan(2.4);
    expect(after).toBeGreaterThan(5);
    expect(after).toBeLessThan(7);
  });

  it("flow effects apply on the `on` date and respect `min: 0`", () => {
    const { tables } = runScenario(supplierDelay(), { seed: 42 });
    const stock = table(tables, "stock_daily");
    expect(stock.every((r) => (r.value as number) >= 0)).toBe(true);
    // a late delivery raises stock on actual_date, not on planned_date
    const late = table(tables, "delivery").find((d) => d.is_late === true && (d.quantity as number) > 0);
    expect(late).toBeDefined();
    if (!late) return;
    const level = (date: string) =>
      stock.find((r) => r.date === date && r.store_id === late.store_id && r.product_id === late.product_id)
        ?.value as number;
    const actual = String(late.actual_date);
    const dayBefore = fromDay(toDay(actual) - 1);
    const sales = table(tables, "sale")
      .filter((s) => s.date === actual && s.store_id === late.store_id && s.product_id === late.product_id)
      .reduce((n, s) => n + (s.quantity as number), 0);
    if (actual <= "2025-08-31")
      expect(level(actual)).toBe(level(dayBefore) + (late.quantity as number) - sales);
    expect(late.delay_days).toBeGreaterThanOrEqual(3);
    expect(toDay(actual) - toDay(String(late.planned_date))).toBe(late.delay_days);
  });

  it("branch(flowGt): sale when stock > 0, lost_sale otherwise", () => {
    const { tables } = runScenario(supplierDelay(), { seed: 42 });
    const attempts = table(tables, "purchase_attempt");
    const sales = table(tables, "sale");
    const lost = table(tables, "lost_sale");
    expect(sales.length + lost.length).toBe(attempts.length);
    expect(lost.length).toBeGreaterThan(0);
    const attemptIds = new Set(attempts.map((a) => a.id));
    expect(lost.every((l) => attemptIds.has(l.attempt_id))).toBe(true);
    expect(sales[0]?.id).toMatch(/^fulfil-\d{6}$/);
  });

  it("derive: child rows carry FK to source and respect lag", () => {
    const s = mini({
      processes: [
        {
          type: "arrival",
          id: "visit",
          table: "visit",
          per: ["store"],
          rate: 2,
          fields: { id: { gen: "id" }, date: { gen: "ref", path: "day" } },
        },
        {
          type: "derive",
          id: "review",
          table: "review",
          source: "visit",
          p: 0.5,
          lag: { min: 2, max: 4 },
          fields: {
            id: { gen: "id" },
            visit_id: { gen: "ref", path: "source.id" },
            date: { gen: "ref", path: "day" },
          },
        },
      ],
    });
    const { tables } = runScenario(s);
    const visits = new Map(table(tables, "visit").map((v) => [v.id, v]));
    const reviews = table(tables, "review");
    expect(reviews.length).toBeGreaterThan(visits.size * 0.3);
    expect(reviews.length).toBeLessThan(visits.size * 0.6);
    for (const r of reviews) {
      const v = visits.get(r.visit_id);
      expect(v).toBeDefined();
      const lag = toDay(String(r.date)) - toDay(String(v?.date));
      expect(lag).toBeGreaterThanOrEqual(2);
      expect(lag).toBeLessThanOrEqual(4);
    }
  });

  it("snapshot: stock_daily has one row per [store, product, day]", () => {
    const stock = table(runScenario(supplierDelay(), { seed: 42 }).tables, "stock_daily");
    const days = toDay("2025-08-31") - toDay("2025-01-01") + 1;
    expect(stock).toHaveLength(5 * 24 * days);
    expect(Object.keys(stock[0] ?? {})).toEqual(["date", "store_id", "product_id", "value"]);
    expect(
      new Set(stock.map((r) => `${String(r.date)}|${String(r.store_id)}|${String(r.product_id)}`)).size,
    ).toBe(stock.length);
  });

  it("visibility: ground_truth tables are returned separately from observed", () => {
    const { tables } = runScenario(supplierDelay(), { seed: 42 });
    const vis = Object.fromEntries(tables.map((t) => [t.name, t.visibility]));
    expect(vis).toMatchObject({
      purchase_attempt: "ground_truth",
      lost_sale: "ground_truth",
      sale: "observed",
      delivery: "observed",
      complaint: "observed",
      stock_daily: "observed",
    });
  });

  it("scale: 0.2 shrinks entity counts and total arrival volume to ~20 %", () => {
    const full = runScenario(supplierDelay(), { seed: 42 }).tables;
    const small = runScenario(supplierDelay(), { seed: 42, scale: 0.2 }).tables;
    expect(table(small, "customer")).toHaveLength(120);
    expect(table(small, "supplier")).toHaveLength(3);
    // per: [customer] is already scaled, so the per-stream rate must not be scaled again (not 0.2 x 0.2)
    const ratio = table(small, "purchase_attempt").length / table(full, "purchase_attempt").length;
    expect(ratio).toBeGreaterThan(0.17);
    expect(ratio).toBeLessThan(0.23);
  });

  it("scale: rate of streams over unscaled entities is multiplied by scale", () => {
    const s = mini({ meta: { end: "2025-12-31" } }); // visit: per store (count 2, never scaled), rate 1
    const ratio =
      table(runScenario(s, { scale: 0.5 }).tables, "visit").length /
      table(runScenario(s).tables, "visit").length;
    expect(ratio).toBeGreaterThan(0.43);
    expect(ratio).toBeLessThan(0.57);
  });
});
