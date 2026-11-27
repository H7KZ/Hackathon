/**
 * Pure mappings between API data and the presenter's view models (live mode). No fetch, no state:
 * unit-testable without a browser. Numbers are only reshaped (averaged, indexed), never invented.
 */
import type { DatasetEvidence, GenerationSettings } from "@s2d/api";
import type { MetricDiff, TablePreview } from "@s2d/schema/evidence";
import { DEFAULT_CONFIG, normalize } from "./config";
import { addDays, daysBetween } from "./curve";
import { makeTime } from "./time";
import type {
  CompareView,
  DatasetView,
  ExpectationToggle,
  Marker,
  SeriesRow,
  StoryConfig,
  StoryPointEdit,
} from "./surfaces";

export type StoryArtifact = {
  storyPoints: {
    id: string;
    phase?: number;
    title: string;
    description: string;
    start: string;
    end?: string;
    entity?: { name: string; ids: string[] };
  }[];
  curves: {
    id: string;
    baseline: number;
    segments: { kind: string; start: string; end?: string; to: number; storyPointId?: string }[];
  }[];
  expectations: { id: string; description: string }[];
};

type Series = DatasetEvidence["series"][number];

// ---------- 04_story <-> curve editor ----------

/** The curve the editor shows: the one most story points drive (ties: the first). */
export function editedCurveIndex(story: StoryArtifact): number {
  let best = 0;
  let bestCount = -1;
  story.curves.forEach((c, i) => {
    const n = c.segments.filter((s) => s.storyPointId).length;
    if (n > bestCount) {
      best = i;
      bestCount = n;
    }
  });
  return best;
}

const knotIds = (story: StoryArtifact): Set<string> => {
  const curve = story.curves[editedCurveIndex(story)];
  return new Set(curve?.segments.flatMap((s) => (s.storyPointId ? [s.storyPointId] : [])) ?? []);
};

/** Days a curve value is shown with: 0.05 → 0.01, 3 → 0.1, 120 → 5. */
function niceStep(range: number): number {
  const raw = range / 60;
  if (!(raw > 0)) return 0.1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 2 ? 1 : m < 5 ? 2 : 5) * p;
}

/**
 * 04_story → editor model. Only story points that drive the edited curve become draggable knots;
 * outcome points (stockouts, complaints) and the baseline phase stay as they are in the story.
 */
export function storyToEdit(story: StoryArtifact): {
  points: StoryPointEdit[];
  config: StoryConfig;
  expectations: ExpectationToggle[];
} {
  const curve = story.curves[editedCurveIndex(story)];
  const knots = knotIds(story);
  const points = story.storyPoints
    .filter((p) => knots.has(p.id))
    .map((p) => {
      const seg = curve?.segments.find((x) => x.storyPointId === p.id);
      const end = seg?.end ?? p.end;
      return {
        id: p.id,
        title: p.title,
        description: p.description,
        start: seg?.start ?? p.start,
        level: seg?.to ?? curve?.baseline ?? 0,
        ...(end && { end }),
      };
    });
  const dates = story.storyPoints.flatMap((p) => [p.start, ...(p.end ? [p.end] : [])]).sort();
  const from = addDays(dates[0] ?? DEFAULT_CONFIG.time.from, -14);
  const last = dates.at(-1) ?? addDays(from, 180);
  const days = Math.max(60, daysBetween(from, last) + 30);
  const baseline = curve?.baseline ?? 0;
  const levels = [baseline, ...points.map((x) => x.level)];
  const min = Math.min(0, ...levels);
  const top = Math.max(...levels);
  const max = top > 0 ? (top <= 1 ? Math.min(1, Math.ceil(top * 14) / 10) : Math.ceil(top * 1.4)) : 1;
  return {
    points,
    config: normalize({
      ...DEFAULT_CONFIG,
      time: makeTime(from, days, "days", "day"),
      curve: {
        ...DEFAULT_CONFIG.curve,
        label: curve ? `Parametr ${curve.id.replace(/_/g, " ")}` : DEFAULT_CONFIG.curve.label,
        unit: "",
        baseline,
        min,
        max,
        step: niceStep(max - min),
      },
    }),
    expectations: story.expectations.map((e) => ({ id: e.id, description: e.description, enabled: true })),
  };
}

/** Editor model → 04_story: knots update their story points and segments; other points stay untouched. */
export function editToStory(
  story: StoryArtifact,
  edited: StoryPointEdit[],
  baseline?: number,
): StoryArtifact {
  const ci = editedCurveIndex(story);
  const curve = story.curves[ci];
  const knots = knotIds(story);
  const byId = new Map(edited.map((e) => [e.id, e]));
  const maxPhase = story.storyPoints.reduce((m, p) => Math.max(m, p.phase ?? 0), 0);
  const known = new Set(story.storyPoints.map((p) => p.id));
  const toPoint = (old: StoryArtifact["storyPoints"][number] | undefined, e: StoryPointEdit, i: number) => {
    const { level: _level, end, ...rest } = e;
    const { end: _oldEnd, ...base } = old ?? { phase: maxPhase + i + 1 };
    return { ...base, ...rest, ...(end && { end }) };
  };
  const storyPoints = [
    ...story.storyPoints.flatMap((p) => {
      if (!knots.has(p.id)) return [p];
      const e = byId.get(p.id);
      return e ? [toPoint(p, e, 0)] : []; // a deleted knot is removed from the story
    }),
    ...edited.filter((e) => !known.has(e.id)).map((e, i) => toPoint(undefined, e, i)),
  ];
  if (!curve) return { ...story, storyPoints };
  const segments = [
    ...curve.segments.filter((s) => !s.storyPointId),
    ...edited.map((e) => {
      const old = curve.segments.find((s) => s.storyPointId === e.id);
      return {
        kind: old?.kind ?? "ramp",
        start: e.start,
        to: e.level,
        storyPointId: e.id,
        ...(e.end && { end: e.end }),
      };
    }),
  ].sort((x, y) => x.start.localeCompare(y.start));
  const curves = story.curves.map((c, i) =>
    i === ci ? { ...c, baseline: baseline ?? c.baseline, segments } : c,
  );
  return { ...story, storyPoints, curves };
}

/** What "Generovat data" sends with approve: the settings the API applies to the scenario. */
export function settingsFrom(config: StoryConfig | undefined, expectations: ExpectationToggle[] | undefined) {
  const settings: GenerationSettings = {};
  if (config) {
    settings.seed = Math.round(config.seed);
    settings.scale = config.scale;
    settings.noise = { ...config.noise };
  }
  if (expectations?.length) settings.expectations = expectations.filter((e) => e.enabled).map((e) => e.id);
  return settings;
}

// ---------- evidence → dataset view ----------

/** Story points that change something (phase >= 1), one marker per date. */
export function storyMarkers(story: StoryArtifact | null): Marker[] {
  const byDate = new Map<string, string[]>();
  for (const p of story?.storyPoints ?? []) {
    if ((p.phase ?? 1) < 1) continue;
    byDate.set(p.start, [...(byDate.get(p.start) ?? []), p.title]);
  }
  return [...byDate]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => ({ date, label: t.join(" · ") }));
}

const seriesKey = (s: Series) => `${s.table}.${s.dateColumn}.${s.metric}`;

export function seriesLabel(s: Series, multiDate: boolean): string {
  const what = s.metric === "rows" ? "počet záznamů" : `součet ${s.metric.replace(/\.sum$/, "")}`;
  return `${s.table} · ${what}${multiDate ? ` (${s.dateColumn})` : ""}`;
}

/** 7-day trailing mean, so days with 0–3 complaints read as a trend instead of noise. */
function rolling(points: Series["points"], window = 7): { day: string; value: number }[] {
  let sum = 0;
  return points.map((p, i) => {
    sum += p.value;
    if (i >= window) sum -= points[i - window]?.value ?? 0;
    return { day: p.day, value: sum / Math.min(i + 1, window) };
  });
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** How much a series moves after the first story point, relative to before it. */
function movement(s: Series, cut: string | undefined): { before: number; change: number } {
  const before = mean(s.points.filter((p) => !cut || p.day < cut).map((p) => p.value));
  const after = mean(s.points.filter((p) => cut && p.day >= cut).map((p) => p.value));
  return { before, change: before > 0 ? Math.abs(after / before - 1) : 0 };
}

/**
 * The series worth plotting: the ones that move most after the story starts, at most one per
 * table and date column, indexed to "before the story = 100" so different units share one axis.
 */
export function pickSeries(series: Series[], cut: string | undefined, max = 5) {
  const multiDate = new Set(
    Object.entries(
      series.reduce<Record<string, Set<string>>>((m, s) => {
        (m[s.table] ??= new Set()).add(s.dateColumn);
        return m;
      }, {}),
    )
      .filter(([, d]) => d.size > 1)
      .map(([t]) => t),
  );
  const ranked = series
    .map((s) => ({ s, ...movement(s, cut) }))
    .filter((x) => x.before > 0)
    .sort((a, b) => b.change - a.change);
  const seen = new Set<string>();
  const picked: typeof ranked = [];
  for (const x of ranked) {
    const group = `${x.s.table}.${x.s.dateColumn}`;
    if (seen.has(group)) continue;
    seen.add(group);
    picked.push(x);
    if (picked.length >= max) break;
  }
  return picked.map((x) => ({
    key: seriesKey(x.s),
    label: seriesLabel(x.s, multiDate.has(x.s.table)),
    points: rolling(x.s.points).map((p) => ({ day: p.day, value: (p.value / x.before) * 100 })),
  }));
}

function toRows(lines: { key: string; points: { day: string; value: number }[] }[]): SeriesRow[] {
  const byDay = new Map<string, SeriesRow>();
  for (const l of lines) {
    for (const p of l.points) {
      const row = byDay.get(p.day) ?? { day: p.day };
      row[l.key] = Math.round(p.value * 10) / 10;
      byDay.set(p.day, row);
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

const columnFormat = (type: string) =>
  /^(DATE|TIMESTAMP)/i.test(type)
    ? "date"
    : /INT|DOUBLE|FLOAT|DECIMAL|REAL/i.test(type)
      ? "number"
      : undefined;

export function tablesToView(previews: TablePreview[]): DatasetView["tables"] {
  return previews.map((t) => ({
    name: t.name,
    label: `${t.name} · ${t.rows.toLocaleString("cs-CZ")} řádků (ukázka prvních ${String(t.rowsShown.length)})`,
    columns: t.columns.map((c) => {
      const format = /_id$|^id$/.test(c.name) ? undefined : columnFormat(c.type);
      return { key: c.name, label: c.name, ...(format && { format }) };
    }),
    rows: t.rowsShown,
  }));
}

export function evidenceToView(
  datasetId: string,
  ev: DatasetEvidence,
  story: StoryArtifact | null,
  tables: { previews: TablePreview[]; rows: number; count: number } | null = null,
): DatasetView {
  const markers = storyMarkers(story);
  const lines = pickSeries(ev.series, markers[0]?.date);
  const days = new Set(ev.series.flatMap((s) => s.points.map((p) => p.day))).size;
  const describe = new Map(story?.expectations.map((e) => [e.id, e.description]));
  return {
    datasetId,
    totals: { rows: tables?.rows ?? Number.NaN, tables: tables?.count ?? Number.NaN, days },
    seriesTitle: "Co se v datech pohnulo · 7denní průměr, index (před příběhem = 100)",
    series: toRows(lines),
    seriesLines: lines.map((l) => ({ key: l.key, label: l.label })),
    markers,
    expectations: ev.expectations.map((e) => ({
      id: e.id,
      description: describe.get(e.id) ?? e.id,
      before: e.before,
      after: e.after,
      relChange: e.relChange,
      pass: e.pass,
    })),
    tables: tables ? tablesToView(tables.previews) : [],
  };
}

// ---------- compare ----------

/** `<table>.rows` / `<table>.<col>.sum` metric name of a series (as compare names them). */
const metricOf = (s: Series) => `${s.table}.${s.metric}`;

export function compareToView(
  a: string,
  b: string,
  question: string,
  diff: MetricDiff[],
  evA: DatasetEvidence,
  evB: DatasetEvidence,
  story: StoryArtifact | null,
): CompareView {
  const changed = diff
    .filter((d) => d.delta !== 0 && d.delta !== null)
    .sort((x, y) => Math.abs(y.relChange ?? 0) - Math.abs(x.relChange ?? 0));
  // the plotted metric: the most changed one that has a daily series
  const top = changed.find((d) => evB.series.some((s) => metricOf(s) === d.metric));
  const sB = top ? evB.series.find((s) => metricOf(s) === top.metric) : evB.series[0];
  const sA = sB && evA.series.find((s) => seriesKey(s) === seriesKey(sB));
  const base = new Map(rolling(sA?.points ?? []).map((p) => [p.day, p.value]));
  return {
    a,
    b,
    question,
    metric: sB ? `${seriesLabel(sB, false)} · 7denní průměr` : "",
    markers: storyMarkers(story),
    series: rolling(sB?.points ?? []).map((p) => ({
      day: p.day,
      a: Math.round((base.get(p.day) ?? 0) * 10) / 10,
      b: Math.round(p.value * 10) / 10,
    })),
    diff: (changed.length ? changed : diff).map((d) => ({
      metric: d.metric,
      a: d.a,
      b: d.b,
      relChange: d.relChange,
    })),
  };
}
