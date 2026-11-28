import { describe, expect, it } from "vitest";
import { editToStory, storyToEdit } from "../../lib/chat/liveSource";
import { storySurface } from "../../lib/chat/surfaces";

// shaped like a live run: supplier delay (2 points, scoped) + shipping price story that bends two curves
const story = {
  storyPoints: [
    { id: "sp_delay", phase: 1, title: "Zpoždění", description: "", start: "2025-03-01", end: "2025-06-14" },
    { id: "sp_shipping", phase: 2, title: "Dražší doprava", description: "", start: "2025-05-01" },
    { id: "sp_recovery", phase: 3, title: "Návrat", description: "", start: "2025-06-15" },
  ],
  curves: [
    {
      id: "delay_prob",
      baseline: 0.05,
      scope: { field: "self.supplier_id", ids: ["SUP-001"] },
      segments: [
        { kind: "ramp", start: "2025-03-01", to: 0.33, storyPointId: "sp_delay" },
        { kind: "ramp", start: "2025-06-15", to: 0.05, storyPointId: "sp_recovery" },
      ],
    },
    {
      id: "shipping_fee",
      baseline: 99,
      segments: [{ kind: "step", start: "2025-05-01", to: 199, storyPointId: "sp_shipping" }],
    },
    {
      id: "checkout_prob",
      baseline: 0.6,
      segments: [{ kind: "ramp", start: "2025-05-03", to: 0.45, storyPointId: "sp_shipping" }],
    },
    { id: "traffic", baseline: 100, segments: [] },
  ],
  expectations: [],
};

describe("every lever is editable", () => {
  it("offers each curve that a story point bends, the busiest first; flat curves are left out", () => {
    const edit = storyToEdit(story);
    expect(edit.config.curve.baseline).toBe(0.05);
    expect(edit.points.map((p) => p.id)).toEqual(["sp_delay", "sp_recovery"]);
    expect(edit.levers.map((l) => l.curveId)).toEqual(["shipping_fee", "checkout_prob"]);
    const fee = edit.levers[0];
    expect(fee).toMatchObject({
      baseline: 99,
      points: [{ id: "sp_shipping", start: "2025-05-01", level: 199, kind: "step" }],
    });
    expect(fee?.max).toBeGreaterThanOrEqual(199);
    // its own segment's start, not the point's
    expect(edit.levers[1]?.points[0]).toMatchObject({ start: "2025-05-03", level: 0.45 });
  });

  it("writes a second lever's edit into its own curve only", () => {
    const edit = storyToEdit(story);
    const fee = edit.levers[0];
    const pt = fee?.points[0];
    if (!fee || !pt) throw new Error("no lever");
    const next = editToStory(story, edit.points, edit.config.curve.baseline, [
      { curveId: "shipping_fee", baseline: 79, points: [{ ...pt, level: 149 }] },
      ...edit.levers.slice(1),
    ]);
    expect(next.curves[1]).toMatchObject({
      baseline: 79,
      segments: [{ kind: "step", start: "2025-05-01", to: 149, storyPointId: "sp_shipping" }],
    });
    // the other curve bent by the same point and the main lever are untouched (main: as a round trip leaves it)
    expect(next.curves[2]).toEqual(story.curves[2]);
    expect(next.curves[0]).toEqual(editToStory(story, edit.points, edit.config.curve.baseline).curves[0]);
    expect(next.storyPoints).toEqual(story.storyPoints);
  });

  it("moving a shared point moves the story point but not the other curve's segment", () => {
    const edit = storyToEdit(story);
    const pt = edit.levers[0]?.points[0];
    if (!pt) throw new Error("no point");
    const next = editToStory(story, edit.points, undefined, [
      { curveId: "shipping_fee", points: [{ ...pt, start: "2025-04-01" }] },
      ...edit.levers.slice(1),
    ]);
    expect(next.storyPoints.find((p) => p.id === "sp_shipping")?.start).toBe("2025-04-01");
    expect(next.curves[2]?.segments[0]?.start).toBe("2025-05-03");
  });

  it("deleting a shared point in one lever keeps it while another curve still uses it", () => {
    const edit = storyToEdit(story);
    const next = editToStory(story, edit.points, undefined, [
      { curveId: "shipping_fee", points: [] },
      ...edit.levers.slice(1),
    ]);
    expect(next.curves[1]?.segments).toEqual([]);
    expect(next.storyPoints.map((p) => p.id)).toContain("sp_shipping");
  });

  it("a point added in a second lever gets an id no other point has, and the scope of its curve", () => {
    const edit = storyToEdit(story);
    const next = editToStory(story, edit.points, undefined, [
      ...edit.levers.slice(0, 1),
      {
        curveId: "checkout_prob",
        points: [
          ...(edit.levers[1]?.points ?? []),
          { id: "sp_delay", title: "Nový", description: "", start: "2025-09-01", level: 0.6 },
        ],
      },
    ]);
    const added = next.storyPoints.at(-1);
    expect(added?.id).not.toBe("sp_delay");
    expect(added).toMatchObject({ title: "Nový", start: "2025-09-01", phase: 4 });
    expect(next.storyPoints.filter((p) => p.id === "sp_delay")).toHaveLength(1);
    expect(next.curves[2]?.segments.at(-1)).toMatchObject({ storyPointId: added?.id, to: 0.6 });
  });

  it("an unedited round trip with every lever is a no-op", () => {
    const edit = storyToEdit(story);
    const once = editToStory(story, edit.points, edit.config.curve.baseline, edit.levers);
    expect(once).toEqual(editToStory(story, edit.points, edit.config.curve.baseline));
  });

  it("the live story surface shows one tab per lever and sends them with Generate", () => {
    const edit = storyToEdit(story);
    const msg = JSON.stringify(
      storySurface("story", edit.points, edit.config, edit.expectations, false, true, edit.levers),
    );
    expect(msg).toContain('"component":"Tabs"');
    expect(msg).toContain('"title":{"@path":"/levers/1/label"},"child":"lv1"');
    expect(msg).toContain('"points":{"@path":"/levers/1/points"}');
    // every lever's chart draws what the engine does (ramps hold, steps jump), like the main one
    const nodes = (
      JSON.parse(msg) as { createSurface: { components: { component: string; live?: boolean }[] } }
    ).createSurface.components;
    expect(nodes.filter((n) => n.component === "CurveEditor" && n.live).length).toBeGreaterThanOrEqual(3);
    expect(msg).toContain('"levers":{"@path":"/levers"}');
    expect(msg).toContain('"curveId":"checkout_prob"');
  });
});
