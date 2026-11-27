/**
 * Live source: real API session (docs/api-orchestrator.md). Listens to SSE SessionEvents, fetches
 * the data they point to (artifacts, evidence from DuckDB, detective, compare) and feeds it through
 * the same presenter as the demo. User actions become SessionCommands.
 *
 * Known gaps (API side): no table-rows endpoint yet (Tabulky tab stays empty), no dataset totals,
 * story-point `strength` is UI-only until 04_story carries it.
 */
import type { DatasetEvidence, DetectiveResult, SessionCommand, SessionEvent, SessionState } from "@s2d/api";
import type { MetricDiff } from "@s2d/schema/evidence";
import type { Step } from "../a2ui/catalog";
import { API_URL } from "../api";
import { DEFAULT_CONFIG, normalize } from "./config";
import { addDays } from "./curve";
import { STEP_LABELS, type StepKey } from "./phrases";
import {
  compareSurface,
  datasetSurface,
  detectiveSurface,
  progressSurface,
  readySurface,
  setSteps,
  storySurface,
  type DatasetView,
  type ExpectationToggle,
  type SeriesRow,
  type StoryConfig,
  type StoryPointEdit,
} from "./surfaces";
import type { ChatSource, Emit, UserInput } from "./types";

type StoryArtifact = {
  storyPoints: {
    id: string;
    phase?: number;
    title: string;
    description: string;
    start: string;
    end?: string;
  }[];
  curves: {
    id: string;
    baseline: number;
    segments: { kind: string; start: string; end?: string; to: number; storyPointId?: string }[];
  }[];
  expectations: { id: string; description: string }[];
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${String(res.status)}`);
  return (await res.json()) as T;
}

/** 04_story → editor model: story points become knots on the first curve (segment `to` = level). */
export function storyToEdit(story: StoryArtifact): {
  points: StoryPointEdit[];
  config: StoryConfig;
  expectations: ExpectationToggle[];
} {
  const curve = story.curves[0];
  const points = story.storyPoints.map((p) => {
    const seg = curve?.segments.find((x) => x.storyPointId === p.id);
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      start: seg?.start ?? p.start,
      level: seg?.to ?? curve?.baseline ?? 0,
      ...((seg?.end ?? p.end) && { end: seg?.end ?? p.end }),
    };
  });
  const starts = points.map((x) => x.start).sort();
  const from = addDays(starts[0] ?? DEFAULT_CONFIG.period.from, -56);
  const levels = [curve?.baseline ?? 0, ...points.map((x) => x.level)];
  const max = Math.max(...levels);
  return {
    points,
    config: normalize({
      ...DEFAULT_CONFIG,
      period: { from, to: from },
      curve: {
        ...DEFAULT_CONFIG.curve,
        label: curve?.id ?? DEFAULT_CONFIG.curve.label,
        unit: "",
        baseline: curve?.baseline ?? 0,
        min: Math.min(0, ...levels),
        max: max > 0 ? Math.ceil(max * 1.4) : 1,
      },
    }),
    expectations: story.expectations.map((e) => ({ id: e.id, description: e.description, enabled: true })),
  };
}

/** Editor model → 04_story: updates points and their ramp segments; adds new, drops deleted ones. */
export function editToStory(
  story: StoryArtifact,
  edited: StoryPointEdit[],
  baseline?: number,
): StoryArtifact {
  const [curve, ...rest] = story.curves;
  const maxPhase = story.storyPoints.reduce((m, p) => Math.max(m, p.phase ?? 0), 0);
  const storyPoints = edited.map((e, i) => {
    const old = story.storyPoints.find((p) => p.id === e.id);
    const { level: _level, ...point } = e;
    return { ...old, ...point, phase: old?.phase ?? maxPhase + i + 1 };
  });
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
  return {
    ...story,
    storyPoints,
    curves: [{ ...curve, baseline: baseline ?? curve.baseline, segments }, ...rest],
  };
}

export function evidenceToView(
  datasetId: string,
  ev: DatasetEvidence,
  story: StoryArtifact | null,
): DatasetView {
  const byDay = new Map<string, SeriesRow>();
  for (const s of ev.series) {
    for (const p of s.points) {
      const row = byDay.get(p.day) ?? { day: p.day };
      row[s.table] = p.value;
      byDay.set(p.day, row);
    }
  }
  const describe = new Map(story?.expectations.map((e) => [e.id, e.description]));
  return {
    datasetId,
    totals: { rows: Number.NaN, tables: Number.NaN, days: byDay.size },
    series: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    seriesLines: ev.series.slice(0, 5).map((s) => ({ key: s.table, label: s.table })),
    markers: (story?.storyPoints ?? []).map((p) => ({ date: p.start, label: p.title })),
    expectations: ev.expectations.map((e) => ({
      id: e.id,
      description: describe.get(e.id) ?? e.id,
      before: e.before,
      after: e.after,
      relChange: e.relChange,
      pass: e.pass,
    })),
    tables: [],
  };
}

const CASCADE_KEYS: StepKey[] = ["01_company", "02_model", "03_influences", "04_story", "05_scenario"];

export function createLiveSource(sessionId: string): ChatSource {
  let emit: Emit = () => undefined;
  let story: StoryArtifact | null = null;
  let lastDataset: string | null = null;
  let pendingApprove = false;
  let progressId = "";
  let progress: Step[] = [];
  let runs = 0;

  const command = async (cmd: SessionCommand) => {
    const res = await fetch(`${API_URL}/sessions/${sessionId}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
    });
    if (res.status === 409)
      emit({ type: "say", role: "agent", text: "Ještě běží předchozí krok. Zkuste to za chvilku." });
    else if (!res.ok)
      emit({
        type: "say",
        role: "agent",
        text: `Příkaz se nepodařilo odeslat (HTTP ${String(res.status)}).`,
      });
  };

  const newProgress = (title: string, keys: StepKey[]) => {
    progressId = `progress-${String(++runs)}`;
    progress = keys.map((id) => ({ id, label: STEP_LABELS[id], state: "pending" }));
    emit({ type: "a2ui", message: progressSurface(progressId, title, progress) });
  };
  const mark = (key: string, state: Step["state"], detail?: string) => {
    if (!progressId) newProgress("Průběh", CASCADE_KEYS);
    progress = progress.map((s) => (s.id === key ? { ...s, state, ...(detail && { detail }) } : s));
    emit({ type: "a2ui", message: setSteps(progressId, progress) });
  };

  async function showStory() {
    const { value } = await getJson<{ value: StoryArtifact }>(`/sessions/${sessionId}/artifacts/04_story`);
    story = value;
    const edit = storyToEdit(value);
    emit({
      type: "a2ui",
      message: storySurface(`story-${String(runs)}`, edit.points, edit.config, edit.expectations),
    });
    emit({
      type: "say",
      role: "agent",
      text: "Návrh příběhu je připravený. Body posuňte přímo v grafu, pak klikněte **Generovat data**.",
    });
  }

  async function showDataset(datasetId: string) {
    lastDataset = datasetId;
    const ev = await getJson<DatasetEvidence>(`/sessions/${sessionId}/datasets/${datasetId}/evidence`);
    emit({
      type: "a2ui",
      message: datasetSurface(`dataset-${datasetId}`, evidenceToView(datasetId, ev, story)),
    });
    emit({ type: "a2ui", message: readySurface(`ready-${datasetId}`, datasetId) });
    const state = await getJson<SessionState>(`/sessions/${sessionId}`);
    const info = state.datasets.find((d) => d.id === datasetId);
    if (info?.parent) {
      const [{ diff }, parentEv] = await Promise.all([
        getJson<{ diff: MetricDiff[] }>(
          `/sessions/${sessionId}/datasets/${datasetId}/compare/${info.parent}`,
        ),
        getJson<DatasetEvidence>(`/sessions/${sessionId}/datasets/${info.parent}/evidence`),
      ]);
      const first = ev.series[0];
      const base = new Map(parentEv.series[0]?.points.map((p) => [p.day, p.value]));
      emit({
        type: "a2ui",
        message: compareSurface(`compare-${info.parent}-${datasetId}`, {
          a: info.parent,
          b: datasetId,
          question: info.question ?? "Úprava scénáře",
          metric: first?.table ?? "",
          markers: [],
          series: (first?.points ?? []).map((p) => ({ day: p.day, a: base.get(p.day) ?? 0, b: p.value })),
          diff: diff.map((d) => ({ metric: d.metric, a: d.a, b: d.b, relChange: d.relChange })),
        }),
      });
    }
  }

  async function showDetective(datasetId: string) {
    const { result } = await getJson<{ result: DetectiveResult }>(
      `/sessions/${sessionId}/datasets/${datasetId}/detective`,
    );
    const matched = new Set(result.score.matched.map((m) => m.findingIndex));
    emit({
      type: "a2ui",
      message: detectiveSurface(`detective-${datasetId}`, {
        datasetId,
        narrative: result.report.narrative,
        recall: result.score.recall,
        precision: result.score.precision,
        findings: result.report.findings.map((f, i) => ({
          claim: f.claim,
          start: f.start,
          entities: f.entities.join(", "),
          matched: matched.has(i),
        })),
      }),
    });
  }

  function onEvent(e: SessionEvent) {
    const fail = (err: unknown) => {
      emit({
        type: "say",
        role: "agent",
        text: `Data se nepodařilo načíst: ${err instanceof Error ? err.message : String(err)}`,
      });
    };
    switch (e.type) {
      case "status":
        if (e.status === "drafting") newProgress("Agenti navrhují příběh", CASCADE_KEYS.slice(0, 4));
        if (e.status === "generating") newProgress("Generování dat", ["05_scenario", "engine", "evidence"]);
        if (e.status === "detecting") newProgress("Detektiv", ["detective"]);
        if (e.status === "awaiting_refinement") {
          emit({ type: "busy", step: null });
          if (pendingApprove) {
            pendingApprove = false;
            void command({ type: "approve" });
          } else void showStory().catch(fail);
        }
        if (e.status === "ready") emit({ type: "busy", step: null });
        if (e.status === "failed" || e.status === "interrupted") emit({ type: "busy", step: null });
        if (["drafting", "refining", "generating", "detecting"].includes(e.status))
          emit({ type: "busy", step: STEP_LABELS[e.status === "detecting" ? "detective" : "01_company"] });
        break;
      case "cascade": {
        const c = e.event;
        if (c.type === "step.started") {
          mark(c.step, "running");
          emit({ type: "busy", step: STEP_LABELS[c.step] });
        } else if (c.type === "step.done") mark(c.step, "done", c.cached ? "z cache" : undefined);
        else if (c.type === "loop.iteration")
          mark(c.step, c.ok ? "done" : "running", `iterace ${String(c.n)}${c.ok ? "" : ": opravuji chyby"}`);
        break;
      }
      case "dataset.ready":
        mark("engine", "done");
        mark("evidence", "done");
        void showDataset(e.datasetId).catch(fail);
        break;
      case "detective.done":
        mark("detective", "done");
        void showDetective(e.datasetId).catch(fail);
        break;
      case "error":
        emit({ type: "busy", step: null });
        emit({ type: "say", role: "agent", text: `Chyba: ${e.message}` });
        break;
    }
  }

  return {
    demo: false,
    start(next) {
      emit = next;
      const source = new EventSource(`${API_URL}/sessions/${sessionId}/events`);
      source.onmessage = (m: MessageEvent<string>) => {
        onEvent(JSON.parse(m.data) as SessionEvent);
      };
      source.onerror = () => {
        emit({ type: "busy", step: null });
      };
      return () => {
        source.close();
      };
    },
    send(msg: UserInput) {
      if (msg.kind === "text") {
        emit({ type: "say", role: "user", text: msg.text });
        if (lastDataset) void command({ type: "what_if", question: msg.text, from: lastDataset });
        else emit({ type: "say", role: "agent", text: "Otázku „co kdyby…“ položte, až budou data hotová." });
        return;
      }
      const { action } = msg;
      if (action.userMessage) emit({ type: "say", role: "user", text: action.userMessage });
      if (action.name === "approve") {
        const edited = action.context.points as StoryPointEdit[] | undefined;
        if (story && edited) {
          const config = action.context.config as StoryConfig | undefined;
          const next = editToStory(story, edited, config?.curve.baseline);
          const changed = JSON.stringify(next) !== JSON.stringify(story);
          if (changed) {
            pendingApprove = true;
            void fetch(`${API_URL}/sessions/${sessionId}/artifacts/04_story`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(next),
            });
            return;
          }
        }
        void command({ type: "approve" });
      }
      if (action.name === "detect")
        void command({ type: "detect", datasetId: String(action.context.datasetId) });
    },
  };
}
