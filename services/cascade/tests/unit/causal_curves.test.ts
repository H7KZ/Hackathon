import { afterEach, describe, expect, it } from "vitest";
import { StoryOverlay } from "@s2d/schema/artifacts";
import { runCascade } from "../../src/cascade";
import { buildCurves, checkOverlay } from "../../src/causal/curves";
import { checkOverlayScenario } from "../../src/causal/overlay";
import { causalMap, overlay, processesPlan } from "./causal_fixtures";
import { company, model, setup } from "./fixtures";

const input = { story: "s", company: "c" };
const sp = (id: string, start: string, end?: string) => ({
  id,
  phase: 1,
  title: id,
  description: id,
  start,
  ...(end && { end }),
});

describe("lever matrix -> curves (D2)", () => {
  it("builds one curve per lever: scoped step for the moved lever, flat baseline for the rest", () => {
    expect(StoryOverlay.parse(overlay)).toEqual(overlay);
    expect(buildCurves(causalMap, overlay)).toEqual([
      {
        id: "late_prob",
        baseline: 0.05,
        scope: { field: "self.supplier_id", ids: ["SUP-002"] },
        segments: [{ kind: "step", start: "2025-03-01", to: 0.8, storyPointId: "sp1" }],
        clamp: [0, 1],
      },
      { id: "demand", baseline: 1, segments: [] },
    ]);
  });

  it("orders contiguous periods by date and skips values equal to the baseline", () => {
    const o = {
      storyPoints: [
        sp("b", "2025-04-01", "2025-05-01"),
        sp("a", "2025-03-01", "2025-04-01"),
        sp("c", "2025-05-01"),
      ],
      levers: [
        {
          lever: "late_prob",
          values: [
            { storyPointId: "b", value: 0.6 },
            { storyPointId: "c", value: 0.05 },
            { storyPointId: "a", value: 0.3 },
          ],
        },
      ],
    };
    const [late] = buildCurves(causalMap, o);
    expect(late?.segments).toEqual([
      { kind: "step", start: "2025-03-01", end: "2025-04-01", to: 0.3, storyPointId: "a" },
      { kind: "step", start: "2025-04-01", end: "2025-05-01", to: 0.6, storyPointId: "b" },
    ]);
  });

  it("flags non-levers, unknown story points and gaps between periods", () => {
    const bad: StoryOverlay = {
      ...overlay,
      storyPoints: [sp("a", "2025-03-01", "2025-03-20"), sp("b", "2025-04-01")],
      levers: [
        {
          lever: "late_prob",
          values: [
            { storyPointId: "a", value: 0.3 },
            { storyPointId: "b", value: 0.6 },
            { storyPointId: "zz", value: 0.1 },
          ],
        },
        { lever: "complaint", values: [{ storyPointId: "a", value: 0.5 }] },
      ],
    };
    const errors = checkOverlay(bad, causalMap);
    expect(errors.map((e) => e.path)).toEqual(
      expect.arrayContaining(["levers.0.values.2.storyPointId", "levers.0.values", "levers.1.lever"]),
    );
    expect(errors.find((e) => e.path === "levers.0.values")?.message).toMatch(
      /contiguous.*"a".end = 2025-04-01/,
    );
    expect(errors.find((e) => e.path === "levers.1.lever")?.message).toMatch(/not a lever/);
  });

  it("the built scenario must compile: a story point outside start..end is reported", () => {
    expect(checkOverlayScenario(input, "r", causalMap, processesPlan, overlay)).toEqual([]);
    const late = { ...overlay, end: "2025-02-01" };
    expect(checkOverlayScenario(input, "r", causalMap, processesPlan, late).length).toBeGreaterThan(0);
  });
});

describe("04a_overlay in the cascade", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  it("sends a matrix with an outcome row back, then writes the overlay", async () => {
    const outcome = {
      ...overlay,
      levers: [...overlay.levers, { lever: "complaint", values: [{ storyPointId: "sp1", value: 0.5 }] }],
    };
    const t = setup([company, model, causalMap, processesPlan, outcome, overlay]);
    cleanup = t.cleanup;
    const res = await runCascade(input, {
      llm: t.llm,
      runsDir: t.runsDir,
      runId: "c3",
      design: "causal",
      until: "04a_overlay",
    });
    expect(t.fake.calls.map((c) => c.schemaName).slice(-2)).toEqual(["04a_overlay", "04a_overlay"]);
    expect(t.fake.calls.at(-1)?.prompt).toContain('"complaint" is not a lever');
    expect(res.overlay).toEqual(overlay);
  });
});
