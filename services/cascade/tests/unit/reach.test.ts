import { describe, expect, it } from "vitest";
import { loadScenarioFixture } from "@s2d/test-utils";
import type { Scenario } from "@s2d/schema/scenario";
import { describeLeverReach } from "../../src/reach";

const base = () => structuredClone(loadScenarioFixture("supplier_delay")) as Scenario;
const fail = (i: number) => ({ path: `expectations[${i}]`, message: "failed" });

describe("describeLeverReach (story-gate feedback, live run 3 marketing)", () => {
  it("names the lever, where it is used, and the chain to the measured table", () => {
    const s = base();
    const i = s.expectations.findIndex((e) => /complaint/.test(e.sql));
    const [r] = describeLeverReach(s, [fail(i)]);
    expect(r?.path).toBe(`expectations.${s.expectations[i]?.id}.reach`);
    expect(r?.message).toMatch(
      /"late_prob" scoped self\.supplier_id in \["SUP-002"\] drives delivery\.is_late/,
    );
    expect(r?.message).toMatch(/delivery -> stock -> fulfil -> complaint_oos -> complaint/);
  });

  it("says so when no chain reaches the table, and when a lever is unused", () => {
    const s = base();
    const i = s.expectations.findIndex((e) => /complaint/.test(e.sql));
    // cut the chain: complaints no longer come from failed purchases
    s.processes = s.processes.filter((p) => p.type !== "derive");
    const [r] = describeLeverReach(
      {
        ...s,
        curves: [
          ...s.curves,
          {
            id: "x",
            baseline: 1,
            segments: [{ kind: "step", start: "2025-03-01", to: 2, storyPointId: "sp1" }],
          },
        ],
      },
      [fail(i)],
    );
    expect(r?.message).toMatch(/No process chain from a used lever reaches complaint/);
    expect(r?.message).toMatch(/"x" is not used anywhere/);
  });

  it("adds nothing when no expectation failed", () => {
    expect(describeLeverReach(base(), [{ path: "processes[0]", message: "x" }])).toEqual([]);
  });
});
