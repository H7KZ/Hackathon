/**
 * Pure mappings between API data and the presenter's view models (live mode). No fetch, no state:
 * unit-testable without a browser. Numbers are only reshaped (averaged, indexed), never invented.
 */
import type { DatasetEvidence, GenerationSettings } from "@s2d/schema/api";
import type { MetricDiff, TablePreview } from "@s2d/schema/evidence";
import { DEFAULT_CONFIG, normalize } from "./config";
import { addDays, daysBetween } from "./curve";
import { makeTime } from "./time";
import type {
  CompareView,
  DatasetView,
  ExpectationToggle,
  LeverEdit,
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
    segment?: { field: string; values: string[] };
  }[];
  curves: {
    id: string;
    baseline: number;
    scope?: { field: string; ids: string[] };
    segments: { kind: string; start: string; end?: string; to: number; storyPointId?: string }[];
  }[];
  expectations: { id: string; description: string }[];
  /** present on a dataset's scenario (05), not on 04_story */
  meta?: { start: string; end: string };
};

/**
 * Keeps only days inside the scenario period. Derived dates can run past it (a delivery ordered on
 * the last day arrives weeks later; a live run had 90–150-day delays), which stretched the shared
 * x-axis to November and made every other series look cut off at the period end.
 */
export function clipToPeriod(series: Series[], period: { start: string; end: string } | undefined): Series[] {
  if (!period) return series;
  return series.map((s) => ({
    ...s,
    points: s.points.filter((p) => p.day >= period.start && p.day <= period.end),
  }));
}

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

type Curve = StoryArtifact["curves"][number];
type StoryPoint = StoryArtifact["storyPoints"][number];

const knotsOf = (curve: Curve | undefined): Set<string> =>
  new Set(curve?.segments.flatMap((s) => (s.storyPointId ? [s.storyPointId] : [])) ?? []);

/** What comes back from the editor for one lever (baseline left out = unchanged). */
export type LeverInput = { curveId: string; points: StoryPointEdit[]; baseline?: number };

/** Indexes of the further levers: every other curve a story point bends, in story order (flat curves never move). */
function otherLeverIndexes(story: StoryArtifact): number[] {
  const main = editedCurveIndex(story);
  return story.curves.flatMap((c, i) => (i !== main && knotsOf(c).size > 0 ? [i] : []));
}

/** The knots of one curve as the editor shows them: dates and level from its own segments. */
function leverPoints(story: StoryArtifact, curve: Curve | undefined): StoryPointEdit[] {
  const knots = knotsOf(curve);
  return story.storyPoints
    .filter((p) => knots.has(p.id))
    .map((p) => {
      const seg = curve?.segments.find((x) => x.storyPointId === p.id);
      // the segment's own end: a story point's end is not where its ramp arrives
      const end = seg ? seg.end : p.end;
      return {
        id: p.id,
        title: p.title,
        description: p.description,
        start: seg?.start ?? p.start,
        level: seg?.to ?? curve?.baseline ?? 0,
        kind: seg?.kind ?? "ramp",
        ...(end && { end }),
      };
    });
}

/** Value axis of one curve: from 0 (or below) to a little above its highest level, probabilities capped at 1. */
function leverRange(curve: Curve | undefined, points: StoryPointEdit[]) {
  const baseline = curve?.baseline ?? 0;
  const levels = [baseline, ...points.map((x) => x.level)];
  const min = Math.min(0, ...levels);
  const top = Math.max(...levels);
  const max = top > 0 ? (top <= 1 ? Math.min(1, Math.ceil(top * 14) / 10) : Math.ceil(top * 1.4)) : 1;
  return { baseline, min, max, step: niceStep(max - min) };
}

/** What kind of number a curve id holds (its head noun) and the subject words, both in Czech. */
const CURVE_KIND: [RegExp, string][] = [
  [/^(prob|probability|p|chance|likelihood)$/, "Pravděpodobnost"],
  [/^(rate|freq|frequency|intensity|lambda)$/, "Četnost"],
  [/^(mult|multiplier|factor|boost|uplift|scale)$/, "Násobek"],
  [/^(share|pct|percent|ratio|fraction)$/, "Podíl"],
  [/^(days|delay|lag|lead)$/, "Zpoždění (dny)"],
  [/^(level|index|score)$/, "Úroveň"],
  [/^(price|cost|fee)$/, "Cena"],
];
const CURVE_SUBJECT: [RegExp, string][] = [
  [/^late(ness)?$/, "pozdní dodávky"],
  [/^delays?$/, "zpoždění"],
  [/^demand$/, "poptávky"],
  [/^orders?$/, "objednávek"],
  [/^complaints?$/, "stížností"],
  [/^churn$/, "odchodu zákazníků"],
  [/^returns?$/, "vrácení zboží"],
  [/^defects?$/, "vad"],
  [/^outages?$/, "výpadků"],
  [/^(tickets?|support)$/, "požadavků na podporu"],
  [/^(visits?|traffic)$/, "návštěv"],
  [/^conversion$/, "konverze"],
  [/^checkout$/, "dokončení nákupu"],
  [/^shipping$/, "dopravy"],
  [/^campaign$/, "kampaně"],
  [/^purchases?$/, "nákupů"],
  [/^repeat$/, "opakovaného nákupu"],
  [/^sales?$/, "prodejů"],
  [/^stock(out)?s?$/, "zásob"],
  [/^(failures?|fail)$/, "selhání"],
  [/^errors?$/, "chyb"],
  [/^calls?$/, "hovorů"],
  [/^(signups?|registrations?)$/, "registrací"],
  [/^(cancel|cancellations?)$/, "storen"],
  [/^supplier$/, "dodavatele"],
  [/^customers?$/, "zákazníků"],
  [/^(delivery|deliveries)$/, "dodávek"],
  [/^quality$/, "kvality"],
  [/^discount$/, "slevy"],
];

/**
 * A curve id the user can read: "late_prob" → "Pravděpodobnost pozdní dodávky". Known English words
 * only (ids are snake_case English by convention); anything else stays quoted, so the label never
 * claims a meaning the scenario does not have.
 */
export function curveLabel(id: string): string {
  const words = id
    .toLowerCase()
    .split(/[_\-\s]+/)
    .filter(Boolean);
  // the head noun is the last kind word: "delay_prob" is a probability of delay, not a delay in days
  const kindOf = (w: string) => CURVE_KIND.find(([re]) => re.test(w))?.[1];
  const at = words.findLastIndex((w) => kindOf(w));
  const head = at >= 0 ? (kindOf(words[at] ?? "") ?? "") : "";
  const rest = words.filter((_, i) => i !== at);
  const known = rest.map((w) => CURVE_SUBJECT.find(([re]) => re.test(w))?.[1]);
  if (known.length > 0 && known.every(Boolean)) return `${head || "Intenzita"} ${known.join(" ")}`;
  const raw = rest.join(" ") || id;
  return head ? `${head} „${raw}“` : `Páka příběhu „${raw}“`;
}

/** One sentence under the curve: what it is, what bends it, where it applies. */
function curveHelp(story: StoryArtifact, curve: StoryArtifact["curves"][number] | undefined): string {
  if (!curve) return "";
  const label = curveLabel(curve.id);
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  const scope = curve.scope?.ids.length
    ? ` Platí jen pro ${curve.scope.ids.slice(0, 4).join(", ")}${curve.scope.ids.length > 4 ? "…" : ""}.`
    : "";
  const prob =
    curve.baseline <= 1 && /prob|_p$|^p_|share|rate/.test(curve.id) ? " Hodnota 0,3 znamená 30 %." : "";
  const points = story.storyPoints.filter((p) => curve.segments.some((s) => s.storyPointId === p.id));
  const bends = points.length
    ? ` Ohýbají ji body příběhu (${points.map((p) => `„${p.title}“`).join(", ")}).`
    : "";
  return `Křivka ukazuje, jak se v čase mění ${lower} (v datech „${curve.id}“), z výchozí hodnoty ${String(curve.baseline).replace(".", ",")}.${prob}${scope}${bends} Výsledné metriky nikdo nepřepisuje: změny prodejů, zásob nebo stížností vzniknou samy přes procesy.`;
}

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
  /** every further curve a story point bends (the main one is `points` + `config.curve`) */
  levers: LeverEdit[];
} {
  const curve = story.curves[editedCurveIndex(story)];
  const points = leverPoints(story, curve);
  const dates = story.storyPoints.flatMap((p) => [p.start, ...(p.end ? [p.end] : [])]).sort();
  const from = addDays(dates[0] ?? DEFAULT_CONFIG.time.from, -14);
  const last = dates.at(-1) ?? addDays(from, 180);
  const days = Math.max(60, daysBetween(from, last) + 30);
  const range = leverRange(curve, points);
  const levers = otherLeverIndexes(story).flatMap((i) => {
    const c = story.curves[i];
    if (!c) return [];
    const pts = leverPoints(story, c);
    return [
      {
        curveId: c.id,
        label: curveLabel(c.id),
        help: curveHelp(story, c),
        ...leverRange(c, pts),
        points: pts,
      },
    ];
  });
  return {
    points,
    config: normalize({
      ...DEFAULT_CONFIG,
      // auto: the agent picks the period; "hour" = records carry a time of day (noise hourJitter, on by default)
      time: { ...makeTime(from, days, "days", DEFAULT_CONFIG.noise.hourJitter ? "hour" : "day"), auto: true },
      curve: {
        ...DEFAULT_CONFIG.curve,
        label: curve ? curveLabel(curve.id) : DEFAULT_CONFIG.curve.label,
        help: curveHelp(story, curve),
        unit: "",
        ...range,
      },
    }),
    expectations: story.expectations.map((e) => ({ id: e.id, description: e.description, enabled: true })),
    levers,
  };
}

/** A story point id no other point has: sp<N> past the highest one in use. */
function freshId(taken: Set<string>): string {
  let n = taken.size;
  while (taken.has(`sp${String(n)}`)) n++;
  return `sp${String(n)}`;
}

/**
 * Editor model → 04_story: each lever's knots update its own curve's segments and the story points
 * they name; other points and curves stay untouched. A point several curves share follows whatever
 * the user changed on it (a lever only writes the fields that differ from what it showed), and it
 * is removed only once no curve bends it any more.
 */
export function editToStory(
  story: StoryArtifact,
  edited: StoryPointEdit[],
  baseline?: number,
  others: LeverInput[] = [],
): StoryArtifact {
  const main = story.curves[editedCurveIndex(story)];
  const inputs: LeverInput[] = [
    { curveId: main?.id ?? "", points: edited, ...(baseline !== undefined && { baseline }) },
    ...others,
  ];
  let phase = story.storyPoints.reduce((m, p) => Math.max(m, p.phase ?? 0), 0);
  const byId = new Map(story.storyPoints.map((p) => [p.id, p]));
  const taken = new Set(byId.keys());
  const added: StoryPoint[] = [];
  const touched = new Set<string>();
  const curves = [...story.curves];
  for (const input of inputs) {
    const ci = curves.findIndex((c) => c.id === input.curveId);
    const curve = curves[ci];
    const knots = knotsOf(curve);
    knots.forEach((id) => touched.add(id));
    const shown = new Map(leverPoints(story, curve).map((p) => [p.id, p]));
    // a point added here bends the same curve, so it names the same entity / group as the curve's
    // other points (the compiler rejects a curve-driving point without one; user run: A5 failed 5× on it)
    const sibling = story.storyPoints.find((p) => knots.has(p.id) && (p.entity ?? p.segment));
    const segments = (curve?.segments ?? []).filter((s) => !s.storyPointId);
    for (const e of input.points) {
      const { level, kind, end, ...fields } = e;
      let id = e.id;
      const old = shown.get(id);
      if (!old) {
        if (taken.has(id)) id = freshId(taken);
        taken.add(id);
        phase += 1;
        added.push({
          phase,
          ...(sibling?.entity && { entity: sibling.entity }),
          ...(sibling?.segment && { segment: sibling.segment }),
          ...fields,
          id,
          ...(end && { end }),
        });
      } else {
        const point = byId.get(id);
        if (point) {
          const next: StoryPoint = { ...point };
          for (const k of ["title", "description", "start"] as const)
            if (fields[k] !== old[k]) next[k] = fields[k];
          // a segment without an end (instant change) must not drop the story point's own end
          if (end !== old.end && end) next.end = end;
          if (next.end && next.end < next.start) delete next.end;
          byId.set(id, next);
        }
      }
      const seg = curve?.segments.find((s) => s.storyPointId === e.id);
      segments.push({
        kind: seg?.kind ?? kind ?? "ramp",
        start: e.start,
        to: level,
        storyPointId: id,
        ...(end && { end }),
      });
    }
    if (!curve) continue;
    segments.sort((x, y) => x.start.localeCompare(y.start));
    curves[ci] = { ...curve, baseline: input.baseline ?? curve.baseline, segments };
  }
  const bent = new Set(curves.flatMap((c) => [...knotsOf(c)]));
  const storyPoints = [
    ...story.storyPoints.flatMap((p) => {
      const point = byId.get(p.id) ?? p;
      return touched.has(p.id) && !bent.has(p.id) ? [] : [point]; // a deleted knot leaves the story
    }),
    ...added,
  ];
  return main ? { ...story, storyPoints, curves } : { ...story, storyPoints };
}

/** What "Generovat data" sends with approve: the settings the API applies to the scenario. */
export function settingsFrom(config: StoryConfig | undefined, expectations: ExpectationToggle[] | undefined) {
  const settings: GenerationSettings = {};
  if (config) {
    settings.seed = Math.round(config.seed);
    settings.scale = config.scale;
    settings.noise = { ...config.noise };
    // live (time.auto is set): the period picker decides the time of day and, if set, the period
    if (config.time.auto !== undefined) {
      settings.noise.hourJitter = config.time.granularity === "hour";
      if (!config.time.auto) settings.period = { start: config.time.from, end: config.time.to };
    }
  }
  if (expectations?.length) settings.expectations = expectations.filter((e) => e.enabled).map((e) => e.id);
  return settings;
}

// ---------- repair attempts → plain words ----------

const czNum = (s: string) => s.replace("-", "−").replace(".", ",");
const EXPECTATION_FAIL =
  /Expectation "[^"]+" \((.+?)\) failed: before (\S+), after (\S+) \(change ([-+\d.]+)%\); it needs an? (increase|decrease) of at least \+?([\d.]+)%/;

/**
 * What a failed A5 / what-if attempt means for the user: the first failed hypothesis with its numbers
 * ("−4,8 % místo +30 %"), else how many problems the agent is fixing. Feedback text is the English the
 * agent reads (compiler / story gate); the UI never shows it raw.
 */
export function attemptDetail(n: number, ok: boolean, feedback: unknown[]): string {
  if (ok) return n > 1 ? `příběh v datech sedí (${String(n)}. pokus)` : "příběh v datech sedí";
  const messages = feedback.map((f) => {
    if (typeof f === "string") return f;
    const m = (f as { message?: unknown }).message;
    return typeof m === "string" ? m : "";
  });
  for (const m of messages) {
    const x = EXPECTATION_FAIL.exec(m);
    if (!x) continue;
    const [, desc = "", , , change = "0", dir, need = "0"] = x;
    const short = desc.length > 70 ? `${desc.slice(0, 68).trimEnd()}…` : desc;
    return `pokus ${String(n)}: hypotéza „${short}“ zatím nevychází (změna ${czNum(change)} %, potřeba ${dir === "decrease" ? "−" : "+"}${czNum(need)} %). Agent zesiluje řetězec příčin.`;
  }
  const k = messages.length;
  const what = k === 1 ? "1 chybu" : k >= 2 && k <= 4 ? `${String(k)} chyby` : `${String(k)} chyb`;
  return `pokus ${String(n)}: agent opravuje ${what} ve scénáři`;
}

// ---------- evidence → dataset view ----------

/** Story points that change something (phase >= 1), one marker per date. */
export function storyMarkers(story: StoryArtifact | null): Marker[] {
  const byDate = new Map<string, string[]>();
  // where the curve actually bends: a what-if moves segments, not the story points themselves
  const bend = new Map<string, string>();
  for (const c of story?.curves ?? [])
    for (const seg of c.segments)
      if (seg.storyPointId && !bend.has(seg.storyPointId)) bend.set(seg.storyPointId, seg.start);
  for (const p of story?.storyPoints ?? []) {
    if ((p.phase ?? 1) < 1) continue;
    const date = bend.get(p.id) ?? p.start;
    byDate.set(date, [...(byDate.get(date) ?? []), p.title]);
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

/** Weekly sums (7-day buckets from the first point), so day-of-week and Poisson noise average out. */
function weekly(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 7 <= values.length; i += 7) out.push(values.slice(i, i + 7).reduce((a, b) => a + b, 0));
  return out;
}

const sd = (xs: number[]) => {
  const m = mean(xs);
  return xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)) : 0;
};

/**
 * How clearly a series moves after the first story point: the largest shift of a 4-week mean against
 * the weeks before, in units of the pre-story week-to-week noise. A series that only wiggles (a sum of
 * random discounts) scores low even when its wiggles are large; demo run: such lines buried the story.
 * Damped by 5 % of the level + 1, so a noiseless or rare series does not divide by zero.
 */
export function movement(s: Series, cut: string | undefined): number {
  const before = weekly(s.points.filter((p) => !cut || p.day < cut).map((p) => p.value));
  const after = weekly(s.points.filter((p) => cut && p.day >= cut).map((p) => p.value));
  if (before.length === 0 || after.length === 0) return 0;
  const base = mean(before);
  const noise = sd(before) / 2 + 0.05 * Math.abs(base) + 1;
  let best = 0;
  for (let i = 0; i < after.length; i++) {
    const window = after.slice(i, i + 4);
    if (window.length < Math.min(4, after.length)) break;
    best = Math.max(best, Math.abs(mean(window) - base) / noise);
  }
  return best;
}

/** Below this a line is noise, not a story (always at least one line is kept). */
const MIN_MOVEMENT = 3;

/**
 * The series worth plotting: the ones that move most after the story starts, one per table, each
 * scaled to its own maximum = 100 so counts and sums share one axis and the shape is what reads
 * (a live run indexed to "before = 100" put rare complaints at 4 000). A `ts` column (noise
 * hourJitter) duplicates the table's date column, so it is skipped.
 */
export function pickSeries(series: Series[], cut: string | undefined, max = 5) {
  const dates = series.reduce<Record<string, Set<string>>>((m, s) => {
    (m[s.table] ??= new Set()).add(s.dateColumn);
    return m;
  }, {});
  const usable = series.filter((s) => !(s.dateColumn === "ts" && (dates[s.table]?.size ?? 0) > 1));
  const multiDate = new Set(
    Object.entries(dates)
      .filter(([, d]) => [...d].filter((c) => c !== "ts").length > 1)
      .map(([t]) => t),
  );
  const ranked = usable
    .map((s) => ({ s, score: movement(s, cut) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter((x, i) => i === 0 || x.score >= MIN_MOVEMENT);
  const seen = new Set<string>();
  const picked: typeof ranked = [];
  for (const x of ranked) {
    if (seen.has(x.s.table)) continue;
    seen.add(x.s.table);
    picked.push(x);
    if (picked.length >= max) break;
  }
  return picked.map((x) => {
    const smooth = rolling(x.s.points);
    const top = Math.max(...smooth.map((p) => p.value)) || 1;
    return {
      key: seriesKey(x.s),
      label: seriesLabel(x.s, multiDate.has(x.s.table)),
      points: smooth.map((p) => ({ day: p.day, value: (p.value / top) * 100 })),
    };
  });
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
  /^TIMESTAMP/i.test(type)
    ? "datetime"
    : /^DATE/i.test(type)
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
  const series = clipToPeriod(ev.series, story?.meta);
  const lines = pickSeries(series, markers[0]?.date);
  const days = new Set(series.flatMap((s) => s.points.map((p) => p.day))).size;
  const describe = new Map(story?.expectations.map((e) => [e.id, e.description]));
  return {
    datasetId,
    totals: { rows: tables?.rows ?? Number.NaN, tables: tables?.count ?? Number.NaN, days },
    seriesTitle: "Co se v datech pohnulo · 7denní průměr, každá řada vůči svému maximu (= 100)",
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
  const seriesB = clipToPeriod(evB.series, story?.meta);
  const sB = top ? seriesB.find((s) => metricOf(s) === top.metric) : seriesB[0];
  const sA = sB && clipToPeriod(evA.series, story?.meta).find((s) => seriesKey(s) === seriesKey(sB));
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
