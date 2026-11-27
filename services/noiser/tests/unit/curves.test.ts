import { describe, expect, it } from "vitest";
import type { CurveDef } from "@s2d/schema/scenario";
import { evaluateCurve } from "../../src/engine/curves";
import { fromDay, toDay } from "../../src/engine/days";

const d = toDay;

describe("days", () => {
  it("round-trips ISO dates", () => {
    expect(fromDay(toDay("2025-03-01"))).toBe("2025-03-01");
    expect(toDay("2025-03-02") - toDay("2025-03-01")).toBe(1);
  });
});

describe("evaluateCurve", () => {
  const lateProb: CurveDef = {
    id: "late_prob",
    baseline: 0.05,
    scope: { field: "self.supplier_id", ids: ["SUP-002"] },
    segments: [{ kind: "ramp", start: "2025-03-01", end: "2025-04-15", to: 0.6, storyPointId: "sp1" }],
    clamp: [0, 1],
  };

  it("ramp: baseline before, linear inside, target after", () => {
    expect(evaluateCurve(lateProb, d("2025-02-01"), "SUP-002")).toBe(0.05);
    const mid = evaluateCurve(lateProb, d("2025-03-24"), "SUP-002");
    expect(mid).toBeGreaterThan(0.05);
    expect(mid).toBeLessThan(0.6);
    expect(evaluateCurve(lateProb, d("2025-05-01"), "SUP-002")).toBe(0.6);
  });

  it("scope: records outside the scope keep the baseline", () => {
    expect(evaluateCurve(lateProb, d("2025-05-01"), "SUP-001")).toBe(0.05);
  });

  it("step with end returns to previous value on the end day (end exclusive)", () => {
    const c: CurveDef = {
      id: "c",
      baseline: 1,
      segments: [{ kind: "step", start: "2025-01-10", end: "2025-01-20", to: 2, storyPointId: "s" }],
    };
    expect(evaluateCurve(c, d("2025-01-09"))).toBe(1);
    expect(evaluateCurve(c, d("2025-01-15"))).toBe(2);
    expect(evaluateCurve(c, d("2025-01-19"))).toBe(2);
    expect(evaluateCurve(c, d("2025-01-20"))).toBe(1);
  });

  it("spike jumps then returns; decay halves the gap per half-life", () => {
    const spike: CurveDef = {
      id: "s",
      baseline: 0,
      segments: [{ kind: "spike", start: "2025-01-10", end: "2025-01-20", to: 10, storyPointId: "s" }],
    };
    expect(evaluateCurve(spike, d("2025-01-10"))).toBe(10);
    expect(evaluateCurve(spike, d("2025-01-15"))).toBe(5);
    expect(evaluateCurve(spike, d("2025-01-20"))).toBe(0);

    const decay: CurveDef = {
      id: "d",
      baseline: 0,
      segments: [{ kind: "decay", start: "2025-01-10", end: "2025-01-17", to: 8, storyPointId: "s" }],
    };
    expect(evaluateCurve(decay, d("2025-01-17"))).toBeCloseTo(4);
  });

  it("clamps the result", () => {
    const c: CurveDef = {
      id: "c",
      baseline: 0.5,
      segments: [{ kind: "step", start: "2025-01-01", to: 3, storyPointId: "s" }],
      clamp: [0, 1],
    };
    expect(evaluateCurve(c, d("2025-02-01"))).toBe(1);
  });
});
