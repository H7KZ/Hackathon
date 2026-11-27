import { describe, expect, it } from "vitest";
import { Scenario } from "@s2d/schema/scenario";
import { loadScenarioFixture } from "@s2d/test-utils";
import { evalParam } from "../../src/engine/params";
import { toDay } from "../../src/engine/days";
import type { Runtime } from "../../src/engine/types";

const s = Scenario.parse(loadScenarioFixture("supplier_delay"));
const rt = { curves: new Map(s.curves.map((c) => [c.id, c])) } as unknown as Runtime;
const late = (supplier: string, iso: string) =>
  evalParam({ curve: "late_prob" }, { day: toDay(iso), self: { supplier_id: supplier } }, rt, "p");

describe("params from curves", () => {
  it("records outside the scope get the baseline", () => {
    expect(late("SUP-003", "2025-05-01")).toBe(0.05);
    expect(late("SUP-001", "2025-04-01")).toBe(0.05);
  });

  it("records in scope follow the ramp", () => {
    expect(late("SUP-002", "2025-02-28")).toBe(0.05);
    const mid = late("SUP-002", "2025-03-23");
    expect(mid).toBeGreaterThan(0.05);
    expect(mid).toBeLessThan(0.6);
    expect(late("SUP-002", "2025-04-15")).toBe(0.6);
  });

  it("applies param scale and constants", () => {
    const ctx = { day: toDay("2025-01-05"), self: {} };
    expect(evalParam({ curve: "demand", scale: 0.06 }, ctx, rt, "rate")).toBeCloseTo(0.06);
    expect(evalParam(3, ctx, rt, "x")).toBe(3);
  });
});
