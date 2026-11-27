import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { runScenario } from "../../src/engine/run";
import { mini } from "../support/scenarios";

const s = mini({
  entities: [
    { name: "store", count: 3, idPrefix: "STO", fields: { id: { gen: "id" } } },
    { name: "item", count: 4, idPrefix: "ITM", fields: { id: { gen: "id" } } },
  ],
  flows: [
    {
      id: "stock",
      keys: ["store", "item"],
      initial: { gen: "poisson", lambda: 3 },
      min: 0,
      snapshot: { table: "stock_daily" },
    },
  ],
  processes: [
    {
      type: "arrival",
      id: "buy",
      table: "buy",
      per: ["store"],
      rate: 2,
      fields: {
        id: { gen: "id" },
        store_id: { gen: "ref", path: "key.store" },
        item_id: { gen: "pick", entity: "item" },
        qty: { gen: "uniformInt", min: 1, max: 3 },
      },
      effects: [
        {
          flow: "stock",
          keys: { store: "self.store_id", item: "self.item_id" },
          delta: "self.qty",
          sign: -1,
        },
      ],
    },
  ],
});

describe("engine properties", () => {
  it("same seed -> identical output; flows never go below min", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e6, max: 1e6 }), (seed) => {
        const a = runScenario(s, { seed });
        expect(runScenario(s, { seed })).toEqual(a);
        const stock = a.tables.find((t) => t.name === "stock_daily")?.rows ?? [];
        expect(stock.every((r) => (r.value as number) >= 0)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });
});
