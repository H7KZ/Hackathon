import { describe, expect, it } from "vitest";
import { diffMetrics } from "../../src/compare/diff";

describe("diffMetrics", () => {
  it("diffs shared metrics and keeps one-sided ones", () => {
    expect(diffMetrics({ revenue: 100, lost: 0 }, { revenue: 80, complaints: 5 })).toEqual([
      { metric: "complaints", a: null, b: 5, delta: null, relChange: null },
      { metric: "lost", a: 0, b: null, delta: null, relChange: null },
      { metric: "revenue", a: 100, b: 80, delta: -20, relChange: -0.2 },
    ]);
  });
});
