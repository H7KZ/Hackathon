import { afterEach, describe, expect, it } from "vitest";
import { baselineDrift, formatExpectationFailure } from "../../src/gate";
import { runCascade } from "../../src/cascade";
import type { CascadeEvent } from "../../src/events";
import { company, detail, influences, model, setup, story } from "./fixtures";

const days = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10));
const series = (table: string, values: number[], metric = "rows") => ({
  table,
  dateColumn: "date",
  metric,
  points: days("2024-01-01", values.length).map((day, i) => ({ day, value: values[i] ?? 0 })),
});

describe("baselineDrift (warm-up detector)", () => {
  const flat = Array.from({ length: 60 }, (_, i) => 10 + (i % 3));
  const rising = Array.from({ length: 60 }, (_, i) => (i < 30 ? 8 : 22));

  it("passes a flat baseline", () => {
    expect(baselineDrift([series("sale", flat)], "2024-01-01", "2024-03-01")).toEqual([]);
  });

  it("flags a table whose volume drifts before the story starts, with numbers and a fix", () => {
    const [e, ...rest] = baselineDrift([series("lost_sale", rising)], "2024-01-01", "2024-03-01");
    expect(rest).toEqual([]);
    expect(e?.path).toBe("tables.lost_sale");
    expect(e?.message).toMatch(/lost_sale.*8\.0.*22\.0.*before the story starts/);
    expect(e?.message).toMatch(/initial/);
  });

  it("ignores days from the story onwards, sums, tiny tables and short baselines", () => {
    const storyJump = [...flat.slice(0, 40), ...Array.from({ length: 20 }, () => 100)];
    expect(baselineDrift([series("sale", storyJump)], "2024-01-01", "2024-02-10")).toEqual([]);
    expect(baselineDrift([series("sale", rising, "quantity.sum")], "2024-01-01", "2024-03-01")).toEqual([]);
    const tiny = Array.from({ length: 60 }, (_, i) => (i < 30 ? 0 : 1));
    expect(baselineDrift([series("complaint", tiny)], "2024-01-01", "2024-03-01")).toEqual([]);
    expect(baselineDrift([series("lost_sale", rising)], "2024-01-01", "2024-01-15")).toEqual([]);
  });
});

describe("formatExpectationFailure", () => {
  it("says what was measured, what was needed and what A5 may change", () => {
    const m = formatExpectationFailure(
      { id: "e1", description: "late share rises", check: { kind: "increase", minRelChange: 0.5 } },
      { id: "e1", pass: false, before: 0.057, after: 0.053, relChange: -0.07 },
    );
    expect(m).toMatch(/"e1".*late share rises.*0\.057.*0\.053.*-7(\.0)?%.*increase.*\+50%/);
    expect(m).toMatch(/curves and expectations are fixed/);
  });
});

describe("story gate in the A5 loop", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  it("a compiling A5 answer whose story fails the gate is sent back, then accepted", async () => {
    const t = setup([company, model, influences, story, detail, { ...detail, name: "second try" }]);
    cleanup = t.cleanup;
    const events: CascadeEvent[] = [];
    let calls = 0;
    await runCascade(
      { story: "s", company: "c" },
      {
        llm: t.llm,
        runsDir: t.runsDir,
        runId: "g1",
        onEvent: (e) => events.push(e),
        verify: () =>
          Promise.resolve(calls++ === 0 ? [{ path: "expectations[0]", message: "e1 failed: flat" }] : []),
      },
    );
    const loops = events.filter((e) => e.type === "loop.iteration" && e.step === "05_scenario");
    expect(loops.map((e) => e.type === "loop.iteration" && e.ok)).toEqual([false, true]);
    expect(t.fake.calls.at(-1)?.prompt).toContain("e1 failed: flat");
    // the lever reach of the failed expectation is part of the feedback
    expect(t.fake.calls.at(-1)?.prompt).toMatch(/expectations.e1.reach: "e1" reads .*"late_prob"/);
    expect(t.fake.calls.at(-1)?.prompt).toContain("## Best attempt so far (this is attempt 2)");
  });
});
