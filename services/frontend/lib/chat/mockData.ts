/**
 * Mock data for the demo workflow (`?demo=1`). Shaped like the real artifacts/evidence
 * (`04_story`, DatasetEvidence, DetectiveResult, MetricDiff) so the presenter is exercised as-is.
 * Deterministic: a tiny LCG, so screenshots and tests are stable. Never used outside demo mode.
 */
import type {
  CompanyView,
  CompareView,
  DatasetView,
  DetectiveView,
  SeriesRow,
  StoryPointEdit,
} from "./surfaces";

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const DAY = 86_400_000;
export const addDays = (iso: string, n: number) =>
  new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

export const PERIOD = { from: "2026-01-05", to: "2026-06-29" };
const WEEKS = 26;
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

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
    strength: 60,
  },
  {
    id: "sp2",
    title: "Vyprodané zboží",
    description: "U praček a lednic chybí zboží, objednávky čekají na naskladnění.",
    start: "2026-03-16",
    strength: 45,
  },
  {
    id: "sp3",
    title: "Zákazníci ruší objednávky",
    description: "Část zákazníků po týdnu čekání objednávku stornuje a stěžuje si.",
    start: "2026-03-30",
    end: "2026-05-25",
    strength: 50,
  },
];

const weekOf = (iso: string) => Math.round((Date.parse(iso) - Date.parse(PERIOD.from)) / (7 * DAY));

/** Delay curve the user sees before approving (a parameter, not generated data). */
export function curvePreview(points: StoryPointEdit[]): SeriesRow[] {
  const sp1 = points.find((p) => p.id === "sp1") ?? MOCK_POINTS[0];
  const startW = weekOf(sp1?.start ?? "2026-03-02");
  const peak = 2 + ((sp1?.strength ?? 60) / 100) * 7;
  return Array.from({ length: WEEKS }, (_, w) => ({
    day: addDays(PERIOD.from, w * 7),
    value: round(w < startW ? 2 : Math.min(peak, 2 + (peak - 2) * ((w - startW + 1) / 3))),
  }));
}

/** Weekly metrics that "emerged" from the process chain. `recoverWeek` ends the delay early (what-if). */
export function mockSeries(points: StoryPointEdit[], seed = 42, recoverWeek?: number): SeriesRow[] {
  const rnd = lcg(seed);
  const curve = curvePreview(points);
  const sp3 = points.find((p) => p.id === "sp3");
  const cancelBoost = (sp3?.strength ?? 50) / 100;
  return curve.map((row, w) => {
    const raw = Number(row.value);
    const delay =
      recoverWeek !== undefined && w >= recoverWeek ? Math.max(2, raw - (w - recoverWeek + 1) * 1.5) : raw;
    const stress = Math.max(0, delay - 2);
    return {
      day: row.day,
      delay: round(delay + (rnd() - 0.5) * 0.6),
      cancel: round(3 + stress * 1.1 * (0.5 + cancelBoost) + (rnd() - 0.5)),
      complaints: Math.round(4 + stress * 1.8 + rnd() * 3),
    };
  });
}

const avg = (rows: SeriesRow[], key: string, from: number, to: number) => {
  const part = rows.slice(from, to).map((r) => Number(r[key]));
  return round(part.reduce((a, b) => a + b, 0) / Math.max(1, part.length), 2);
};

const STATUSES = ["doručeno", "doručeno", "doručeno", "čeká na zboží", "stornováno"] as const;
const PRODUCTS = ["Pračka Beko 7 kg", "Lednice Gorenje", "Mikrovlnka Sencor", "Myčka Bosch", "Vysavač ETA"];

function mockTables(seed: number) {
  const rnd = lcg(seed + 7);
  const orders = Array.from({ length: 24 }, (_, i) => {
    const day = addDays("2026-02-16", i * 3);
    const late = day >= "2026-03-16";
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
    const delay = ordered >= "2026-03-02" ? Math.round(4 + rnd() * 5) : Math.round(1 + rnd() * 2);
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
  { key: "complaints", label: "Stížnosti / týden" },
];

export function mockDataset(
  datasetId: string,
  points: StoryPointEdit[],
  seed = 42,
  recoverWeek?: number,
): DatasetView {
  const series = mockSeries(points, seed, recoverWeek);
  const split = weekOf(points[0]?.start ?? "2026-03-02");
  const rel = (b: number, a: number) => round((a - b) / b, 3);
  const exp = (id: string, description: string, key: string, kind: "increase" | "stable" = "increase") => {
    const before = avg(series, key, 0, split);
    const after = avg(series, key, split + 2, WEEKS);
    const relChange = rel(before, after);
    const pass = kind === "increase" ? relChange >= 0.2 : Math.abs(relChange) < 0.1;
    return { id, description, before, after, relChange, pass };
  };
  const tables = mockTables(seed);
  return {
    datasetId,
    totals: { rows: 48_210, tables: 12, days: 176 },
    series,
    seriesLines: SERIES_LINES,
    markers: points.map((p) => ({ date: addDays(PERIOD.from, weekOf(p.start) * 7), label: p.title })),
    expectations: [
      exp("e1", "Průměrné zpoždění dodávek po začátku příběhu vzrostlo", "delay"),
      exp("e2", "Podíl stornovaných objednávek vzrostl", "cancel"),
      exp("e3", "Počet stížností zákazníků vzrostl", "complaints"),
      {
        id: "e4",
        description: "Počet objednávek neklesl o více než 10 %",
        before: 812,
        after: 768,
        relChange: -0.054,
        pass: true,
      },
    ],
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
      "Od začátku března se u dodavatele sup-001 prodlužují dodací lhůty z ~2 na ~6 dní. O dva týdny později roste podíl objednávek ve stavu „čeká na zboží“ a od konce března přibývá storen a stížností. Objednávky celkově mírně klesají.",
    recall: 0.67,
    precision: 0.75,
    findings: [
      { claim: "Dodávky od sup-001 se zpožďují", start: "2026-03-02", entities: "sup-001", matched: true },
      {
        claim: "Roste podíl stornovaných objednávek",
        start: "2026-03-30",
        entities: "orders",
        matched: true,
      },
      { claim: "Více reklamací u vysavačů", start: "2026-04-20", entities: "prod-005", matched: false },
      { claim: "Nárůst stížností zákazníků", start: "2026-04-06", entities: "tickets", matched: false },
    ],
  };
}

export function mockCompare(question: string, points: StoryPointEdit[]): CompareView {
  const a = mockSeries(points, 42);
  const recover = weekOf(addDays(points[0]?.start ?? "2026-03-02", 14));
  const b = mockSeries(points, 42, recover);
  const rel = (x: number, y: number) => round((y - x) / x, 3);
  const after = (rows: SeriesRow[], key: string) => avg(rows, key, recover, WEEKS);
  const metric = (label: string, key: string) => {
    const va = after(a, key);
    const vb = after(b, key);
    return { metric: label, a: va, b: vb, relChange: rel(va, vb) };
  };
  return {
    a: "d1",
    b: "d2",
    question,
    metric: "Zpoždění dodávky (dny), týdně",
    series: a.map((row, i) => ({ day: row.day, a: Number(row.delay), b: Number(b[i]?.delay ?? 0) })),
    markers: [{ date: addDays(PERIOD.from, recover * 7), label: "Dodavatel se vrací k normálu" }],
    diff: [
      metric("Zpoždění dodávky (dny)", "delay"),
      metric("Storna (%)", "cancel"),
      metric("Stížnosti / týden", "complaints"),
    ],
  };
}
