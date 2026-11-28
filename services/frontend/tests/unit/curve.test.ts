import { describe, expect, it } from "vitest";
import { curveAt, type Knot } from "../../lib/chat/curve";

// the supplier-delay story from a live run; expected values follow the engine's segment rules
const knots: Knot[] = [
  { id: "a", kind: "ramp", start: "2026-03-01", end: "2026-03-31", level: 9 },
  { id: "b", kind: "ramp", start: "2026-04-01", end: "2026-04-20", level: 13 },
  { id: "c", kind: "ramp", start: "2026-05-01", end: "2026-05-15", level: 12 },
];
const at = (day: string, k = knots) => curveAt(day, 5, k, 14, true);

describe("curveAt (engine curves)", () => {
  it("a ramp moves linearly to its end and then holds, with no return to baseline", () => {
    expect(at("2026-02-20")).toBe(5);
    expect(at("2026-03-16")).toBe(7);
    expect(at("2026-03-31")).toBe(9);
    expect(at("2026-04-30")).toBe(13);
    expect(at("2026-07-15")).toBe(12);
  });

  it("step, spike and decay come back to the previous value", () => {
    const one = (kind: string) => [{ id: "a", kind, start: "2026-03-01", end: "2026-03-11", level: 9 }];
    expect(at("2026-03-05", one("step"))).toBe(9);
    expect(at("2026-03-11", one("step"))).toBe(5);
    expect(at("2026-03-06", one("spike"))).toBe(7);
    expect(at("2026-03-11", one("spike"))).toBe(5);
    expect(at("2026-03-11", one("decay"))).toBe(7);
  });
});
