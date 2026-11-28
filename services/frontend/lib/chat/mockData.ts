/**
 * Mock data for the demo workflow (`?demo=1`). Shaped like the real artifacts/evidence
 * (`04_story`, DatasetEvidence, DetectiveResult, MetricDiff) so the presenter is exercised as-is.
 * Deterministic (LCG on the seed). The story curve the user edits drives the metrics, so a dragged
 * point visibly moves the generated dataset. Never used outside demo mode.
 */
import { DEFAULT_CONFIG, normalize } from "./config";
import { samplesPerEntity } from "./time";
import { addDays, curveAt, daysBetween, effectiveRamp } from "./curve";
import type {
  CompanyView,
  CompareView,
  DatasetView,
  DetectiveView,
  ExpectationToggle,
  SeriesRow,
  StoryConfig,
  StoryPointEdit,
} from "./surfaces";

export { addDays, DEFAULT_CONFIG, normalize };

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export const PERIOD = { from: DEFAULT_CONFIG.time.from, to: DEFAULT_CONFIG.time.to };

export const MOCK_COMPANY: CompanyView = {
  industry: "E-shop s domácími spotřebiči",
  size: "1 sklad, 3 výdejní místa, 28 zaměstnanců",
  actors: [
    { kind: "supplier", name: "ElektroParts s.r.o." },
    { kind: "supplier", name: "Domov Import a.s." },
    { kind: "customer", name: "Zákazníci e-shopu" },
    { kind: "partner", name: "Dopravce PPL" },
  ],
  keyProcesses: ["objednávky", "nákup zásob", "doručení", "reklamace"],
};

export const MOCK_POINTS: StoryPointEdit[] = [
  {
    id: "sp1",
    title: "Dodavatel začíná zpožďovat",
    description: "ElektroParts prodlouží dodací lhůty, zásoby na skladě začnou docházet.",
    start: "2026-03-02",
    level: 5.5,
  },
  {
    id: "sp2",
    title: "Vyprodané zboží",
    description: "U praček a lednic chybí zboží, objednávky čekají na naskladnění.",
    start: "2026-03-16",
    level: 7,
  },
  {
    id: "sp3",
    title: "Zákazníci ruší objednávky",
    description: "Část zákazníků po týdnu čekání objednávku stornuje a stěžuje si.",
    start: "2026-04-06",
    end: "2026-05-25",
    level: 6.5,
  },
];

export const MOCK_EXPECTATIONS: ExpectationToggle[] = [
  { id: "e1", description: "Průměrné zpoždění dodávek po začátku příběhu vzrostlo", enabled: true },
  { id: "e2", description: "Podíl stornovaných objednávek vzrostl", enabled: true },
  { id: "e3", description: "Počet stížností zákazníků vzrostl", enabled: true },
  { id: "e4", description: "Počet objednávek neklesl o více než 10 %", enabled: true },
];

/** Chart bucket: a week for long ranges, a day for short ones (hourly records are summed per day). */
export const stepDays = (c: StoryConfig) => (daysBetween(c.time.from, c.time.to) > 120 ? 7 : 1);
const bucketOf = (from: string, day: string, step: number) =>
  addDays(from, Math.floor(daysBetween(from, day) / step) * step);

/** Metrics per bucket that "emerged" from the process chain, driven by the story curve. */
export function mockSeries(points: StoryPointEdit[], config: StoryConfig = DEFAULT_CONFIG): SeriesRow[] {
  const c = normalize(config);
  const rnd = lcg(c.seed || 0);
  const wobble = 0.6 + c.noise.missing / 10;
  const base = c.curve.baseline;
  const step = stepDays(c);
  const buckets = Math.floor(daysBetween(c.time.from, c.time.to) / step) + 1;
  return Array.from({ length: buckets }, (_, w) => {
    const day = addDays(c.time.from, w * step);
    const delay = curveAt(day, base, points, effectiveRamp(c.curve.rampDays, c.time.from, c.time.to));
    const stress = Math.max(0, delay - base);
    return {
      day,
      delay: round(delay + (rnd() - 0.5) * wobble),
      cancel: round(3 + stress * 0.9 + (rnd() - 0.5)),
      complaints: Math.round(4 + stress * 1.6 + rnd() * 3),
    };
  });
}

const avg = (rows: SeriesRow[], key: string, from: number, to: number) => {
  const part = rows.slice(from, to).map((r) => Number(r[key]));
  return round(part.reduce((a, b) => a + b, 0) / Math.max(1, part.length), 2);
};

const STATUSES = ["doručeno", "doručeno", "doručeno", "čeká na zboží", "stornováno"] as const;
const PRODUCTS = ["Pračka Beko 7 kg", "Lednice Gorenje", "Mikrovlnka Sencor", "Myčka Bosch", "Vysavač ETA"];

function mockTables(seed: number, storyStart: string) {
  const rnd = lcg(seed + 7);
  const orders = Array.from({ length: 24 }, (_, i) => {
    const day = addDays("2026-02-16", i * 3);
    const late = day >= storyStart;
    const status = late ? (STATUSES[Math.floor(rnd() * STATUSES.length)] ?? "doručeno") : "doručeno";
    return {
      id: `orders-${String(i + 1).padStart(6, "0")}`,
      date: day,
      customer_id: `cust-${String(1 + Math.floor(rnd() * 240)).padStart(3, "0")}`,
      product: PRODUCTS[Math.floor(rnd() * PRODUCTS.length)] ?? PRODUCTS[0],
      total: Math.round(2500 + rnd() * 18000),
      status,
    };
  });
  const deliveries = Array.from({ length: 18 }, (_, i) => {
    const ordered = addDays("2026-02-02", i * 7);
    const delay = ordered >= storyStart ? Math.round(4 + rnd() * 5) : Math.round(1 + rnd() * 2);
    return {
      id: `deliveries-${String(i + 1).padStart(6, "0")}`,
      supplier_id: i % 3 === 2 ? "sup-002" : "sup-001",
      ordered,
      delivered: addDays(ordered, delay + 3),
      delay_days: delay,
    };
  });
  return { orders, deliveries };
}

export const SERIES_LINES = [
  { key: "delay", label: "Zpoždění dodávky (dny)" },
  { key: "cancel", label: "Storna (%)" },
  { key: "complaints", label: "Stížnosti" },
];

const firstStart = (points: StoryPointEdit[]) =>
  [...points].sort((a, b) => a.start.localeCompare(b.start))[0]?.start ?? "2026-03-02";

export function mockDataset(
  datasetId: string,
  points: StoryPointEdit[],
  config: StoryConfig = DEFAULT_CONFIG,
  expectations: ExpectationToggle[] = MOCK_EXPECTATIONS,
): DatasetView {
  const c = normalize(config);
  const series = mockSeries(points, c);
  const step = stepDays(c);
  const split = Math.max(1, Math.floor(daysBetween(c.time.from, firstStart(points)) / step));
  const rel = (b: number, a: number) => round((a - b) / b, 3);
  const exp = (id: string, key: string) => {
    const before = avg(series, key, 0, split);
    const settle = Math.ceil(effectiveRamp(c.curve.rampDays, c.time.from, c.time.to) / step);
    const after = avg(series, key, split + settle, series.length);
    const relChange = rel(before, after);
    return { id, before, after, relChange, pass: relChange >= 0.2 };
  };
  const results: Record<string, Omit<DatasetView["expectations"][number], "description">> = {
    e1: exp("e1", "delay"),
    e2: exp("e2", "cancel"),
    e3: exp("e3", "complaints"),
    e4: { id: "e4", before: 812, after: 768, relChange: -0.054, pass: true },
  };
  const tables = mockTables(c.seed || 0, firstStart(points));
  const sizeFactor = (c.size.customers / 2400 + c.size.products / 120 + c.size.stores / 3) / 3;
  const days = daysBetween(c.time.from, c.time.to) + 1;
  const samples = samplesPerEntity(c.time);
  return {
    datasetId,
    totals: {
      rows: Math.round(48_210 * c.scale * sizeFactor * (1 + c.noise.duplicates / 100) * (samples / 181)),
      tables: 12,
      days,
    },
    series,
    seriesTitle: step === 7 ? "Týdenní průběh klíčových metrik" : "Denní průběh klíčových metrik",
    seriesLines: SERIES_LINES,
    markers: points.map((p) => ({ date: bucketOf(c.time.from, p.start, step), label: p.title })),
    expectations: expectations
      .filter((e) => e.enabled)
      .flatMap((e) => {
        const r = results[e.id];
        return r ? [{ ...r, description: e.description }] : [];
      }),
    tables: [
      {
        name: "orders",
        label: "Objednávky (orders)",
        columns: [
          { key: "id", label: "ID" },
          { key: "date", label: "Datum", format: "date" },
          { key: "customer_id", label: "Zákazník" },
          { key: "product", label: "Produkt" },
          { key: "total", label: "Cena (Kč)", format: "int" },
          { key: "status", label: "Stav" },
        ],
        rows: tables.orders,
      },
      {
        name: "deliveries",
        label: "Dodávky (deliveries)",
        columns: [
          { key: "id", label: "ID" },
          { key: "supplier_id", label: "Dodavatel" },
          { key: "ordered", label: "Objednáno", format: "date" },
          { key: "delivered", label: "Dodáno", format: "date" },
          { key: "delay_days", label: "Zpoždění (dny)", format: "int" },
        ],
        rows: tables.deliveries,
      },
    ],
  };
}

export function mockDetective(datasetId: string): DetectiveView {
  return {
    datasetId,
    narrative:
      "Od začátku března se u dodavatele sup-001 prodlužují dodací lhůty z ~2 na ~6 dní. O dva týdny později roste podíl objednávek ve stavu „čeká na zboží“ a od dubna přibývá storen a stížností. Objednávky celkově mírně klesají.",
    recall: 0.67,
    precision: 0.75,
    findings: [
      { claim: "Dodávky od sup-001 se zpožďují", start: "2026-03-02", entities: "sup-001", matched: true },
      {
        claim: "Roste podíl stornovaných objednávek",
        start: "2026-04-06",
        entities: "orders",
        matched: true,
      },
      { claim: "Více reklamací u vysavačů", start: "2026-04-20", entities: "prod-005", matched: false },
      { claim: "Nárůst stížností zákazníků", start: "2026-04-13", entities: "tickets", matched: false },
    ],
  };
}

/** What-if "the supplier recovers after 2 weeks": every point ends 14 days after the first one starts. */
export function mockCompare(
  question: string,
  points: StoryPointEdit[],
  config: StoryConfig = DEFAULT_CONFIG,
  a = "dat1",
  b = "dat2",
): CompareView {
  const cutoff = addDays(firstStart(points), 14);
  const changed = points
    .filter((p) => p.start < cutoff)
    .map((p) => ({ ...p, end: p.end && p.end < cutoff ? p.end : cutoff }));
  const sa = mockSeries(points, config);
  const sb = mockSeries(changed, config);
  const c = normalize(config);
  const step = stepDays(c);
  const from = Math.floor(daysBetween(c.time.from, cutoff) / step);
  const rel = (x: number, y: number) => round((y - x) / x, 3);
  const metric = (label: string, key: string) => {
    const va = avg(sa, key, from, sa.length);
    const vb = avg(sb, key, from, sb.length);
    return { metric: label, a: va, b: vb, relChange: rel(va, vb) };
  };
  return {
    a,
    b,
    question,
    metric: "Zpoždění dodávky (dny), týdně",
    series: sa.map((row, i) => ({ day: row.day, a: Number(row.delay), b: Number(sb[i]?.delay ?? 0) })),
    markers: [{ date: bucketOf(c.time.from, cutoff, step), label: "Dodavatel se vrací k normálu" }],
    diff: [
      metric("Zpoždění dodávky (dny)", "delay"),
      metric("Storna (%)", "cancel"),
      metric("Stížnosti / týden", "complaints"),
    ],
  };
}
