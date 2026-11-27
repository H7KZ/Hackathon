/**
 * Presenter: turns pipeline data into A2UI surfaces (docs/design/a2ui.md).
 * Pure functions, shared by the mock and the live source. Layout lives here; numbers only ever
 * go into `dataModel` (bound with {"@path"}), never into component props.
 * Moving this file to services/api later = the API emits A2UI and the renderer does not change.
 */
import { a2ui, JOJO_CATALOG_ID, path, type A2uiMessage, type ComponentNode } from "../a2ui/protocol";
import { STEP_LABELS, type StepKey } from "./phrases";
import type { Step, StepState } from "../a2ui/catalog";
import type { TimeConfig } from "./time";

// ---------- view models (what a surface needs, whatever the source) ----------

export type CompanyView = {
  industry: string;
  size: string;
  actors: { kind: string; name: string }[];
  keyProcesses: string[];
};
export type StoryPointEdit = {
  id: string;
  title: string;
  description: string;
  start: string;
  end?: string;
  /** curve value from this point on (ramp segment `to`) */
  level: number;
};

/** Everything the Generate button sends (basic + advanced settings). */
export type StoryConfig = {
  /** `step` = slider resolution for baseline / levels (0.01 for probabilities, 1 for counts). */
  curve: {
    label: string;
    unit: string;
    baseline: number;
    rampDays: number;
    min: number;
    max: number;
    step?: number;
  };
  time: TimeConfig;
  seed: number;
  scale: number;
  noise: { missing: number; duplicates: number; hourJitter: boolean };
  size: { stores: number; products: number; customers: number };
};
export type ExpectationToggle = { id: string; description: string; enabled: boolean };
export type SeriesRow = Record<string, number | string> & { day: string };
export type Marker = { date: string; label: string };
export type ExpectationRow = {
  id: string;
  description: string;
  before: number | null;
  after: number | null;
  relChange: number | null;
  pass: boolean;
};
export type DatasetView = {
  datasetId: string;
  /** NaN = unknown (live API has no totals yet): that KPI is left out. */
  totals: { rows: number; tables: number; days: number };
  seriesTitle?: string;
  series: SeriesRow[];
  seriesLines: { key: string; label: string }[];
  markers: Marker[];
  expectations: ExpectationRow[];
  tables: {
    name: string;
    label: string;
    columns: { key: string; label: string; format?: string }[];
    rows: Record<string, unknown>[];
  }[];
};
export type DetectiveView = {
  datasetId: string;
  narrative: string;
  recall: number;
  precision: number;
  findings: { claim: string; start: string; entities: string; matched: boolean }[];
};
export type CompareView = {
  a: string;
  b: string;
  question: string;
  series: SeriesRow[];
  metric: string;
  markers: Marker[];
  diff: { metric: string; a: number | null; b: number | null; relChange: number | null }[];
};

const create = (
  surfaceId: string,
  title: string,
  placement: "chat" | "canvas",
  components: ComponentNode[],
  dataModel: Record<string, unknown>,
  demo: boolean,
) =>
  a2ui.create({
    surfaceId,
    catalogId: JOJO_CATALOG_ID,
    metadata: { placement, title, demo },
    components,
    dataModel,
  });

// ---------- progress ----------

export const steps = (keys: StepKey[], state: StepState = "pending"): Step[] =>
  keys.map((id) => ({ id, label: STEP_LABELS[id], state }));

export function progressSurface(id: string, title: string, list: Step[], demo = false): A2uiMessage {
  return create(
    id,
    title,
    "chat",
    [
      { id: "root", component: "Card", title, child: "steps" },
      { id: "steps", component: "Steps", steps: path("/steps") },
    ],
    { steps: list },
    demo,
  );
}

export const setSteps = (id: string, list: Step[]) => a2ui.data(id, "/steps", list);

// ---------- company (chat card) ----------

export function companySurface(id: string, c: CompanyView, demo = false): A2uiMessage {
  return create(
    id,
    "Firma",
    "chat",
    [
      { id: "root", component: "Card", title: "Firma", child: "col" },
      { id: "col", component: "Column", gap: "sm", children: ["industry", "size", "actors", "proc"] },
      { id: "industry", component: "Text", variant: "h3", text: path("/industry") },
      { id: "size", component: "Text", variant: "muted", text: path("/size") },
      { id: "actors", component: "Row", gap: "sm", children: { componentId: "actor", path: "/actors" } },
      { id: "actor", component: "Badge", tone: "neutral", text: path("name") },
      { id: "proc", component: "Text", variant: "caption", text: path("/processes") },
    ],
    { ...c, processes: `Procesy: ${c.keyProcesses.join(" · ")}` },
    demo,
  );
}

// ---------- story (canvas): curve editor, basic settings, advanced disclosure, generate ----------

/**
 * The refinement step. First view: the interactive curve (drag / add / delete story points) and three
 * basic settings. Everything else sits in "Pokročilé nastavení". All of it is two-way bound into the
 * surface data model and travels with the Generate action, so what the user touched is what runs.
 */
export function storySurface(
  id: string,
  points: StoryPointEdit[],
  config: StoryConfig,
  expectations: ExpectationToggle[],
  demo = false,
  /**
   * live = a real API session: the period comes from the cascade and company size from its model,
   * so those controls are left out; what remains is exactly what approve sends (seed, volume, noise,
   * hypotheses) plus the curve itself.
   */
  live = false,
): A2uiMessage {
  const section = (sid: string, title: string, children: string[]): ComponentNode[] => [
    { id: sid, component: "Column", gap: "sm", children: [`${sid}-t`, ...children] },
    { id: `${sid}-t`, component: "Text", variant: "label", text: title },
  ];
  return create(
    id,
    "Návrh příběhu",
    "canvas",
    [
      {
        id: "root",
        component: "Column",
        gap: "lg",
        children: ["intro", "curve", "basic", "advanced", "actions"],
      },
      {
        id: "intro",
        component: "Text",
        variant: "muted",
        text: "Body příběhu ohýbají křivku parametru. Táhněte je v grafu, dvojklikem přidáte nový. Data vzniknou až po vygenerování.",
      },
      {
        id: "curve",
        component: "CurveEditor",
        points: path("/points"),
        baseline: path("/config/curve/baseline"),
        rampDays: path("/config/curve/rampDays"),
        from: path("/config/time/from"),
        to: path("/config/time/to"),
        min: path("/config/curve/min"),
        max: path("/config/curve/max"),
        label: path("/config/curve/label"),
        unit: path("/config/curve/unit"),
        locked: path("/locked"),
      },
      { id: "basic", component: "Column", gap: "md", children: live ? ["basicRow"] : ["time", "basicRow"] },
      { id: "time", component: "PeriodPicker", value: path("/config/time") },
      { id: "basicRow", component: "Row", gap: "md", children: ["scale", "seed"] },
      {
        id: "scale",
        component: "Slider",
        label: "Objem dat",
        unit: "×",
        min: 0.2,
        max: 3,
        steps: 0.1,
        value: path("/config/scale"),
      },
      { id: "seed", component: "TextField", variant: "number", label: "Seed", value: path("/config/seed") },
      {
        id: "advanced",
        component: "Collapsible",
        title: "Pokročilé nastavení",
        summary: live
          ? "body příběhu, křivka, šum, hypotézy"
          : "body příběhu, křivka, šum, velikost firmy, hypotézy",
        child: "adv",
      },
      {
        id: "adv",
        component: "Column",
        gap: "lg",
        children: live
          ? ["s-points", "s-curve", "s-noise", "s-exp"]
          : ["s-points", "s-curve", "s-noise", "s-size", "s-exp"],
      },
      ...section("s-points", "Body příběhu", ["pointList"]),
      { id: "pointList", component: "List", children: { componentId: "pt", path: "/points" } },
      { id: "pt", component: "Card", child: "ptCol" },
      { id: "ptCol", component: "Column", gap: "sm", children: ["ptRow1", "ptRow2"] },
      { id: "ptRow1", component: "Row", gap: "md", children: ["ptBadge", "ptTitle", "ptLevel"] },
      { id: "ptBadge", component: "Badge", tone: "story", text: path("id") },
      { id: "ptTitle", component: "TextField", label: "Název", value: path("title"), weight: 2 },
      { id: "ptLevel", component: "TextField", variant: "number", label: "Hodnota", value: path("level") },
      { id: "ptRow2", component: "Row", gap: "md", children: ["ptStart", "ptEnd", "ptDesc"] },
      { id: "ptStart", component: "DateTimeInput", label: "Začátek", value: path("start") },
      { id: "ptEnd", component: "DateTimeInput", label: "Návrat k normálu", value: path("end") },
      { id: "ptDesc", component: "TextField", label: "Popis", value: path("description"), weight: 2 },
      ...section("s-curve", "Křivka", ["curveRow"]),
      {
        id: "curveRow",
        component: "Row",
        gap: "md",
        children: live ? ["cBase", "cLabel"] : ["cBase", "cRamp", "cLabel"],
      },
      {
        id: "cBase",
        component: "Slider",
        label: "Výchozí hodnota",
        min: path("/config/curve/min"),
        max: path("/config/curve/max"),
        steps: path("/config/curve/step"),
        value: path("/config/curve/baseline"),
      },
      {
        id: "cRamp",
        component: "Slider",
        label: "Náběh změny",
        unit: "dní",
        min: 1,
        max: 42,
        steps: 1,
        value: path("/config/curve/rampDays"),
      },
      { id: "cLabel", component: "TextField", label: "Popisek osy", value: path("/config/curve/label") },
      ...section("s-noise", "Šum v datech", ["noiseRow"]),
      { id: "noiseRow", component: "Row", gap: "md", children: ["nMissing", "nDup", "nJitter"] },
      {
        id: "nMissing",
        component: "Slider",
        label: "Chybějící hodnoty",
        unit: "%",
        min: 0,
        max: 20,
        steps: 1,
        value: path("/config/noise/missing"),
      },
      {
        id: "nDup",
        component: "Slider",
        label: "Duplicitní řádky",
        unit: "%",
        min: 0,
        max: 10,
        steps: 1,
        value: path("/config/noise/duplicates"),
      },
      {
        id: "nJitter",
        component: "CheckBox",
        label: "Rozházet časy v rámci dne",
        value: path("/config/noise/hourJitter"),
      },
      ...section("s-size", "Velikost firmy", ["sizeRow"]),
      { id: "sizeRow", component: "Row", gap: "md", children: ["zStores", "zProducts", "zCustomers"] },
      {
        id: "zStores",
        component: "Slider",
        label: "Prodejny",
        min: 1,
        max: 20,
        steps: 1,
        value: path("/config/size/stores"),
      },
      {
        id: "zProducts",
        component: "Slider",
        label: "Produkty",
        min: 10,
        max: 500,
        steps: 10,
        value: path("/config/size/products"),
      },
      {
        id: "zCustomers",
        component: "Slider",
        label: "Zákazníci",
        min: 100,
        max: 10000,
        steps: 100,
        value: path("/config/size/customers"),
      },
      ...section("s-exp", "Ověřované hypotézy", ["expList"]),
      { id: "expList", component: "List", children: { componentId: "exp", path: "/expectations" } },
      { id: "exp", component: "CheckBox", label: path("description"), value: path("enabled") },
      { id: "actions", component: "Row", justify: "end", children: ["generate"] },
      {
        id: "generate",
        component: "Button",
        variant: "primary",
        label: "Generovat data",
        disabled: path("/locked"),
        action: {
          event: {
            name: "approve",
            userMessage: "Generuj data podle návrhu.",
            context: {
              points: path("/points"),
              config: path("/config"),
              expectations: path("/expectations"),
            },
          },
        },
      },
    ],
    { points, config, expectations },
    demo,
  );
}

// ---------- dataset (canvas) + chat summary ----------

export function datasetSurface(id: string, d: DatasetView, demo = false): A2uiMessage {
  const passed = d.expectations.filter((e) => e.pass).length;
  const tableNodes: ComponentNode[] = d.tables.flatMap((t, i) => [
    { id: `tcard${String(i)}`, component: "Card", title: t.label, child: `table${String(i)}` },
    {
      id: `table${String(i)}`,
      component: "Table",
      columns: t.columns,
      rows: path(`/tables/${t.name}`),
      maxRows: 6,
    },
  ]);
  return create(
    id,
    `Dataset ${d.datasetId}`,
    "canvas",
    [
      { id: "root", component: "Column", gap: "lg", children: ["kpis", "tabs"] },
      {
        id: "kpis",
        component: "Row",
        gap: "md",
        // unknown totals (NaN) are left out instead of showing "–"
        children: [
          ...(Number.isFinite(d.totals.rows) ? ["k1"] : []),
          ...(Number.isFinite(d.totals.tables) ? ["k2"] : []),
          "k3",
          "k4",
        ],
      },
      { id: "k1", component: "Kpi", label: "Řádků", value: path("/totals/rows"), format: "int" },
      { id: "k2", component: "Kpi", label: "Tabulek", value: path("/totals/tables"), format: "int" },
      { id: "k3", component: "Kpi", label: "Dní", value: path("/totals/days"), format: "int" },
      { id: "k4", component: "Kpi", label: "Důkazy splněny", value: path("/passedLabel") },
      {
        id: "tabs",
        component: "Tabs",
        tabs: [
          { title: "Přehled", child: "overview" },
          { title: "Důkazy", child: "evidence" },
          ...(d.tables.length ? [{ title: "Tabulky", child: "tables" }] : []),
        ],
      },
      { id: "overview", component: "Column", gap: "md", children: ["chart", "hint"] },
      {
        id: "chart",
        component: "LineChart",
        title: d.seriesTitle ?? "Týdenní průběh klíčových metrik",
        data: path("/series"),
        lines: d.seriesLines,
        markers: path("/markers"),
        height: 300,
      },
      {
        id: "hint",
        component: "Text",
        variant: "caption",
        text: "◆ = bod příběhu: tady se křivka parametru ohnula. Metriky se pohnuly samy, přes řetězec procesů.",
      },
      {
        id: "evidence",
        component: "Table",
        columns: [
          { key: "description", label: "Hypotéza" },
          { key: "before", label: "Před", format: "number" },
          { key: "after", label: "Po", format: "number" },
          { key: "relChange", label: "Změna", format: "delta" },
          { key: "pass", label: "Výsledek", format: "pass" },
        ],
        rows: path("/expectations"),
      },
      { id: "tables", component: "Column", gap: "md", children: d.tables.map((_, i) => `tcard${String(i)}`) },
      ...tableNodes,
    ],
    {
      totals: d.totals,
      series: d.series,
      markers: d.markers,
      expectations: d.expectations,
      passedLabel: `${String(passed)} / ${String(d.expectations.length)}`,
      tables: Object.fromEntries(d.tables.map((t) => [t.name, t.rows])),
    },
    demo,
  );
}

export function readySurface(id: string, datasetId: string, demo = false): A2uiMessage {
  return create(
    id,
    "Hotovo",
    "chat",
    [
      { id: "root", component: "Card", child: "col" },
      { id: "col", component: "Column", gap: "sm", children: ["t", "row"] },
      {
        id: "t",
        component: "Text",
        text: `Dataset **${datasetId}** je hotový a příběh v něm jde dohledat. Co dál?`,
      },
      { id: "row", component: "Row", gap: "sm", children: ["detect", "open"] },
      {
        id: "detect",
        component: "Button",
        variant: "primary",
        label: "Spustit detektiva",
        action: {
          event: { name: "detect", userMessage: "Spusť slepého detektiva.", context: { datasetId } },
        },
      },
      {
        id: "open",
        component: "Button",
        variant: "secondary",
        label: "Otevřít data",
        action: { event: { name: "open_canvas", context: { surfaceId: `dataset-${datasetId}` } } },
      },
    ],
    {},
    demo,
  );
}

// ---------- recover (chat): an interrupted, failed or cancelled job ----------

/** Card with the reason and one button; the button locks itself after a click (`/locked`). */
export function recoverSurface(
  id: string,
  text: string,
  label: string,
  action: "resume" | "restart",
  demo = false,
): A2uiMessage {
  return create(
    id,
    "Přerušeno",
    "chat",
    [
      { id: "root", component: "Card", child: "col" },
      { id: "col", component: "Column", gap: "sm", children: ["t", "row"] },
      { id: "t", component: "Text", text: path("/text") },
      { id: "row", component: "Row", gap: "sm", children: ["go"] },
      {
        id: "go",
        component: "Button",
        variant: "primary",
        label,
        disabled: path("/locked"),
        action: { event: { name: action, context: { surfaceId: id } } },
      },
    ],
    { text, locked: false },
    demo,
  );
}

// ---------- detective (canvas) ----------

export function detectiveSurface(id: string, d: DetectiveView, demo = false): A2uiMessage {
  return create(
    id,
    `Slepý detektiv · ${d.datasetId}`,
    "canvas",
    [
      { id: "root", component: "Column", gap: "lg", children: ["kpis", "story", "table"] },
      { id: "kpis", component: "Row", children: ["recall", "precision", "count"] },
      {
        id: "recall",
        component: "Kpi",
        label: "Recall (nalezené body příběhu)",
        value: path("/recall"),
        format: "percent",
      },
      { id: "precision", component: "Kpi", label: "Precision", value: path("/precision"), format: "percent" },
      { id: "count", component: "Kpi", label: "Zjištění", value: path("/count"), format: "int" },
      {
        id: "story",
        component: "Callout",
        tone: "info",
        title: "Co detektiv vyčetl z dat (bez znalosti scénáře)",
        text: path("/narrative"),
      },
      {
        id: "table",
        component: "Table",
        columns: [
          { key: "claim", label: "Zjištění" },
          { key: "start", label: "Od", format: "date" },
          { key: "entities", label: "Entity" },
          { key: "matched", label: "Sedí na příběh", format: "yesno" },
        ],
        rows: path("/findings"),
      },
    ],
    { ...d, count: d.findings.length },
    demo,
  );
}

// ---------- compare (canvas) ----------

export function compareSurface(id: string, c: CompareView, demo = false): A2uiMessage {
  return create(
    id,
    `Porovnání ${c.a} ↔ ${c.b}`,
    "canvas",
    [
      { id: "root", component: "Column", gap: "lg", children: ["q", "chart", "table"] },
      { id: "q", component: "Callout", tone: "story", title: "Otázka", text: path("/question") },
      {
        id: "chart",
        component: "LineChart",
        title: c.metric,
        data: path("/series"),
        markers: path("/markers"),
        lines: [
          { key: "a", label: `${c.a} (původní)` },
          { key: "b", label: `${c.b} (co kdyby)`, dashed: true, color: 1 },
        ],
        height: 280,
      },
      {
        id: "table",
        component: "Table",
        columns: [
          { key: "metric", label: "Metrika" },
          { key: "a", label: c.a, format: "number" },
          { key: "b", label: c.b, format: "number" },
          { key: "relChange", label: "Změna", format: "delta" },
        ],
        rows: path("/diff"),
      },
    ],
    { question: c.question, series: c.series, markers: c.markers, diff: c.diff },
    demo,
  );
}
