import { describe, expect, it } from "vitest";
import { Cond, FieldGen, Path, Scenario } from "../../src/scenario";
import { loadScenarioFixture } from "@s2d/test-utils";

describe("Scenario contract", () => {
  it("accepts the reference scenario supplier_delay", () => {
    const raw = loadScenarioFixture("supplier_delay");
    const result = Scenario.safeParse(raw);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it("rejects a scenario without processes", () => {
    const raw = loadScenarioFixture("supplier_delay") as { processes: unknown[] };
    raw.processes = [];
    expect(Scenario.safeParse(raw).success).toBe(false);
  });

  it.each(["day", "self.qty", "source.store_id", "key.store"])("Path accepts %s", (p) => {
    expect(Path.safeParse(p).success).toBe(true);
  });

  it.each(["", "foo", "self.", "other.x", "self.1x", "self.a.b"])("Path rejects %j", (p) => {
    expect(Path.safeParse(p).success).toBe(false);
  });

  it("parses nested Cond and FieldGen", () => {
    const cond = { kind: "and", conds: [{ kind: "not", cond: { kind: "bernoulli", p: 0.5 } }] };
    expect(Cond.safeParse(cond).success).toBe(true);
    const gen = {
      gen: "if",
      cond: { kind: "fieldGt", path: "self.x", value: 1 },
      then: { gen: "const", value: 1 },
      else: { gen: "if", cond: cond, then: { gen: "id" }, else: { gen: "poisson", lambda: { curve: "c" } } },
    };
    expect(FieldGen.safeParse(gen).success).toBe(true);
  });
});
