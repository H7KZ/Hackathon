import { describe, expect, it } from "vitest";
import { loadScenarioFixture } from "@s2d/test-utils";
import type { Scenario } from "@s2d/schema/scenario";
import { entityLabels } from "../../src/labels";
import { runScenario } from "../../src/engine/run";

const scenario = () => loadScenarioFixture("supplier_delay") as Scenario;

describe("entityLabels (user: nobody knows what STO-001 means)", () => {
  it("returns the same names the dataset holds for that seed", () => {
    const s = scenario();
    const labels = entityLabels(s.entities, {
      seed: 7,
      start: s.meta.start,
      end: s.meta.end,
      curves: s.curves,
    });
    const run = runScenario(s, { seed: 7 });
    const supplier = run.tables.find((t) => t.name === "supplier");
    const row = supplier?.rows[0];
    expect(row?.id).toBe("SUP-001");
    expect(labels["SUP-001"]).toBe(row?.name);
  });

  it("names a store by its city, not by a faker company name (run 6: 'Patočková v.o.s. (STO-001)')", () => {
    const s = scenario();
    const store = s.entities.find((e) => e.name === "store")!;
    store.fields = { ...store.fields, name: { gen: "fake", kind: "companyName" } };
    const labels = entityLabels(s.entities, { seed: 7 });
    const run = runScenario(s, { seed: 7 });
    const row = run.tables.find((t) => t.name === "store")?.rows[0];
    expect(labels["STO-001"]).toBe(row?.city);
    // other entities keep their name
    const sup = run.tables.find((t) => t.name === "supplier")?.rows[0];
    expect(labels["SUP-001"]).toBe(sup?.name);
  });

  it("is deterministic and depends on the seed", () => {
    const s = scenario();
    const a = entityLabels(s.entities, { seed: 1 });
    expect(entityLabels(s.entities, { seed: 1 })).toEqual(a);
    expect(entityLabels(s.entities, { seed: 2 })).not.toEqual(a);
  });
});
