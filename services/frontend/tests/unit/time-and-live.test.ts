import { describe, expect, it } from "vitest";
import { effectiveRamp, fitInto } from "../../lib/chat/curve";
import { editToStory, storyToEdit } from "../../lib/chat/liveSource";
import { endOf, makeTime, samplesPerEntity } from "../../lib/chat/time";

describe("time ranges", () => {
  it("computes inclusive end dates per unit", () => {
    expect(endOf("2026-01-05", 10, "days")).toBe("2026-01-14");
    expect(endOf("2026-01-05", 2, "weeks")).toBe("2026-01-18");
    expect(endOf("2026-01-31", 1, "months")).toBe("2026-03-02");
    expect(endOf("2026-01-05", 4, "years")).toBe("2030-01-04");
  });

  it("counts records per entity by granularity and clamps silly lengths", () => {
    expect(samplesPerEntity(makeTime("2026-01-01", 7, "days", "hour"))).toBe(168);
    expect(samplesPerEntity(makeTime("2026-01-01", 4, "years", "day"))).toBe(1461);
    expect(makeTime("2026-01-01", 9999, "years", "day").length).toBe(10);
  });

  it("keeps the ramp shorter than an eighth of the range and fits points into a range", () => {
    expect(effectiveRamp(14, "2026-01-01", "2026-01-14")).toBe(1);
    expect(effectiveRamp(14, "2026-01-01", "2026-12-31")).toBe(14);
    const fitted = fitInto(
      [
        { id: "a", start: "2026-03-01", level: 1 },
        { id: "b", start: "2026-05-01", end: "2026-06-01", level: 2 },
      ],
      "2027-01-01",
      "2027-01-31",
    );
    expect(fitted.map((k) => k.start)).toEqual(["2027-01-04", "2027-01-20"]);
    expect(fitted[1]?.end).toBe("2027-01-28");
  });
});

describe("live mapping 04_story <-> curve editor", () => {
  const story = {
    storyPoints: [
      { id: "sp1", phase: 1, title: "Zpoždění", description: "d", start: "2026-03-02" },
      { id: "sp2", phase: 2, title: "Storna", description: "e", start: "2026-04-01", end: "2026-05-01" },
    ],
    curves: [
      {
        id: "late_prob",
        baseline: 0.05,
        segments: [
          { kind: "ramp", start: "2026-03-02", to: 0.4, storyPointId: "sp1" },
          { kind: "step", start: "2026-04-01", end: "2026-05-01", to: 0.6, storyPointId: "sp2" },
        ],
      },
    ],
    expectations: [{ id: "e1", description: "Zpoždění roste" }],
  };

  it("reads levels and end dates from the curve segments", () => {
    const edit = storyToEdit(story);
    expect(edit.points).toEqual([
      { id: "sp1", title: "Zpoždění", description: "d", start: "2026-03-02", level: 0.4 },
      { id: "sp2", title: "Storna", description: "e", start: "2026-04-01", end: "2026-05-01", level: 0.6 },
    ]);
    expect(edit.config.curve).toMatchObject({ baseline: 0.05, label: "Pravděpodobnost pozdní dodávky" });
    expect(edit.expectations).toEqual([{ id: "e1", description: "Zpoždění roste", enabled: true }]);
  });

  it("writes edits back: moved, added and deleted points update story points and segments", () => {
    const edit = storyToEdit(story);
    const sp1 = edit.points[0];
    if (!sp1) throw new Error("no point");
    const next = editToStory(story, [
      { ...sp1, start: "2026-02-20", level: 0.5 },
      { id: "sp3", title: "Nový bod", description: "", start: "2026-06-01", level: 0.2 },
    ]);
    expect(next.storyPoints.map((p) => [p.id, p.start, p.phase])).toEqual([
      ["sp1", "2026-02-20", 1],
      ["sp3", "2026-06-01", 3],
    ]);
    expect(next.curves[0]?.segments).toEqual([
      { kind: "ramp", start: "2026-02-20", to: 0.5, storyPointId: "sp1" },
      { kind: "ramp", start: "2026-06-01", to: 0.2, storyPointId: "sp3" },
    ]);
    expect(next.storyPoints[0]).not.toHaveProperty("level");
  });
});

describe("live mapping is stable", () => {
  it("round-tripping an unedited story is a no-op (Generate without edits does not PUT)", () => {
    const story = {
      storyPoints: [{ id: "sp1", phase: 1, title: "A", description: "", start: "2026-03-02" }],
      curves: [
        {
          id: "c",
          baseline: 1,
          segments: [{ kind: "ramp", start: "2026-03-02", to: 2, storyPointId: "sp1" }],
        },
      ],
      expectations: [],
    };
    const edit = storyToEdit(story);
    const once = editToStory(story, edit.points, edit.config.curve.baseline);
    const twice = editToStory(once, storyToEdit(once).points, storyToEdit(once).config.curve.baseline);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
