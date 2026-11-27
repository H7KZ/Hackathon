/**
 * One live example per JOJO catalog component: what to try, the components and the data model.
 * Rendered on /lab/components and used by the interaction tests, so the docs, the page and the
 * tests can never disagree about how a component behaves.
 */
import { DEFAULT_CONFIG, MOCK_POINTS, mockSeries } from "../chat/mockData";
import type { ComponentName } from "./catalog";
import { path, type ComponentNode } from "./protocol";

export type Example = {
  name: ComponentName;
  tryIt: string;
  components: ComponentNode[];
  data: Record<string, unknown>;
};

const act = (name: string, context: Record<string, unknown> = {}) => ({ event: { name, context } });

export const EXAMPLES: Example[] = [
  {
    name: "Text",
    tryIt: "Statický i navázaný text, **tučné** písmo, varianty h1–caption.",
    components: [
      { id: "root", component: "Column", gap: "sm", children: ["a", "b", "c"] },
      { id: "a", component: "Text", variant: "h3", text: path("/title") },
      { id: "b", component: "Text", text: "Běžný text s **důrazem**." },
      { id: "c", component: "Text", variant: "caption", text: "Popisek pod grafem" },
    ],
    data: { title: "Nadpis z data modelu" },
  },
  {
    name: "Badge",
    tryIt: "Tóny ok / fail / story mají ikonu, info a neutral jsou čisté.",
    components: [
      { id: "root", component: "Row", gap: "sm", children: ["a", "b", "c", "d", "e"] },
      { id: "a", component: "Badge", tone: "ok", text: "splněno" },
      { id: "b", component: "Badge", tone: "fail", text: "nesplněno" },
      { id: "c", component: "Badge", tone: "story", text: "sp1" },
      { id: "d", component: "Badge", tone: "info", text: "info" },
      { id: "e", component: "Badge", tone: "neutral", text: "ElektroParts s.r.o." },
    ],
    data: {},
  },
  {
    name: "Callout",
    tryIt: "Zvýrazněný blok s nadpisem, tón určuje barvu okraje.",
    components: [{ id: "root", component: "Callout", tone: "story", title: "Otázka", text: path("/q") }],
    data: { q: "Co kdyby dodavatel zpožďoval jen 2 týdny?" },
  },
  {
    name: "Button",
    tryIt: "Klik pošle akci s kontextem vyřešeným z data modelu (viz log). Zaškrtnutím tlačítko zamknete.",
    components: [
      { id: "root", component: "Row", gap: "sm", children: ["go", "alt", "lock"] },
      {
        id: "go",
        component: "Button",
        variant: "primary",
        label: "Generovat",
        disabled: path("/locked"),
        action: act("generate", { seed: path("/seed") }),
      },
      { id: "alt", component: "Button", variant: "secondary", label: "Sekundární", action: act("secondary") },
      { id: "lock", component: "CheckBox", label: "Zamknout", value: path("/locked") },
    ],
    data: { seed: 42, locked: false },
  },
  {
    name: "TextField",
    tryIt: "Psaní zapisuje do data modelu; varianta number ukládá číslo.",
    components: [
      { id: "root", component: "Row", gap: "md", children: ["a", "b"] },
      { id: "a", component: "TextField", label: "Název", value: path("/name"), placeholder: "Nový bod" },
      { id: "b", component: "TextField", variant: "number", label: "Seed", value: path("/seed") },
    ],
    data: { name: "Dodavatel začíná zpožďovat", seed: 42 },
  },
  {
    name: "Slider",
    tryIt: "Táhnutím nebo šipkami mění hodnotu, jednotka a krok jsou konfigurovatelné.",
    components: [
      {
        id: "root",
        component: "Slider",
        label: "Objem dat",
        unit: "×",
        min: 0.2,
        max: 3,
        steps: 0.1,
        value: path("/scale"),
      },
    ],
    data: { scale: 1 },
  },
  {
    name: "ChoicePicker",
    tryIt: "Jedna volba (single) nebo více voleb (multiple); hodnota je seznam řetězců.",
    components: [
      { id: "root", component: "Column", gap: "md", children: ["a", "b"] },
      {
        id: "a",
        component: "ChoicePicker",
        label: "Období",
        variant: "single",
        value: path("/months"),
        options: [
          { label: "3 měsíce", value: "3" },
          { label: "6 měsíců", value: "6" },
          { label: "12 měsíců", value: "12" },
        ],
      },
      {
        id: "b",
        component: "ChoicePicker",
        label: "Tabulky",
        variant: "multiple",
        value: path("/tables"),
        options: [
          { label: "orders", value: "orders" },
          { label: "deliveries", value: "deliveries" },
          { label: "tickets", value: "tickets" },
        ],
      },
    ],
    data: { months: ["6"], tables: ["orders"] },
  },
  {
    name: "CheckBox",
    tryIt: "Zaškrtnutí zapíše true/false.",
    components: [
      { id: "root", component: "CheckBox", label: "Rozházet časy v rámci dne", value: path("/jitter") },
    ],
    data: { jitter: true },
  },
  {
    name: "DateTimeInput",
    tryIt: "Výběr data (ISO RRRR-MM-DD), prázdné pole hodnotu smaže.",
    components: [{ id: "root", component: "DateTimeInput", label: "Začátek", value: path("/start") }],
    data: { start: "2026-03-02" },
  },
  {
    name: "Collapsible",
    tryIt: "Rozbalovací sekce pro pokročilé nastavení; obsah je libovolná komponenta.",
    components: [
      {
        id: "root",
        component: "Collapsible",
        title: "Pokročilé nastavení",
        summary: "šum, velikost",
        child: "in",
      },
      {
        id: "in",
        component: "Slider",
        label: "Chybějící hodnoty",
        unit: "%",
        min: 0,
        max: 20,
        value: path("/m"),
      },
    ],
    data: { m: 2 },
  },
  {
    name: "Tabs",
    tryIt: "Přepínání záložek myší; obsah se renderuje jen pro aktivní.",
    components: [
      {
        id: "root",
        component: "Tabs",
        tabs: [
          { title: "Přehled", child: "a" },
          { title: "Detail", child: "b" },
        ],
      },
      { id: "a", component: "Text", text: "Obsah přehledu" },
      { id: "b", component: "Text", text: "Obsah detailu" },
    ],
    data: {},
  },
  {
    name: "List",
    tryIt: "Šablona se opakuje pro každou položku pole; relativní cesty míří do položky.",
    components: [
      { id: "root", component: "List", children: { componentId: "row", path: "/items" } },
      { id: "row", component: "Row", gap: "sm", children: ["n", "v"] },
      { id: "n", component: "Badge", tone: "story", text: path("id") },
      { id: "v", component: "TextField", label: "Název", value: path("title") },
    ],
    data: { items: MOCK_POINTS.map((p) => ({ id: p.id, title: p.title })) },
  },
  {
    name: "Card",
    tryIt: "Rámeček s volitelným titulkem.",
    components: [
      { id: "root", component: "Card", title: "Firma", child: "t" },
      { id: "t", component: "Text", text: "E-shop s domácími spotřebiči" },
    ],
    data: {},
  },
  {
    name: "Row",
    tryIt: "Vodorovné skládání se zalamováním, mezery sm/md/lg, justify.",
    components: [
      { id: "root", component: "Row", gap: "lg", justify: "spaceBetween", children: ["a", "b"] },
      { id: "a", component: "Badge", text: "vlevo" },
      { id: "b", component: "Badge", text: "vpravo" },
    ],
    data: {},
  },
  {
    name: "Column",
    tryIt: "Svislé skládání s mezerami.",
    components: [
      { id: "root", component: "Column", gap: "sm", children: ["a", "b"] },
      { id: "a", component: "Text", text: "první" },
      { id: "b", component: "Text", text: "druhý" },
    ],
    data: {},
  },
  {
    name: "Divider",
    tryIt: "Oddělovač.",
    components: [
      { id: "root", component: "Column", children: ["a", "d", "b"] },
      { id: "a", component: "Text", text: "nad" },
      { id: "d", component: "Divider" },
      { id: "b", component: "Text", text: "pod" },
    ],
    data: {},
  },
  {
    name: "Kpi",
    tryIt: "Velké číslo v češtině; delta je poměr (0,38 → +38 %).",
    components: [
      { id: "root", component: "Row", children: ["a", "b"] },
      { id: "a", component: "Kpi", label: "Řádků", value: path("/rows"), format: "int" },
      { id: "b", component: "Kpi", label: "Storna", value: path("/c"), format: "percent", delta: path("/d") },
    ],
    data: { rows: 48210, c: 0.079, d: 0.38 },
  },
  {
    name: "Table",
    tryIt: "Klik na hlavičku řadí (znovu = obráceně), „Zobrazit vše“ rozbalí, delta se barví jen s goodWhen.",
    components: [
      {
        id: "root",
        component: "Table",
        maxRows: 3,
        columns: [
          { key: "m", label: "Metrika" },
          { key: "v", label: "Hodnota", format: "number" },
          { key: "r", label: "Změna", format: "delta", goodWhen: "down" },
          { key: "p", label: "Výsledek", format: "pass" },
        ],
        rows: path("/rows"),
      },
    ],
    data: {
      rows: [
        { id: 1, m: "Zpoždění", v: 6.2, r: 0.38, p: true },
        { id: 2, m: "Storna", v: 7.6, r: -0.12, p: true },
        { id: 3, m: "Stížnosti", v: 13.1, r: 0.54, p: false },
        { id: 4, m: "Objednávky", v: 768, r: -0.05, p: true },
      ],
    },
  },
  {
    name: "LineChart",
    tryIt: "Najetím zobrazí hodnoty; ◆ značky jsou body příběhu.",
    components: [
      {
        id: "root",
        component: "LineChart",
        title: "Týdenní metriky",
        data: path("/series"),
        markers: path("/markers"),
        lines: [
          { key: "delay", label: "Zpoždění" },
          { key: "cancel", label: "Storna" },
        ],
        height: 220,
      },
    ],
    data: {
      series: mockSeries(MOCK_POINTS, DEFAULT_CONFIG),
      markers: [{ date: "2026-03-02", label: "sp1" }],
    },
  },
  {
    name: "BarChart",
    tryIt: "Sloupce, legenda u více řad.",
    components: [
      {
        id: "root",
        component: "BarChart",
        data: path("/rows"),
        bars: [
          { key: "a", label: "d1" },
          { key: "b", label: "d2" },
        ],
        height: 200,
      },
    ],
    data: {
      rows: [
        { label: "Zpoždění", a: 6.2, b: 2.2 },
        { label: "Storna", a: 7.6, b: 3.3 },
      ],
    },
  },
  {
    name: "Steps",
    tryIt: "Stav kroků agenta: čeká / běží / hotovo / selhalo.",
    components: [{ id: "root", component: "Steps", steps: path("/steps") }],
    data: {
      steps: [
        { id: "a", label: "Poznávám firmu", state: "done", detail: "4 aktéři" },
        { id: "b", label: "Píšu příběh", state: "running" },
        { id: "c", label: "Generuji data", state: "pending" },
        { id: "d", label: "Detektiv pátrá", state: "failed", detail: "timeout" },
      ],
    },
  },
  {
    name: "StoryTimeline",
    tryIt: "Přehled bodů příběhu na časové ose (jen pro čtení).",
    components: [
      {
        id: "root",
        component: "StoryTimeline",
        points: path("/points"),
        from: "2026-01-05",
        to: "2026-07-05",
      },
    ],
    data: { points: MOCK_POINTS },
  },
  {
    name: "CurveEditor",
    tryIt:
      "Táhněte body (čas i hodnota), čtvereček = návrat k normálu, dvojklik přidá bod, šipky posouvají, Delete maže, Ctrl+Z vrací.",
    components: [
      {
        id: "root",
        component: "CurveEditor",
        points: path("/points"),
        baseline: 2,
        rampDays: 14,
        from: "2026-01-05",
        to: "2026-07-05",
        min: 0,
        max: 10,
        label: "Průměrné zpoždění dodávky",
        unit: "dny",
        height: 240,
      },
    ],
    data: { points: MOCK_POINTS },
  },
];
