/**
 * Presenter: turns pipeline data into A2UI surfaces (docs/design/a2ui.md).
 * Pure functions, shared by the mock and the live source. Layout lives here; numbers only ever
 * go into `dataModel` (bound with {"@path"}), never into component props.
 * Moving this file to services/api later = the API emits A2UI and the renderer does not change.
 */
import { a2ui, JOJO_CATALOG_ID, path, type A2uiMessage, type ComponentNode } from "../a2ui/protocol";
import { STEP_LABELS, type StepKey } from "./phrases";
import type { Step, StepState } from "../a2ui/catalog";

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
  /** 0–100, how hard the curve bends at this point */
  strength: number;
};
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
  totals: { rows: number; tables: number; days: number };
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
      { id: "actor", component: "Badge", tone: "info", text: path("name") },
      { id: "proc", component: "Text", variant: "caption", text: path("/processes") },
    ],
    { ...c, processes: `Procesy: ${c.keyProcesses.join(" · ")}` },
    demo,
  );
}

// ---------- story (canvas): timeline + editable points + approve ----------

export function storySurface(
  id: string,
  points: StoryPointEdit[],
  preview: SeriesRow[],
  period: { from: string; to: string },
  demo = false,
): A2uiMessage {
  return create(
    id,
    "Příběh",
    "canvas",
    [
      {
        id: "root",
        component: "Column",
        gap: "lg",
        children: ["head", "timeline", "chart", "editTitle", "points", "actions"],
      },
      { id: "head", component: "Column", gap: "sm", children: ["h", "sub"] },
      { id: "h", component: "Text", variant: "h2", text: "Návrh příběhu" },
      {
        id: "sub",
        component: "Text",
        variant: "muted",
        text: "Body příběhu ohnou křivky parametrů. Upravte je, pak schvalte. Data vzniknou až potom.",
      },
      {
        id: "timeline",
        component: "StoryTimeline",
        points: path("/points"),
        from: path("/period/from"),
        to: path("/period/to"),
      },
      {
        id: "chart",
        component: "LineChart",
        title: "Náhled křivky: průměrné zpoždění dodávky (dny)",
        data: path("/preview"),
        markers: path("/markers"),
        lines: [{ key: "value", label: "Zpoždění" }],
        height: 200,
      },
      { id: "editTitle", component: "Text", variant: "h3", text: "Body příběhu" },
      { id: "points", component: "List", children: { componentId: "point", path: "/points" } },
      { id: "point", component: "Card", child: "pointCol" },
      { id: "pointCol", component: "Column", gap: "sm", children: ["pointHead", "pointDesc", "pointFields"] },
      { id: "pointHead", component: "Row", justify: "spaceBetween", children: ["pointTitle", "pointBadge"] },
      { id: "pointTitle", component: "Text", variant: "h3", text: path("title") },
      { id: "pointBadge", component: "Badge", tone: "story", text: path("id") },
      { id: "pointDesc", component: "Text", variant: "muted", text: path("description") },
      { id: "pointFields", component: "Row", gap: "md", children: ["pointStart", "pointStrength"] },
      { id: "pointStart", component: "TextField", label: "Začátek (RRRR-MM-DD)", value: path("start") },
      {
        id: "pointStrength",
        component: "Slider",
        label: "Síla",
        unit: "%",
        min: 0,
        max: 100,
        steps: 5,
        value: path("strength"),
        weight: 1,
      },
      { id: "actions", component: "Row", justify: "end", children: ["approve"] },
      {
        id: "approve",
        component: "Button",
        variant: "primary",
        label: "Schválit a generovat",
        disabled: path("/locked"),
        action: {
          event: {
            name: "approve",
            userMessage: "Schvaluji příběh, generuj data.",
            context: { points: path("/points") },
          },
        },
      },
    ],
    { points, preview, period, markers: points.map((p) => ({ date: p.start, label: p.title })) },
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
    `Data ${d.datasetId}`,
    "canvas",
    [
      { id: "root", component: "Column", gap: "lg", children: ["h", "kpis", "tabs"] },
      { id: "h", component: "Text", variant: "h2", text: `Dataset ${d.datasetId}` },
      { id: "kpis", component: "Row", gap: "md", children: ["k1", "k2", "k3", "k4"] },
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
          { title: "Tabulky", child: "tables" },
        ],
      },
      { id: "overview", component: "Column", gap: "md", children: ["chart", "hint"] },
      {
        id: "chart",
        component: "LineChart",
        title: "Týdenní průběh klíčových metrik",
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

// ---------- detective (canvas) ----------

export function detectiveSurface(id: string, d: DetectiveView, demo = false): A2uiMessage {
  return create(
    id,
    `Detektiv ${d.datasetId}`,
    "canvas",
    [
      { id: "root", component: "Column", gap: "lg", children: ["h", "kpis", "story", "table"] },
      { id: "h", component: "Text", variant: "h2", text: "Slepý detektiv" },
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
    `${c.a} ↔ ${c.b}`,
    "canvas",
    [
      { id: "root", component: "Column", gap: "lg", children: ["h", "q", "chart", "table"] },
      { id: "h", component: "Text", variant: "h2", text: `Porovnání ${c.a} ↔ ${c.b}` },
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
