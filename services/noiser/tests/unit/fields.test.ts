import { describe, expect, it } from "vitest";
import { generate } from "../../src/index";
import { runScenario } from "../../src/engine/run";
import { mini, table } from "../support/scenarios";

const entities = (fields: Record<string, unknown>, extra: unknown[] = []) => [
  {
    name: "store",
    count: 3,
    idPrefix: "STO",
    fields: { id: { gen: "id" }, size: { gen: "const", value: 2 }, city: { gen: "fake", kind: "city" } },
  },
  ...extra,
  { name: "item", count: 40, idPrefix: "ITM", fields: { id: { gen: "id" }, ...fields } },
];

describe("field generators", () => {
  it("ref / lookup / pick / const / fake / categorical / normal / if", () => {
    const s = mini({
      entities: entities({
        store_id: { gen: "pick", entity: "store" },
        store_size: { gen: "lookup", entity: "store", key: "self.store_id", field: "size" },
        copy: { gen: "ref", path: "self.store_id" },
        kind: { gen: "categorical", values: ["a", "b"], weights: [1, 0] },
        price: { gen: "normal", mean: 100, sd: 50, min: 90, max: 110, round: true },
        big: {
          gen: "if",
          cond: { kind: "fieldGt", path: "self.price", value: 100 },
          then: { gen: "const", value: true },
          else: { gen: "const", value: false },
        },
        email: { gen: "fake", kind: "email" },
      }),
    });
    const items = table(runScenario(s).tables, "item");
    expect(items).toHaveLength(40);
    expect(items[0]?.id).toBe("ITM-001");
    for (const it of items) {
      expect(["STO-001", "STO-002", "STO-003"]).toContain(it.store_id);
      expect(it.store_size).toBe(2);
      expect(it.copy).toBe(it.store_id);
      expect(it.kind).toBe("a");
      expect(it.price).toBeGreaterThanOrEqual(90);
      expect(it.price).toBeLessThanOrEqual(110);
      expect(it.big).toBe((it.price as number) > 100);
      expect(it.email).toMatch(/@/);
    }
  });

  it("pick honours where and weightBy", () => {
    const s = mini({
      entities: [
        {
          name: "store",
          count: 3,
          idPrefix: "STO",
          fields: {
            id: { gen: "id" },
            region: { gen: "categorical", values: ["north"] },
            weight: { gen: "const", value: 1 },
          },
        },
        {
          name: "item",
          count: 30,
          idPrefix: "ITM",
          fields: {
            id: { gen: "id" },
            region: { gen: "const", value: "north" },
            store_id: { gen: "pick", entity: "store", where: { region: "self.region" }, weightBy: "weight" },
            none_id: { gen: "pick", entity: "store", where: { region: "self.id" } },
          },
        },
      ],
    });
    for (const it of table(runScenario(s).tables, "item")) {
      expect(it.store_id).toMatch(/^STO-00[123]$/);
      expect(it.none_id).toBeNull();
    }
  });

  it("fake values are deterministic per seed", () => {
    const s = mini({ entities: entities({ name: { gen: "fake", kind: "personName" } }) });
    const a = table(runScenario(s, { seed: 7 }).tables, "item");
    expect(table(runScenario(s, { seed: 7 }).tables, "item")).toEqual(a);
    expect(table(runScenario(s, { seed: 8 }).tables, "item")).not.toEqual(a);
  });

  it("referencing a later field fails with a path the agent can fix", () => {
    const s = mini({
      entities: entities({ a: { gen: "ref", path: "self.b" }, b: { gen: "const", value: 1 } }),
    });
    expect(generate(s)).toMatchObject({ ok: false, errors: [{ path: "entities[1].fields.a.path" }] });
  });

  it("scale shrinks only entities with count >= 50", () => {
    const s = mini({
      entities: entities({}, [{ name: "big", count: 100, idPrefix: "BIG", fields: { id: { gen: "id" } } }]),
    });
    const { tables } = runScenario(s, { scale: 0.2 });
    expect(table(tables, "store")).toHaveLength(3);
    expect(table(tables, "big")).toHaveLength(20);
    expect(table(tables, "item")).toHaveLength(40);
  });
});
