/**
 * Scripted demo (`?demo=1`): plays the whole JOJO workflow on mock data through the same presenter
 * the live source uses. States mirror the API session machine (docs/api-orchestrator.md):
 * drafting → awaiting_refinement → generating → ready ⟲ (detect | what-if).
 */
import type { SessionInput } from "@s2d/api";
import { plural } from "../format";
import type { Step } from "../a2ui/catalog";
import { a2ui } from "../a2ui/protocol";
import { STEP_LABELS, type StepKey } from "./phrases";
import {
  MOCK_COMPANY,
  DEFAULT_CONFIG,
  MOCK_EXPECTATIONS,
  MOCK_POINTS,
  normalize,
  mockCompare,
  mockDataset,
  mockDetective,
} from "./mockData";
import {
  companySurface,
  compareSurface,
  datasetSurface,
  detectiveSurface,
  progressSurface,
  readySurface,
  setSteps,
  steps,
  storySurface,
  type ExpectationToggle,
  type StoryConfig,
  type StoryPointEdit,
} from "./surfaces";
import type { ChatSource, Emit, UserInput } from "./types";

type Phase = "drafting" | "awaiting_refinement" | "generating" | "ready" | "busy";

export const WHAT_IF_SUGGESTIONS = [
  "Co kdyby dodavatel zpožďoval jen 2 týdny?",
  "Co kdyby se zpoždění týkalo i druhého dodavatele?",
];

/** `speed` < 1 makes the demo faster (tests use 0). */
export function createMockSource(input: SessionInput, { speed = 1 } = {}): ChatSource {
  let emit: Emit = () => undefined;
  let phase: Phase = "drafting";
  let points: StoryPointEdit[] = MOCK_POINTS;
  let config: StoryConfig = DEFAULT_CONFIG;
  let expectations: ExpectationToggle[] = MOCK_EXPECTATIONS;
  let datasets = 0;
  let runs = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        timers.delete(t);
        resolve();
      }, ms * speed);
      timers.add(t);
    });

  /** Runs `keys` one by one in a progress card; `extra` adds detail lines to steps (loop iterations etc.). */
  async function pipeline(
    title: string,
    keys: StepKey[],
    ms: number,
    detail: Partial<Record<StepKey, string>> = {},
  ) {
    const id = `progress-${String(++runs)}`;
    const list: Step[] = steps(keys);
    emit({ type: "a2ui", message: progressSurface(id, title, list, true) });
    const set = (key: StepKey, patch: Partial<Step>) => {
      const next = list.map((s) => (s.id === key ? { ...s, ...patch } : s));
      list.splice(0, list.length, ...next);
      emit({ type: "a2ui", message: setSteps(id, next) });
    };
    for (const key of keys) {
      if (stopped) return;
      set(key, { state: "running" });
      emit({ type: "busy", step: STEP_LABELS[key] });
      await wait(ms);
      set(key, { state: "done", ...(detail[key] && { detail: detail[key] }) });
    }
  }

  async function draft() {
    emit({ type: "say", role: "user", text: `**${input.company}**\n${input.story}` });
    await wait(400);
    emit({
      type: "say",
      role: "agent",
      text: "Pouštím se do toho. Nejdřív firmu poznám, pak navrhnu příběh.",
    });
    await pipeline("Agenti navrhují příběh", ["01_company", "02_model", "03_influences", "04_story"], 1500, {
      "01_company": "4 aktéři, 4 procesy",
      "02_model": "12 tabulek, 9 vazeb",
      "03_influences": "7 vlivů",
      "04_story": "3 body příběhu",
    });
    if (stopped) return;
    emit({ type: "a2ui", message: companySurface("company", MOCK_COMPANY, true) });
    emit({
      type: "a2ui",
      message: storySurface("story", points, config, expectations, true),
    });
    emit({ type: "busy", step: null });
    emit({
      type: "say",
      role: "agent",
      text: "Návrh příběhu je připravený. Body posuňte přímo v grafu, pak klikněte **Generovat data**.",
    });
    phase = "awaiting_refinement";
  }

  async function generate() {
    phase = "generating";
    const id = `d${String(++datasets)}`;
    const ds = mockDataset(id, points, config, expectations);
    const passed = ds.expectations.filter((e) => e.pass).length;
    await pipeline("Generování dat", ["05_scenario", "engine", "integrity", "evidence"], 1300, {
      "05_scenario": `${plural(points.length, "bod příběhu", "body příběhu", "bodů příběhu")}, seed ${String(config.seed)}`,
      engine: `${ds.totals.rows.toLocaleString("cs-CZ")} řádků`,
      integrity: "všechny cizí klíče sedí",
      evidence: `splněno ${String(passed)} z ${plural(ds.expectations.length, "hypotézy", "hypotéz", "hypotéz")}`,
    });
    if (stopped) return;
    emit({ type: "a2ui", message: datasetSurface(`dataset-${id}`, ds, true) });
    emit({ type: "a2ui", message: readySurface(`ready-${id}`, id, true) });
    emit({ type: "busy", step: null });
    emit({ type: "suggest", items: WHAT_IF_SUGGESTIONS });
    phase = "ready";
  }

  async function detect(datasetId: string) {
    phase = "busy";
    emit({ type: "suggest", items: [] });
    await pipeline("Detektiv", ["detective"], 2600, { detective: "4 zjištění, 9 dotazů SQL" });
    if (stopped) return;
    emit({
      type: "a2ui",
      message: detectiveSurface(`detective-${datasetId}`, mockDetective(datasetId), true),
    });
    emit({ type: "busy", step: null });
    emit({
      type: "say",
      role: "agent",
      text: "Detektiv data neznal, a přesto našel 2 ze 3 bodů příběhu. Výsledek najdete v panelu Detektiv d1.",
    });
    emit({ type: "suggest", items: WHAT_IF_SUGGESTIONS });
    phase = "ready";
  }

  async function whatIf(question: string) {
    phase = "busy";
    emit({ type: "suggest", items: [] });
    const id = `d${String(++datasets)}`;
    await pipeline(`Co kdyby… (${id})`, ["whatIf", "engine", "evidence", "compare"], 1100, {
      whatIf: "upravena 1 křivka, stejný seed",
      engine: "stejný seed, stejné tabulky",
    });
    if (stopped) return;
    emit({
      type: "a2ui",
      message: compareSurface(`compare-d1-${id}`, mockCompare(question, points, config), true),
    });
    emit({ type: "busy", step: null });
    emit({
      type: "say",
      role: "agent",
      text: "Hotovo. Když se dodavatel po 2 týdnech vrátí k normálu, storna i stížnosti klesnou. Porovnání najdete v panelu d1 ↔ d2.",
    });
    emit({ type: "suggest", items: WHAT_IF_SUGGESTIONS });
    phase = "ready";
  }

  return {
    demo: true,
    start(next) {
      emit = next;
      stopped = false;
      void draft();
      return () => {
        stopped = true;
        for (const t of timers) clearTimeout(t);
        timers.clear();
      };
    },
    send(msg: UserInput) {
      if (msg.kind === "action") {
        const { action } = msg;
        if (action.name === "open_canvas") return; // handled by the workspace
        if (action.userMessage) emit({ type: "say", role: "user", text: action.userMessage });
        if (action.name === "approve" && phase === "awaiting_refinement") {
          const ctx = action.context;
          if (Array.isArray(ctx.points)) points = ctx.points as StoryPointEdit[];
          if (ctx.config && typeof ctx.config === "object") config = normalize(ctx.config as StoryConfig);
          if (Array.isArray(ctx.expectations)) expectations = ctx.expectations as ExpectationToggle[];
          emit({ type: "a2ui", message: a2ui.data("story", "/locked", true) });
          void generate();
        } else if (action.name === "detect" && phase === "ready") {
          void detect(typeof action.context.datasetId === "string" ? action.context.datasetId : "d1");
        } else {
          emit({ type: "say", role: "agent", text: "Teď to nejde, ještě dokončuji předchozí krok." });
        }
        return;
      }
      emit({ type: "say", role: "user", text: msg.text });
      if (phase === "ready") void whatIf(msg.text);
      else if (phase === "awaiting_refinement")
        emit({
          type: "say",
          role: "agent",
          text: "Příběh upravíte přímo v návrhu. Až budete spokojeni, klikněte **Generovat data**.",
        });
      else emit({ type: "say", role: "agent", text: "Chvilku, ještě pracuju. Hned jak doběhnu, ozvu se." });
    },
  };
}
