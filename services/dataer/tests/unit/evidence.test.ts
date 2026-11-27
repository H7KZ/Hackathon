import { describe, expect, it } from "vitest";
import { judge, pickPeriods } from "../../src/evidence/expectations";

describe("judge", () => {
  it("increase passes at the threshold", () => {
    expect(judge(10, 20, { kind: "increase", minRelChange: 1 })).toEqual({ pass: true, relChange: 1 });
    expect(judge(10, 19, { kind: "increase", minRelChange: 1 }).pass).toBe(false);
  });

  it("a zero baseline never passes increase (relative change undefined)", () => {
    expect(judge(0, 3, { kind: "increase", minRelChange: 0.5 })).toEqual({ pass: false, relChange: null });
    expect(judge(0, 0, { kind: "increase", minRelChange: 0.5 }).pass).toBe(false);
  });

  it("decrease uses the absolute relative drop", () => {
    expect(judge(100, 75, { kind: "decrease", minRelChange: 0.2 }).pass).toBe(true);
    expect(judge(100, 85, { kind: "decrease", minRelChange: 0.2 }).pass).toBe(false);
  });

  it("stable passes only inside the band", () => {
    expect(judge(100, 105, { kind: "stable", minRelChange: 0.1 }).pass).toBe(true);
    expect(judge(100, 89, { kind: "stable", minRelChange: 0.1 }).pass).toBe(false);
  });
});

describe("pickPeriods", () => {
  it("extracts before/after and coerces numeric strings", () => {
    expect(
      pickPeriods([
        { period: "after", value: "4" },
        { period: "before", value: 2 },
      ]),
    ).toEqual({ before: 2, after: 4 });
  });

  it("reports a missing period", () => {
    expect(pickPeriods([{ period: "before", value: 1 }])).toHaveProperty("error");
  });

  it.each([null, "", "abc", true])("rejects a non-numeric value %j instead of treating it as 0", (value) => {
    expect(
      pickPeriods([
        { period: "before", value },
        { period: "after", value: 5 },
      ]),
    ).toHaveProperty("error");
  });
});
