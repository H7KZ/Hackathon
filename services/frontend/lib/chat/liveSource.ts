/**
 * Live source: real API session (docs/api-orchestrator.md). Listens to SSE SessionEvents, fetches
 * the data they point to (artifacts, evidence and tables from DuckDB, detective, compare) and feeds
 * it through the same presenter as the demo. User actions become SessionCommands.
 * Pure mappings live in liveMapping.ts.
 */
import type { DatasetEvidence, DetectiveResult, SessionCommand, SessionEvent, SessionState } from "@s2d/api";
import type { MetricDiff, TableInfo, TablePreview } from "@s2d/schema/evidence";
import type { Step } from "../a2ui/catalog";
import { a2ui } from "../a2ui/protocol";
import { apiUrl } from "../api";
import { plural } from "../format";
import {
  compareToView,
  editToStory,
  evidenceToView,
  settingsFrom,
  storyToEdit,
  type StoryArtifact,
} from "./liveMapping";
import { STEP_LABELS, type StepKey } from "./phrases";
import {
  companySurface,
  compareSurface,
  datasetSurface,
  detectiveSurface,
  progressSurface,
  readySurface,
  recoverSurface,
  setSteps,
  storySurface,
  type CompanyView,
  type ExpectationToggle,
  type StoryConfig,
  type StoryPointEdit,
} from "./surfaces";
import type { ChatSource, Emit, UserInput } from "./types";

export { editToStory, evidenceToView, storyToEdit } from "./liveMapping";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${apiUrl()}${path}`);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${String(res.status)}`);
  return (await res.json()) as T;
}

/** Server errors in words a user can act on (the raw text stays in the server log). */
export function humanError(message: string): string {
  if (/LLM_OFFLINE=1|LlmCacheMiss|no cache entry/i.test(message))
    return "Na tohle je potřeba živý jazykový model: offline režim přehrává jen nahrané odpovědi. Zkuste nabídnutou otázku, nebo API spusťte bez LLM_OFFLINE.";
  if (/API key|apiKey|401|authentication/i.test(message))
    return "Jazykový model odmítl přístup (chybí nebo neplatí API klíč).";
  return message;
}

export const LIVE_SUGGESTIONS = ["Co kdyby se změna stala o měsíc později?", "Co kdyby byl dopad poloviční?"];

/** v1 (A1–A4); causal-design steps are added to the list as they start (CASCADE_DESIGN=causal). */
const DRAFT_KEYS: StepKey[] = ["01_company", "02_model", "03_influences", "04_story"];
const PREVIEW_TABLES = 6;
const PREVIEW_ROWS = 8;

export function createLiveSource(sessionId: string): ChatSource {
  let emit: Emit = () => undefined;
  let story: StoryArtifact | null = null;
  let lastDataset: string | null = null;
  let pendingApprove: SessionCommand | null = null;
  let progressId = "";
  let progress: Step[] = [];
  let runs = 0;
  let recoverN = 0;
  let storySurfaceId = "";
  /** true once generation started; async story fetches (replays) must not unlock it again */
  let storyLocked = false;
  let companyShown = false;
  const shownDatasets = new Set<string>();

  const say = (text: string) => {
    emit({ type: "say", role: "agent", text });
  };
  const base = `/sessions/${sessionId}`;

  const command = async (cmd: SessionCommand) => {
    let res: Response;
    try {
      res = await fetch(`${apiUrl()}${base}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cmd),
      });
    } catch {
      say("API je nedostupné. Zkontrolujte, že běží.");
      return;
    }
    if (res.status === 409) say("Ještě běží předchozí krok. Zkuste to za chvilku.");
    else if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { errors?: { message: string }[] } | null;
      say(`Příkaz se nepodařilo odeslat: ${body?.errors?.[0]?.message ?? `HTTP ${String(res.status)}`}`);
    }
  };

  /** Only the draft card grows with steps of the other cascade design; later cards list their own steps. */
  let progressGrows = true;
  const newProgress = (title: string, keys: StepKey[]) => {
    progressId = `progress-${String(++runs)}`;
    progressGrows = keys === DRAFT_KEYS;
    progress = keys.map((id) => ({ id, label: STEP_LABELS[id], state: "pending" }));
    emit({ type: "a2ui", message: progressSurface(progressId, title, progress) });
  };
  const mark = (key: string, state: Step["state"], detail?: string) => {
    if (!progressId) newProgress("Průběh", DRAFT_KEYS);
    if (!progress.some((s) => s.id === key)) {
      // approve re-emits the cached A1–A4 steps: not part of the generation card
      if (!progressGrows) return;
      // a step of the other cascade design: insert it before the first step that has not started
      const label = key in STEP_LABELS ? STEP_LABELS[key as StepKey] : key;
      const at = progress.findIndex((s) => s.state === "pending");
      const step: Step = { id: key, label, state: "pending" };
      progress = at < 0 ? [...progress, step] : [...progress.slice(0, at), step, ...progress.slice(at)];
    }
    progress = progress.map((s) => (s.id === key ? { ...s, state, ...(detail && { detail }) } : s));
    emit({ type: "a2ui", message: setSteps(progressId, progress) });
  };
  /** Steps of the other design that never ran are dropped once the job settles. */
  const pruneProgress = () => {
    if (!progressId || !progress.some((s) => s.state === "pending")) return;
    if (progress.every((s) => s.state === "pending")) return;
    progress = progress.filter((s) => s.state !== "pending");
    emit({ type: "a2ui", message: setSteps(progressId, progress) });
  };

  /** Step details like the demo ("4 aktéři, 4 procesy"), read from the artifact the step just wrote. */
  async function describeStep(step: string) {
    const get = <T>(name: string) => getJson<{ value: T }>(`${base}/artifacts/${name}`).then((r) => r.value);
    if (step === "01_company") {
      const c = await get<CompanyView>("01_company");
      mark(
        step,
        "done",
        `${plural(c.actors.length, "aktér", "aktéři", "aktérů")}, ${plural(c.keyProcesses.length, "proces", "procesy", "procesů")}`,
      );
      if (!companyShown) {
        companyShown = true;
        emit({ type: "a2ui", message: companySurface("company", c) });
      }
    } else if (step === "02_model") {
      const m = await get<{ entities: unknown[]; processes: unknown[] }>("02_model");
      mark(
        step,
        "done",
        `${plural(m.entities.length, "entita", "entity", "entit")}, ${plural(m.processes.length, "proces", "procesy", "procesů")}`,
      );
    } else if (step === "03_influences") {
      const i = await get<{ edges: unknown[] }>("03_influences");
      mark(step, "done", plural(i.edges.length, "vliv", "vlivy", "vlivů"));
    } else if (step === "04_story") {
      const st = await get<StoryArtifact>("04_story");
      mark(step, "done", plural(st.storyPoints.length, "bod příběhu", "body příběhu", "bodů příběhu"));
    }
  }

  async function showStory() {
    const { value } = await getJson<{ value: StoryArtifact }>(`${base}/artifacts/04_story`);
    story = value;
    const edit = storyToEdit(value);
    // one story surface per session: a replay (reload, reopened from history) or a re-run after an
    // edit updates it in place instead of stacking copies
    if (storySurfaceId) {
      emit({
        type: "a2ui",
        message: a2ui.data(storySurfaceId, "/", {
          points: edit.points,
          config: edit.config,
          expectations: edit.expectations,
          locked: storyLocked,
        }),
      });
      return;
    }
    storySurfaceId = "story";
    emit({
      type: "a2ui",
      message: storySurface(storySurfaceId, edit.points, edit.config, edit.expectations, false, true),
    });
    if (storyLocked) emit({ type: "a2ui", message: a2ui.data(storySurfaceId, "/locked", true) });
    say("Návrh příběhu je připravený. Body posuňte přímo v grafu, pak klikněte **Generovat data**.");
  }

  /** Observed tables (totals + Tabulky tab); a nicety, so a failure only leaves the tab out. */
  async function loadTables(datasetId: string) {
    try {
      const { tables } = await getJson<{ tables: TableInfo[] }>(`${base}/datasets/${datasetId}/tables`);
      const picked = [...tables].sort((a, b) => b.rows - a.rows).slice(0, PREVIEW_TABLES);
      const previews = await Promise.all(
        picked.map((t) =>
          getJson<TablePreview>(
            `${base}/datasets/${datasetId}/tables/${encodeURIComponent(t.name)}?limit=${String(PREVIEW_ROWS)}`,
          ),
        ),
      );
      return { previews, rows: tables.reduce((n, t) => n + t.rows, 0), count: tables.length };
    } catch {
      return null;
    }
  }

  async function showDataset(datasetId: string) {
    if (shownDatasets.has(datasetId)) return;
    shownDatasets.add(datasetId);
    lastDataset = datasetId;
    // the story may not be loaded yet when the page is opened on a finished session
    if (!story)
      story = await getJson<{ value: StoryArtifact }>(`${base}/artifacts/04_story`)
        .then((r) => r.value)
        .catch(() => null);
    const [ev, tables] = await Promise.all([
      getJson<DatasetEvidence>(`${base}/datasets/${datasetId}/evidence`),
      loadTables(datasetId),
    ]);
    emit({
      type: "a2ui",
      message: datasetSurface(`dataset-${datasetId}`, evidenceToView(datasetId, ev, story, tables)),
    });
    emit({ type: "a2ui", message: readySurface(`ready-${datasetId}`, datasetId) });
    emit({ type: "suggest", items: LIVE_SUGGESTIONS });
    const state = await getJson<SessionState>(base);
    const info = state.datasets.find((d) => d.id === datasetId);
    if (info?.parent) {
      const [{ diff }, parentEv] = await Promise.all([
        getJson<{ diff: MetricDiff[] }>(`${base}/datasets/${datasetId}/compare/${info.parent}`),
        getJson<DatasetEvidence>(`${base}/datasets/${info.parent}/evidence`),
      ]);
      const question = info.question ?? "Úprava scénáře";
      emit({
        type: "a2ui",
        message: compareSurface(
          `compare-${info.parent}-${datasetId}`,
          compareToView(info.parent, datasetId, question, diff, parentEv, ev, story),
        ),
      });
      const passed = ev.expectations.filter((e) => e.pass).length;
      say(
        `Hotovo: **${datasetId}** odpovídá na „${question}“. Původní důkazy teď platí ${String(passed)} z ${String(ev.expectations.length)}, rozdíly proti ${info.parent} jsou v porovnání.`,
      );
    }
  }

  async function showDetective(datasetId: string) {
    const { result } = await getJson<{ result: DetectiveResult | null }>(
      `${base}/datasets/${datasetId}/detective`,
    );
    if (!result) return;
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
    say(`Detektiv data neznal a našel ${String(Math.round(result.score.recall * 100))} % bodů příběhu.`);
  }

  /** Offer to continue only if the session is still stuck (a replay may already be past it). */
  async function offerRecovery(status: string) {
    const state = await getJson<SessionState>(base);
    if (state.status !== status) return;
    const id = `recover-${String(++recoverN)}`;
    const text =
      status === "interrupted"
        ? "Server se během práce restartoval. Můžu pokračovat tam, kde skončil."
        : status === "cancelled"
          ? "Návrh byl zrušen. Můžu v něm pokračovat."
          : `Návrh se nepovedl: ${humanError(state.error ?? "neznámá chyba")}`;
    emit({
      type: "a2ui",
      message: recoverSurface(id, text, status === "failed" ? "Zkusit znovu" : "Pokračovat", "resume"),
    });
  }

  function onEvent(e: SessionEvent) {
    const fail = (err: unknown) => {
      say(`Data se nepodařilo načíst: ${err instanceof Error ? err.message : String(err)}`);
    };
    switch (e.type) {
      case "status":
        if (e.status === "drafting") newProgress("Agenti navrhují příběh", DRAFT_KEYS);
        if (e.status === "refining") newProgress("Přepočítávám návrh", ["04_story"]);
        if (e.status === "generating") {
          newProgress("Generování dat", ["05_scenario", "engine", "evidence"]);
          storyLocked = true;
          if (storySurfaceId) emit({ type: "a2ui", message: a2ui.data(storySurfaceId, "/locked", true) });
        }
        if (e.status === "detecting") newProgress("Detektiv", ["detective"]);
        if (e.status === "awaiting_refinement") {
          pruneProgress();
          storyLocked = false;
          emit({ type: "busy", step: null });
          if (pendingApprove) {
            const cmd = pendingApprove;
            pendingApprove = null;
            void command(cmd);
          } else void showStory().catch(fail);
        }
        if (e.status === "ready") {
          pruneProgress();
          emit({ type: "busy", step: null });
        }
        if (e.status === "failed" || e.status === "interrupted" || e.status === "cancelled") {
          emit({ type: "busy", step: null });
          void offerRecovery(e.status).catch(() => undefined);
        }
        if (["drafting", "refining", "generating", "detecting"].includes(e.status))
          emit({
            type: "busy",
            step: STEP_LABELS[
              e.status === "detecting"
                ? "detective"
                : e.status === "generating"
                  ? "05_scenario"
                  : "01_company"
            ],
          });
        break;
      case "cascade": {
        const c = e.event;
        if (c.type === "step.started") {
          mark(c.step, "running");
          emit({ type: "busy", step: STEP_LABELS[c.step] });
        } else if (c.type === "step.done") {
          mark(c.step, "done", c.cached ? "z cache" : undefined);
          if (c.step === "05_scenario") mark("engine", "running");
          void describeStep(c.step).catch(() => undefined); // details are a nicety, never an error
        } else if (c.type === "loop.iteration")
          mark(c.step, c.ok ? "done" : "running", `pokus ${String(c.n)}${c.ok ? "" : ": opravuji chyby"}`);
        break;
      }
      case "dataset.ready":
        mark("05_scenario", "done");
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
        if (progressId)
          progress
            .filter((s) => s.state === "running")
            .forEach((s) => {
              mark(s.id, "failed");
            });
        say(`Chyba: ${humanError(e.message)}`);
        break;
    }
  }

  function approve(context: Record<string, unknown>) {
    if (storySurfaceId) emit({ type: "a2ui", message: a2ui.data(storySurfaceId, "/locked", true) });
    const config = context.config as StoryConfig | undefined;
    const settings = settingsFrom(config, context.expectations as ExpectationToggle[] | undefined);
    const approveCmd: SessionCommand = { type: "approve", settings };
    const edited = context.points as StoryPointEdit[] | undefined;
    if (story && edited) {
      const next = editToStory(story, edited, config?.curve.baseline);
      // compare normalized forms: mapping alone (key order, phases) must not count as an edit
      const same = storyToEdit(story);
      const unchanged = editToStory(story, same.points, same.config.curve.baseline);
      if (JSON.stringify(next) !== JSON.stringify(unchanged)) {
        pendingApprove = approveCmd; // sent once the edited story is re-drafted (awaiting_refinement)
        story = next; // markers on the dataset chart follow the edited story
        void fetch(`${apiUrl()}${base}/artifacts/04_story`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        }).then(async (res) => {
          if (res.ok) return;
          pendingApprove = null;
          if (storySurfaceId) emit({ type: "a2ui", message: a2ui.data(storySurfaceId, "/locked", false) });
          const body = (await res.json().catch(() => null)) as {
            errors?: { path: string; message: string }[];
          } | null;
          const first = body?.errors?.[0];
          say(
            first
              ? `Úpravu nešlo uložit: ${first.path}: ${first.message}`
              : `Úpravu nešlo uložit (HTTP ${String(res.status)}).`,
          );
        });
        return;
      }
    }
    void command(approveCmd);
  }

  return {
    demo: false,
    cancel() {
      void command({ type: "cancel" });
    },
    start(next) {
      emit = next;
      const source = new EventSource(`${apiUrl()}${base}/events`);
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
        else say("Otázku „co kdyby…“ položte, až budou data hotová.");
        return;
      }
      const { action } = msg;
      if (action.userMessage) emit({ type: "say", role: "user", text: action.userMessage });
      if (action.name === "approve") approve(action.context);
      if (action.name === "detect")
        void command({ type: "detect", datasetId: String(action.context.datasetId) });
      if (action.name === "resume") {
        const id = action.context.surfaceId;
        if (typeof id === "string") emit({ type: "a2ui", message: a2ui.data(id, "/locked", true) });
        void command({ type: "resume" });
      }
    },
  };
}
