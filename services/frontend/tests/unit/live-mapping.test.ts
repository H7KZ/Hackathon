import { describe, expect, it } from "vitest";
import type { DatasetEvidence } from "@s2d/schema/api";
import {
  compareToView,
  editToStory,
  evidenceToView,
  pickSeries,
  settingsFrom,
  storyMarkers,
  storyToEdit,
  type StoryArtifact,
} from "../../lib/chat/liveMapping";
import { humanError } from "../../lib/chat/liveSource";
import { DEFAULT_CONFIG } from "../../lib/chat/config";

/** Shape of a real 04_story (live run): a baseline phase, one driving point, two outcome points. */
const story: StoryArtifact = {
  storyPoints: [
    {
      id: "sp_baseline",
      phase: 0,
      title: "Běžný provoz",
      description: "",
      start: "2025-01-01",
      end: "2025-02-28",
    },
    {
      id: "sp_late",
      phase: 1,
      title: "Dodavatel zpožďuje",
      description: "",
      start: "2025-03-01",
      end: "2025-05-31",
      entity: { name: "supplier", ids: ["SUP-001"] },
    },
    {
      id: "sp_stock",
      phase: 2,
      title: "Výpadky zásob",
      description: "",
      start: "2025-03-01",
      end: "2025-05-31",
    },
  ],
  curves: [
    { id: "demand", baseline: 1, segments: [] },
    {
      id: "late_prob",
      baseline: 0.05,
      segments: [{ kind: "step", start: "2025-03-01", to: 0.7, storyPointId: "sp_late" }],
    },
  ],
  expectations: [
    { id: "e1", description: "Pozdní dodávky rostou" },
    { id: "e2", description: "Kontrola" },
  ],
};

describe("storyToEdit / editToStory on a real-shaped story", () => {
  it("only points that drive the curve become knots; slider bounds fit a probability", () => {
    const edit = storyToEdit(story);
    expect(edit.points.map((p) => p.id)).toEqual(["sp_late"]);
    expect(edit.points[0]).toMatchObject({ level: 0.7, start: "2025-03-01", end: "2025-05-31" });
    expect(edit.config.curve).toMatchObject({
      baseline: 0.05,
      min: 0,
      max: 1,
      label: "Pravděpodobnost pozdní dodávky",
    });
    expect(edit.config.curve.step).toBeLessThanOrEqual(0.02);
    expect(edit.config.time.from <= "2025-01-01").toBe(true);
    expect(edit.config.time.to >= "2025-05-31").toBe(true);
  });

  it("moving the knot changes only its point and segment; outcome points stay untouched", () => {
    const [late] = storyToEdit(story).points;
    if (!late) throw new Error("no knot");
    const next = editToStory(story, [{ ...late, start: "2025-04-01", level: 0.5 }]);
    expect(next.storyPoints.find((p) => p.id === "sp_stock")).toEqual(story.storyPoints[2]);
    expect(next.storyPoints.find((p) => p.id === "sp_baseline")).toEqual(story.storyPoints[0]);
    expect(next.storyPoints.find((p) => p.id === "sp_late")).toMatchObject({
      start: "2025-04-01",
      entity: { ids: ["SUP-001"] },
    });
    expect(next.curves[0]).toEqual(story.curves[0]);
    expect(next.curves[1]?.segments).toEqual([
      { kind: "step", start: "2025-04-01", to: 0.5, storyPointId: "sp_late", end: "2025-05-31" },
    ]);
  });

  it("a point added in the editor names the same entity as the curve's other points (user run: A5 failed 5× on it)", () => {
    const [late] = storyToEdit(story).points;
    if (!late) throw new Error("no knot");
    const added = { id: "sp1", title: "Nový bod", description: "", start: "2025-04-15", level: 0.9 };
    const next = editToStory(story, [late, added]);
    expect(next.storyPoints.find((p) => p.id === "sp1")).toMatchObject({
      phase: 3,
      entity: { name: "supplier", ids: ["SUP-001"] },
    });
  });

  it("a point added on a curve scoped to a group copies the group segment", () => {
    const grouped: StoryArtifact = {
      ...story,
      storyPoints: story.storyPoints.map(({ entity: _e, ...p }) =>
        p.id === "sp_late" ? { ...p, segment: { field: "key.segment", values: ["kampaň"] } } : p,
      ),
    };
    const [late] = storyToEdit(grouped).points;
    if (!late) throw new Error("no knot");
    const next = editToStory(grouped, [
      late,
      { id: "sp1", title: "Nový bod", description: "", start: "2025-04-15", level: 0.9 },
    ]);
    const added = next.storyPoints.find((p) => p.id === "sp1");
    expect(added?.segment).toEqual({ field: "key.segment", values: ["kampaň"] });
    expect(added?.entity).toBeUndefined();
  });

  it("an unedited round trip is a no-op", () => {
    const e = storyToEdit(story);
    const once = editToStory(story, e.points, e.config.curve.baseline);
    const again = editToStory(once, storyToEdit(once).points, storyToEdit(once).config.curve.baseline);
    expect(JSON.stringify(again)).toBe(JSON.stringify(once));
  });
});

describe("settingsFrom", () => {
  it("sends seed, scale, noise and the enabled hypotheses", () => {
    const s = settingsFrom({ ...DEFAULT_CONFIG, seed: 7.4 }, [
      { id: "e1", description: "", enabled: true },
      { id: "e2", description: "", enabled: false },
    ]);
    expect(s).toEqual({
      seed: 7,
      scale: 1,
      noise: { missing: 2, duplicates: 1, hourJitter: true },
      expectations: ["e1"],
    });
  });
});

const days = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10));
const series = (table: string, metric: string, f: (day: string) => number, dateColumn = "date") => ({
  table,
  dateColumn,
  metric,
  points: days("2025-01-01", 150).map((day) => ({ day, value: f(day) })),
});
const evidence: DatasetEvidence = {
  expectations: [{ id: "e1", pass: true, before: 0.05, after: 0.7, relChange: 13 }],
  series: [
    series("sale", "rows", (d) => (d < "2025-03-01" ? 100 : 70)),
    series("sale", "quantity.sum", (d) => (d < "2025-03-01" ? 300 : 200)),
    series("store", "rows", () => 5),
    series("complaint", "rows", (d) => (d < "2025-03-01" ? 2 : 6)),
  ],
};

describe("evidence → dataset view", () => {
  it("markers: one per date, phase 0 left out", () => {
    expect(storyMarkers(story)).toEqual([
      { date: "2025-03-01", label: "Dodavatel zpožďuje · Výpadky zásob" },
    ]);
  });

  it("plots the series that move most, one per table, flat ones left out, each scaled to its max = 100", () => {
    const lines = pickSeries(evidence.series, "2025-03-01");
    expect(lines.map((l) => l.key)).toEqual(["complaint.date.rows", "sale.date.quantity.sum"]);
    expect(lines[0]?.label).toBe("complaint · počet záznamů");
    expect(lines[0]?.points[10]?.value).toBeCloseTo(33.3, 1);
    expect(lines[0]?.points.at(-1)?.value).toBe(100);
  });

  it("skips the ts duplicate that hourJitter adds next to the date column", () => {
    const withTs = [...evidence.series, series("complaint", "rows", (d) => (d < "2025-03-01" ? 2 : 6), "ts")];
    const lines = pickSeries(withTs, "2025-03-01");
    expect(lines.filter((l) => l.key.startsWith("complaint."))).toHaveLength(1);
    expect(lines[0]?.label).toBe("complaint · počet záznamů");
  });

  it("totals and tables come from the tables endpoint; descriptions from the story", () => {
    const view = evidenceToView("d1", evidence, story, {
      rows: 1234,
      count: 2,
      previews: [
        {
          name: "sale",
          rows: 1200,
          columns: [
            { name: "id", type: "VARCHAR" },
            { name: "date", type: "DATE" },
            { name: "store_id", type: "BIGINT" },
            { name: "quantity", type: "BIGINT" },
          ],
          rowsShown: [{ id: "sale-1", date: "2025-01-01", store_id: 1, quantity: 3 }],
        },
      ],
    });
    expect(view.totals).toEqual({ rows: 1234, tables: 2, days: 150 });
    expect(view.expectations[0]?.description).toBe("Pozdní dodávky rostou");
    expect(view.tables[0]?.columns.map((c) => c.format)).toEqual([undefined, "date", undefined, "number"]);
    expect(Object.keys(view.series[0] ?? {})).toContain("complaint.date.rows");
  });
});

describe("compareToView", () => {
  it("plots the most changed metric that has a series and lists only changed metrics", () => {
    const evB: DatasetEvidence = {
      ...evidence,
      series: evidence.series.map((s) =>
        s.table === "sale" && s.metric === "rows"
          ? { ...s, points: s.points.map((p) => ({ ...p, value: 100 })) }
          : s,
      ),
    };
    const v = compareToView(
      "d1",
      "d2",
      "Co kdyby…",
      [
        { metric: "store.rows", a: 5, b: 5, delta: 0, relChange: 0 },
        { metric: "sale.rows", a: 12000, b: 15000, delta: 3000, relChange: 0.25 },
        { metric: "complaint.rows", a: 600, b: 650, delta: 50, relChange: 0.08 },
      ],
      evidence,
      evB,
      story,
    );
    expect(v.diff.map((d) => d.metric)).toEqual(["sale.rows", "complaint.rows"]);
    expect(v.metric).toContain("sale · počet záznamů");
    expect(v.series.at(-1)).toMatchObject({ a: 70, b: 100 });
    expect(v.markers).toHaveLength(1);
  });
});

describe("humanError", () => {
  it("explains offline cache misses in Czech", () => {
    expect(humanError("LLM_OFFLINE=1 and no cache entry for what_if (key x)")).toMatch(/živý jazykový model/);
    expect(humanError("něco jiného")).toBe("něco jiného");
  });
});

describe("datetime format", () => {
  it("shows the time of TIMESTAMP cells", async () => {
    const { formatValue } = await import("../../lib/format");
    expect(formatValue("2025-02-01 09:41:00", "datetime")).toBe("1. 2. 2025 09:41");
    expect(formatValue("2025-02-01", "datetime")).toBe("1. 2. 2025");
  });
});

describe("markers follow the curve", () => {
  it("a what-if that moved a segment moves its marker; points without a segment keep their date", () => {
    const moved: StoryArtifact = {
      ...story,
      curves: story.curves.map((c) => ({
        ...c,
        segments: c.segments.map((s) => ({ ...s, start: "2025-04-01" })),
      })),
    };
    expect(storyMarkers(moved)).toEqual([
      { date: "2025-03-01", label: "Výpadky zásob" },
      { date: "2025-04-01", label: "Dodavatel zpožďuje" },
    ]);
  });
});

describe("run-4 follow-up: readable curve, attempts, period", () => {
  it("names a curve in Czech from its id; unknown words stay quoted", async () => {
    const { curveLabel } = await import("../../lib/chat/liveMapping");
    expect(curveLabel("late_prob")).toBe("Pravděpodobnost pozdní dodávky");
    expect(curveLabel("order_rate")).toBe("Četnost objednávek");
    expect(curveLabel("demand_mult")).toBe("Násobek poptávky");
    expect(curveLabel("wibble_prob")).toBe("Pravděpodobnost „wibble“");
    expect(curveLabel("foo")).toBe("Páka příběhu „foo“");
  });

  it("the editor explains the curve: id, baseline, percent hint and the points that bend it", () => {
    const edit = storyToEdit(story);
    expect(edit.config.curve.help).toMatch(/pravděpodobnost pozdní dodávky \(v datech „late_prob“\)/);
    expect(edit.config.curve.help).toMatch(/0,3 znamená 30 %/);
    expect(edit.config.curve.help).toMatch(/„Dodavatel zpožďuje“/);
    expect(edit.config.time.auto).toBe(true);
  });

  it("a failed attempt reads as the hypothesis and its numbers, never the raw English", async () => {
    const { attemptDetail } = await import("../../lib/chat/liveMapping");
    const msg =
      'Expectation "exp_complaints_up" (Počet stížností vzroste.) failed: before 0.5, after 0.4762 (change -4.8%); it needs an increase of at least +30%. The curves and expectations are fixed';
    expect(attemptDetail(1, false, [{ path: "expectations[2]", message: msg }])).toBe(
      "pokus 1: hypotéza „Počet stížností vzroste.“ zatím nevychází (změna −4,8 %, potřeba +30 %). Agent zesiluje řetězec příčin.",
    );
    expect(
      attemptDetail(2, false, [
        { path: "a", message: "x" },
        { path: "b", message: "y" },
      ]),
    ).toBe("pokus 2: agent opravuje 2 chyby ve scénáři");
    expect(attemptDetail(3, true, [])).toBe("příběh v datech sedí (3. pokus)");
  });

  it("chart series stop at the scenario end (derived dates past it stretched the axis)", () => {
    const view = evidenceToView("dat1", evidence, {
      ...story,
      meta: { start: "2025-01-01", end: "2025-03-31" },
    });
    expect(view.series.at(-1)?.day).toBe("2025-03-31");
    expect(view.totals.days).toBe(90);
  });

  it("live: granularity decides the time of day; a custom period is sent, auto is not", () => {
    const live = storyToEdit(story).config;
    const auto = settingsFrom(live, undefined);
    expect(auto.period).toBeUndefined();
    expect(auto.noise?.hourJitter).toBe(true);
    const custom = settingsFrom(
      {
        ...live,
        time: { ...live.time, auto: false, granularity: "day", from: "2024-10-01", to: "2025-09-30" },
      },
      undefined,
    );
    expect(custom.period).toEqual({ start: "2024-10-01", end: "2025-09-30" });
    expect(custom.noise?.hourJitter).toBe(false);
  });
});
