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
  /** live: the scenario segment kind, so the chart draws what the engine will do */
  kind?: string;
};
/** One further lever in the live editor: another curve story points bend, besides the main one. */
export type LeverEdit = {
  curveId: string;
  label: string;
  help: string;
  baseline: number;
  min: number;
  max: number;
  step: number;
  points: StoryPointEdit[];
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
    /** live: one sentence on what the curve is and what bends it (shown under the chart) */
    help?: string;
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
  /** live: every further curve the story bends, each with its own editor under the main one */
  levers: LeverEdit[] = [],
): A2uiMessage {
  // a recorded demo session: the story is fixed because its data already exists, so every curve is
  // read-only and the settings that would change the data are left out
  const replay = demo && live;
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
        children: [
          "intro",
          // several levers: one tab per lever, one chart at a time (stacked charts read as one long form)
          ...(levers.length > 0 ? ["leverTabs"] : ["curve", ...(live ? ["curveHelp"] : [])]),
          ...(replay ? ["s-exp"] : ["basic", "advanced"]),
          "actions",
        ],
      },
      ...(levers.length > 0 ? leverNodes(levers.length, replay) : []),
      {
        id: "intro",
        component: "Text",
        variant: "muted",
        text: replay
          ? "Ukázka přehrává skutečný běh: scénář místo jazykového modelu napsal člověk, data z něj vygeneroval deterministický engine a hypotézy ověřila DuckDB. Příběh je proto pevný; vlastní příběh upravíte v novém chatu."
          : levers.length > 0
            ? `Příběh pohání ${String(levers.length + 1)} ${levers.length + 1 < 5 ? "páky" : "pák"}, každá má svou záložku. Body táhněte v grafu, dvojklikem přidáte nový. Data vzniknou až po vygenerování.`
            : "Body příběhu ohýbají křivku parametru. Táhněte je v grafu, dvojklikem přidáte nový. Data vzniknou až po vygenerování.",
      },
      // live: what this curve is, in words (the id alone, e.g. "late_prob", told users nothing)
      { id: "curveHelp", component: "Text", variant: "caption", text: path("/config/curve/help") },
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
        locked: replay ? true : path("/locked"),
        ...(live && { live: true }),
      },
      { id: "basic", component: "Column", gap: "md", children: ["time", "basicRow"] },
      { id: "time", component: "PeriodPicker", value: path("/config/time"), ...(live && { live: true }) },
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
      { id: "pointList", component: "List", divided: true, children: { componentId: "pt", path: "/points" } },
      { id: "pt", component: "Column", gap: "sm", children: ["ptRow1", "ptRow2"] },
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
      // live: the time of day comes from "Záznam po: dnech s časem" in the period picker
      {
        id: "noiseRow",
        component: "Row",
        gap: "md",
        children: live ? ["nMissing", "nDup"] : ["nMissing", "nDup", "nJitter"],
      },
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
      replay
        ? { id: "exp", component: "Text", variant: "caption", text: path("description") }
        : { id: "exp", component: "CheckBox", label: path("description"), value: path("enabled") },
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
              ...(levers.length > 0 && { levers: path("/levers") }),
            },
          },
        },
      },
    ],
    { points, config, expectations, ...(levers.length > 0 && { levers }) },
    demo,
  );
}

/**
 * Tabs over every lever: the main one (`/points`, `/config/curve`) first, then each of `/levers`.
 * Each tab is the same panel: its draggable curve, what it is, and its value before the story.
 */
function leverNodes(count: number, frozen = false): ComponentNode[] {
  const panel = (
    id: string,
    at: { points: string; curve: string; label: string; help: string },
  ): ComponentNode[] => [
    // frozen (demo replay): read-only curves and no baseline slider
    {
      id,
      component: "Column",
      gap: "sm",
      children: [`${id}Curve`, `${id}Help`, ...(frozen ? [] : [`${id}Base`])],
    },
    {
      id: `${id}Curve`,
      component: "CurveEditor",
      points: path(at.points),
      baseline: path(`${at.curve}/baseline`),
      rampDays: path("/config/curve/rampDays"),
      from: path("/config/time/from"),
      to: path("/config/time/to"),
      min: path(`${at.curve}/min`),
      max: path(`${at.curve}/max`),
      label: path(at.label),
      locked: frozen ? true : path("/locked"),
      live: true,
    },
    { id: `${id}Help`, component: "Text", variant: "caption", text: path(at.help) },
    {
      id: `${id}Base`,
      component: "Slider",
      label: "Výchozí hodnota",
      min: path(`${at.curve}/min`),
      max: path(`${at.curve}/max`),
      steps: path(`${at.curve}/step`),
      value: path(`${at.curve}/baseline`),
    },
  ];
  const others = Array.from({ length: count }, (_, i) => `/levers/${String(i)}`);
  return [
    {
      id: "leverTabs",
      component: "Tabs",
      tabs: [
        { title: path("/config/curve/label"), child: "lv" },
        ...others.map((at, i) => ({ title: path(`${at}/label`), child: `lv${String(i)}` })),
      ],
    },
    ...panel("lv", {
      points: "/points",
      curve: "/config/curve",
      label: "/config/curve/label",
      help: "/config/curve/help",
    }),
    ...others.flatMap((at, i) =>
      panel(`lv${String(i)}`, {
        points: `${at}/points`,
        curve: at,
        label: `${at}/label`,
        help: `${at}/help`,
      }),
    ),
  ];
}

// ---------- dataset (canvas) + chat summary ----------

/** Download formats of a dataset (observed tables only); `path` is relative to the session API. */
export const EXPORT_FORMATS = [
  { format: "xlsx", label: "Excel (.xlsx)" },
  { format: "csv", label: "CSV (.zip)" },
  { format: "parquet", label: "Parquet (.zip)" },
  { format: "duckdb", label: "DuckDB" },
] as const;

/** The compare panel's nodes, ids prefixed so they can live inside another surface (a tab). */
function compareNodes(p: string, c: CompareView): ComponentNode[] {
  return [
    { id: `${p}root`, component: "Column", gap: "lg", children: [`${p}q`, `${p}chart`, `${p}table`] },
    { id: `${p}q`, component: "Callout", tone: "story", title: "Otázka", text: path("/compare/question") },
    {
      id: `${p}chart`,
      component: "LineChart",
      title: c.metric,
      data: path("/compare/series"),
      markers: path("/compare/markers"),
      lines: [
        { key: "a", label: `${c.a} (původní)` },
        { key: "b", label: `${c.b} (co kdyby)`, dashed: true, color: 1 },
      ],
      height: 280,
    },
    {
      id: `${p}table`,
      component: "Table",
      columns: [
        { key: "metric", label: "Metrika" },
        { key: "a", label: c.a, format: "number" },
        { key: "b", label: c.b, format: "number" },
        { key: "relChange", label: "Změna", format: "delta" },
      ],
      rows: path("/compare/diff"),
    },
  ];
}

export function datasetSurface(
  id: string,
  d: DatasetView,
  demo = false,
  /** a what-if dataset: the comparison with its parent becomes a tab of this panel */
  compare?: CompareView,
  /** export formats offered (default: all live, none in the demo); a recorded demo has its own files */
  formats?: readonly string[],
): A2uiMessage {
  const passed = d.expectations.filter((e) => e.pass).length;
  const offered = EXPORT_FORMATS.filter((f) => (formats ? formats.includes(f.format) : !demo));
  const exportNodes: ComponentNode[] = !offered.length
    ? []
    : [
        {
          id: "dl",
          component: "Row",
          gap: "sm",
          align: "center",
          children: ["dlT", ...offered.map((f) => `dl-${f.format}`)],
        },
        { id: "dlT", component: "Text", variant: "label", text: "Stáhnout:" },
        ...offered.map((f) => ({
          id: `dl-${f.format}`,
          component: "Button",
          variant: "secondary",
          label: f.label,
          action: {
            event: {
              name: "download",
              context: { path: `/datasets/${d.datasetId}/export?format=${f.format}` },
            },
          },
        })),
      ];
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
      {
        id: "root",
        component: "Column",
        gap: "lg",
        children: ["kpis", ...(offered.length ? ["dl"] : []), "tabs"],
      },
      ...exportNodes,
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
          ...(compare ? [{ title: `Porovnání s ${compare.a}`, child: "cmp-root" }] : []),
        ],
      },
      ...(compare ? compareNodes("cmp-", compare) : []),
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
      ...(compare && {
        compare: {
          question: compare.question,
          series: compare.series,
          markers: compare.markers,
          diff: compare.diff,
        },
      }),
    },
    demo,
  );
}

/** `live`: also "Upravit křivky", which reopens the story editor to regenerate from this dataset. */
export function readySurface(id: string, datasetId: string, demo = false, live = false): A2uiMessage {
  return create(
    id,
    "Hotovo",
    "chat",
    [
      { id: "root", component: "Card", child: "col" },
      { id: "col", component: "Column", gap: "sm", children: ["t", "row", "about"] },
      {
        id: "t",
        component: "Text",
        text: `Dataset **${datasetId}** je hotový a příběh v něm jde dohledat. Co dál?`,
      },
      { id: "row", component: "Row", gap: "sm", children: ["detect", "open", ...(live ? ["edit"] : [])] },
      {
        id: "about",
        component: "Text",
        variant: "caption",
        text: "ⓘ **Detektiv** je druhý agent, který scénář ani příběh nezná. Dostane jen tabulky, sám píše SQL dotazy a hledá, co se v datech stalo a kdy. Pak jeho zjištění porovnáme s body příběhu: kolik jich našel (recall) a kolik jeho zjištění sedí (precision). Tím ověříme, že příběh je v datech opravdu čitelný. Trvá asi minutu.",
      },
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
      {
        id: "edit",
        component: "Button",
        variant: "secondary",
        label: "Upravit křivky",
        action: { event: { name: "open_canvas", context: { surfaceId: "story", regenFrom: datasetId } } },
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
      { id: "root", component: "Column", gap: "lg", children: ["kpis", "explain", "story", "table"] },
      { id: "kpis", component: "Row", children: ["recall", "precision", "count"] },
      {
        id: "explain",
        component: "Text",
        variant: "caption",
        text: "ⓘ Detektiv viděl jen tabulky, ne scénář. **Recall** = kolik bodů příběhu našel (správná věc, ±14 dní). **Precision** = kolik jeho zjištění odpovídá nějakému bodu příběhu; pravdivá zjištění o následcích se nepočítají, takže je to spodní odhad.",
      },
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
