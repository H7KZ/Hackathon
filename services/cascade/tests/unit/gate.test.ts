import { afterEach, describe, expect, it } from "vitest";
import { loadScenarioFixture } from "@s2d/test-utils";
import { Scenario } from "@s2d/schema/scenario";
import { baselineDrift, formatExpectationFailure, seedRobust } from "../../src/gate";
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
    // user session: A5 reached the gate with 90–150-day delays
    expect(m).toMatch(/more affected records or a higher probability over extreme magnitudes/);
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

describe("hypotheses switched off in the story editor do not gate A5 (run-6 item 2)", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  it("the gate receives only the kept expectations; its error paths still index 05_scenario", async () => {
    const two = {
      ...story,
      expectations: [story.expectations[0]!, { ...story.expectations[0]!, id: "e_off" }],
    };
    const t = setup([company, model, influences, two, detail, { ...detail, name: "second try" }]);
    cleanup = t.cleanup;
    const seen: string[][] = [];
    let calls = 0;
    await runCascade(
      { story: "s", company: "c" },
      {
        llm: t.llm,
        runsDir: t.runsDir,
        runId: "k1",
        keepExpectations: ["e_off"],
        verify: (sc) => {
          seen.push(sc.expectations.map((e) => e.id));
          return Promise.resolve(
            calls++ === 0 ? [{ path: "expectations[0]", message: 'Expectation "e_off" failed' }] : [],
          );
        },
      },
    );
    expect(seen.every((ids) => ids.length === 1 && ids[0] === "e_off")).toBe(true);
    // the kept expectation is the 2nd of 05_scenario: the feedback must point there, not at [0]
    expect(t.fake.calls.at(-1)?.prompt).toContain('expectations[1]: Expectation "e_off" failed');
  });

  it("without keepExpectations every expectation gates A5 (default approve unchanged)", async () => {
    const t = setup([company, model, influences, story, detail]);
    cleanup = t.cleanup;
    const seen: number[] = [];
    await runCascade(
      { story: "s", company: "c" },
      {
        llm: t.llm,
        runsDir: t.runsDir,
        runId: "k2",
        verify: (sc) => {
          seen.push(sc.expectations.length);
          return Promise.resolve([]);
        },
      },
    );
    expect(seen[0]).toBe(story.expectations.length);
  });
});

describe("v1 A5 gate is seed-robust too (run-5 decision)", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  it("an A5 answer that passes only at seed 42 is sent back with the failing seeds", async () => {
    const t = setup([company, model, influences, story, detail, { ...detail, name: "second try" }]);
    cleanup = t.cleanup;
    const seeds: number[] = [];
    let attempt = 0;
    await runCascade(
      { story: "s", company: "c" },
      {
        llm: t.llm,
        runsDir: t.runsDir,
        runId: "g2",
        onEvent: (e) => {
          if (e.type === "loop.iteration" && e.step === "05_scenario") attempt = e.n;
        },
        verify: (sc) => {
          const seed = sc.meta.seed;
          seeds.push(seed);
          // first attempt: luck at 42 only; second attempt: robust
          const weak = attempt === 0 && seed !== 42;
          return Promise.resolve(
            weak
              ? [
                  {
                    path: "expectations[0]",
                    message: `Expectation "e1" (d) failed: before 1, after 1 (change 0.0%); x`,
                  },
                ]
              : [],
          );
        },
      },
    );
    expect(seeds.slice(0, 3)).toEqual([42, 1, 2]);
    expect(t.fake.calls.at(-1)?.prompt).toMatch(/Passes at seed 42 but fails at other seeds \(seed 1: /);
  });
});

describe("seedRobust (causal gate: >= 4/5 seeds, live run 4)", () => {
  const s = Scenario.parse(loadScenarioFixture("supplier_delay"));
  const failAt =
    (bad: number[]) =>
    (x: Scenario): Promise<{ path: string; message: string }[]> =>
      Promise.resolve(
        bad.includes(x.meta.seed)
          ? [
              {
                path: "expectations[0]",
                message: `Expectation "e1" (d) failed: before 10, after 9.8 (change -2.0%); it needs ...`,
              },
            ]
          : [],
      );

  it("passes when at most one of seeds 1..5 fails", async () => {
    expect(await seedRobust(failAt([3]))(s)).toEqual([]);
  });

  it("names the failing seeds with their measurement", async () => {
    const [e] = await seedRobust(failAt([1, 2]))(s);
    expect(e?.path).toBe("expectations[0]");
    expect(e?.message).toMatch(/seed 1: before 10, after 9\.8 \(change -2\.0%\); seed 2:/);
    expect(e?.message).toMatch(/at least 4 of seeds 1, 2, 3, 4, 5/);
  });

  it("returns the scenario seed's own failures unchanged", async () => {
    expect(await seedRobust(failAt([42]))(s)).toHaveLength(1);
  });
});
