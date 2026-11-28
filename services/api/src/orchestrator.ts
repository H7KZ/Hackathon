/**
 * Session orchestrator (docs/api-orchestrator.md). Shared core behind the REST routes.
 * It sequences calls to the ports, persists state and events, and owns no domain loop itself (D3).
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { compileScenario } from "@s2d/noiser";
import type { CompileError } from "@s2d/schema/api";
import { ArtifactName, ArtifactSchemas, StoryPlan, type CascadeEvent } from "@s2d/schema/artifacts";
import { MetricDiff, TableInfo, TablePreview } from "@s2d/schema/evidence";
import type { Scenario } from "@s2d/schema/scenario";
import {
  DatasetEvidence,
  DetectiveResult,
  type DatasetInfo,
  type SessionCommand,
  type SessionEvent,
  type SessionInput,
  type SessionState,
  type SessionStatus,
} from "@s2d/schema/api";
import type { ExportFile, ExportFormat, Ports } from "./ports";
import { applySettings, periodErrors } from "./settings";
import { NotFoundError, sessionStore, type JobSpec } from "./sessionStore";

export { NotFoundError } from "./sessionStore";

export class BusyError extends Error {
  constructor(readonly status: SessionStatus) {
    super(`Sezení právě zpracovává úlohu (${status}).`);
  }
}

export interface CommandResult {
  seq: number;
  /** Set when the command was rejected before any job started (invalid input or wrong state). */
  errors?: CompileError[];
}

export interface Orchestrator {
  create(input: SessionInput): Promise<{ sessionId: string }>;
  /** Starts a job; throws BusyError if one is running (except `cancel`). */
  command(sessionId: string, cmd: SessionCommand): CommandResult;
  get(sessionId: string): SessionState;
  /** Persisted events with seq > afterSeq (SSE replay). */
  events(sessionId: string, afterSeq?: number): SessionEvent[];
  subscribe(sessionId: string, listener: (e: SessionEvent) => void): () => void;
  /** Resolves when no job is running for the session. */
  idle(sessionId: string): Promise<void>;
  /** On startup: busy sessions on disk → interrupted. */
  recover(): void;
  evidence(sessionId: string, datasetId: string): Promise<DatasetEvidence>;
  compare(sessionId: string, a: string, b: string): Promise<MetricDiff[]>;
  detective(sessionId: string, datasetId: string): Promise<DetectiveResult | null>;
  /** The scenario a dataset was generated from (what-if edits and approve settings applied). */
  scenario(sessionId: string, datasetId: string): Scenario;
  /** Observed tables of a dataset (name, row count, columns). */
  tables(sessionId: string, datasetId: string): Promise<TableInfo[]>;
  /** First rows of one observed table; NotFoundError for unknown or ground-truth tables. */
  preview(sessionId: string, datasetId: string, table: string, limit: number): Promise<TablePreview>;
  /** Observed tables as one download (xlsx / zipped csv or parquet / duckdb); written once per format. */
  exportDataset(sessionId: string, datasetId: string, format: ExportFormat): Promise<ExportFile>;
  /** Current cascade artifact (e.g. 04_story for the timeline editor); throws NotFoundError if not produced yet. */
  artifact(sessionId: string, name: ArtifactName): unknown;
}

type NewEvent = SessionEvent extends infer E ? (E extends SessionEvent ? Omit<E, "seq"> : never) : never;

const ORDER = ArtifactName.options;
const BUSY: SessionStatus[] = ["drafting", "refining", "generating", "detecting"];
const ARTIFACT_SCHEMAS = ArtifactSchemas;

const zodErrors = (issues: { path: PropertyKey[]; message: string }[]): CompileError[] =>
  issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));

export function createOrchestrator(opts: { ports: Ports; runsDir: string }): Orchestrator {
  const { ports } = opts;
  const store = sessionStore(opts.runsDir);
  const live = new Map<string, { seq: number; listeners: Set<(e: SessionEvent) => void> }>();
  const jobs = new Map<string, { abort: AbortController; done: Promise<void> }>();

  const liveOf = (id: string) => {
    let l = live.get(id);
    if (!l) {
      l = { seq: store.events(id).at(-1)?.seq ?? 0, listeners: new Set() };
      live.set(id, l);
    }
    return l;
  };

  function emit(id: string, event: NewEvent): number {
    const l = liveOf(id);
    const full: SessionEvent = { ...event, seq: ++l.seq };
    store.append(id, full);
    for (const fn of l.listeners) fn(full);
    return full.seq;
  }

  function update(id: string, patch: Partial<SessionState>): SessionState {
    const next = { ...store.read(id), ...patch };
    store.write(next);
    if (patch.status) emit(id, { type: "status", status: patch.status });
    return next;
  }

  const reject = (id: string, errors: CompileError[]): CommandResult => ({
    seq: emit(id, {
      type: "error",
      message: errors.map((e) => `${e.path}: ${e.message}`).join("; "),
      errors,
    }),
    errors,
  });

  // ---------- datasets ----------
  async function createDataset(
    id: string,
    scenario: Scenario,
    info: Omit<DatasetInfo, "id" | "seed">,
    seed: number,
  ): Promise<DatasetInfo> {
    // "dat1", "dat2", …: reads as dataset (sessions created before keep their d1, d2)
    const datasetId = `dat${store.read(id).datasets.length + 1}`;
    const dir = store.datasetDir(id, datasetId);
    mkdirSync(dir, { recursive: true });
    store.writeJson(join(dir, "scenario.json"), scenario);
    const run = await ports.noiser.run(scenario, seed);
    const db = join(dir, "db.duckdb");
    await ports.dataer.store(run, db);
    const evidence = await ports.dataer.evidence(db, scenario.expectations);
    store.writeJson(join(dir, "evidence.json"), DatasetEvidence.parse(evidence));
    const dataset: DatasetInfo = { id: datasetId, seed, ...info };
    if (dataset.parent) {
      const diff = await ports.dataer.compare(join(store.datasetDir(id, dataset.parent), "db.duckdb"), db);
      store.writeJson(join(dir, `compare_${dataset.parent}.json`), diff);
    }
    update(id, { datasets: [...store.read(id).datasets, dataset] });
    emit(id, { type: "dataset.ready", datasetId });
    return dataset;
  }

  const datasetOf = (id: string, datasetId: string) => {
    const d = store.read(id).datasets.find((x) => x.id === datasetId);
    if (!d) throw new NotFoundError(`Dataset "${datasetId}" neexistuje.`);
    return { info: d, dir: store.datasetDir(id, datasetId) };
  };

  function compiled(raw: unknown): Scenario {
    const res = compileScenario(raw);
    if (!res.ok) throw Object.assign(new Error("Scénář neprošel kompilací."), { errors: res.errors });
    return res.scenario;
  }

  // ---------- jobs ----------
  async function runJob(id: string, job: JobSpec, signal: AbortSignal): Promise<SessionStatus> {
    const onEvent = (event: CascadeEvent) => {
      emit(id, { type: "cascade", event });
    };
    const cmd = job.command;
    switch (job.kind) {
      case "draft": {
        await ports.cascade.run(store.read(id).input, {
          dir: store.dir(id),
          until: "04_story",
          onEvent,
          signal,
        });
        return "awaiting_refinement";
      }
      case "approve": {
        await ports.cascade.run(store.read(id).input, {
          dir: store.dir(id),
          until: "05_scenario",
          onEvent,
          signal,
        });
        // UI settings (seed, scale, noise, which hypotheses) apply on top of the cascade output
        const settings = cmd?.type === "approve" ? cmd.settings : undefined;
        const designed = compiled(store.readJson(store.artifactPath(id, "05_scenario")));
        const scenario = compiled(applySettings(designed, settings));
        signal.throwIfAborted();
        await createDataset(id, scenario, { parent: null, origin: "approve" }, scenario.meta.seed);
        return "ready";
      }
      case "what_if": {
        if (cmd?.type !== "what_if") throw new Error("invalid job");
        const parent = datasetOf(id, cmd.from);
        const base = compiled(store.readJson(join(parent.dir, "scenario.json")));
        const next = compiled(await ports.cascade.whatIf(cmd.question, base, { onEvent, signal }));
        signal.throwIfAborted();
        await createDataset(
          id,
          next,
          { parent: cmd.from, origin: "what_if", question: cmd.question },
          parent.info.seed,
        );
        return "ready";
      }
      case "edit_scenario": {
        if (cmd?.type !== "edit_scenario") throw new Error("invalid job");
        const parent = datasetOf(id, cmd.from);
        await createDataset(
          id,
          compiled(cmd.scenario),
          { parent: cmd.from, origin: "edit_scenario" },
          parent.info.seed,
        );
        return "ready";
      }
      case "detect": {
        if (cmd?.type !== "detect") throw new Error("invalid job");
        const { dir } = datasetOf(id, cmd.datasetId);
        const result = await ports.dataer.detective(join(dir, "db.duckdb"), { onEvent, signal });
        store.writeJson(join(dir, "detective.json"), DetectiveResult.parse(result));
        emit(id, { type: "detective.done", datasetId: cmd.datasetId });
        return "ready";
      }
    }
  }

  const busyStatus: Record<JobSpec["kind"], SessionStatus> = {
    draft: "drafting",
    approve: "generating",
    what_if: "generating",
    edit_scenario: "generating",
    detect: "detecting",
  };

  function start(id: string, job: JobSpec, status: SessionStatus = busyStatus[job.kind]) {
    store.writeJob(id, job);
    update(id, { status, error: undefined });
    const abort = new AbortController();
    const done = (async () => {
      // a draft that ended failed/cancelled has no stable state to return to: keep job.json so
      // `resume` can re-run it (reusing the artifacts already on disk)
      let keepJob = false;
      try {
        const next = await runJob(id, job, abort.signal);
        abort.signal.throwIfAborted();
        update(id, { status: next });
      } catch (err) {
        if (abort.signal.aborted) {
          update(id, { status: job.fallback });
          keepJob = job.fallback === "cancelled";
        } else {
          const message = err instanceof Error ? err.message : String(err);
          const errors = (err as { errors?: CompileError[] }).errors;
          emit(id, { type: "error", message, ...(errors ? { errors } : {}) });
          update(id, { status: job.fallback === "cancelled" ? "failed" : job.fallback, error: message });
          keepJob = job.fallback === "cancelled";
        }
      } finally {
        if (!keepJob) store.clearJob(id);
        jobs.delete(id);
      }
    })();
    jobs.set(id, { abort, done });
  }

  function editArtifact(id: string, name: ArtifactName, value: unknown): CompileError[] | null {
    if (name === "05_scenario") {
      const res = compileScenario(value);
      if (!res.ok) return res.errors;
    } else {
      const res = ARTIFACT_SCHEMAS[name].safeParse(value);
      if (!res.success) return zodErrors(res.error.issues);
    }
    store.writeJson(store.artifactPath(id, name), value);
    for (const later of ORDER.slice(ORDER.indexOf(name) + 1))
      rmSync(store.artifactPath(id, later), { force: true });
    return null;
  }

  const stableFallback = (s: SessionState): SessionStatus =>
    s.datasets.length ? "ready" : "awaiting_refinement";

  return {
    create(input) {
      const id = randomUUID();
      store.init({ id, status: "drafting", input, datasets: [] });
      start(id, { kind: "draft", fallback: "cancelled" });
      return Promise.resolve({ sessionId: id });
    },

    command(id, cmd) {
      const s = store.read(id);
      const running = jobs.get(id);
      if (cmd.type === "cancel") {
        running?.abort.abort();
        return { seq: liveOf(id).seq };
      }
      if (running) throw new BusyError(s.status);
      const wrongState = (message: string) => reject(id, [{ path: "type", message }]);

      switch (cmd.type) {
        case "approve":
          if (s.status !== "awaiting_refinement")
            return wrongState(`"approve" jde jen ve stavu awaiting_refinement, ne ${s.status}.`);
          if (cmd.settings?.period) {
            // checked before A5 runs: a period that cuts the story off would waste the LLM calls
            const story = StoryPlan.safeParse(store.readJson(store.artifactPath(id, "04_story")));
            const errors = story.success ? periodErrors(story.data, cmd.settings.period) : [];
            if (errors.length) return reject(id, errors);
          }
          start(id, { kind: "approve", command: cmd, fallback: "awaiting_refinement" });
          break;
        case "edit_artifact": {
          const errors = editArtifact(id, cmd.name, cmd.value);
          if (errors) return reject(id, errors);
          start(id, { kind: "draft", fallback: stableFallback(s) }, "refining");
          break;
        }
        case "what_if":
        case "edit_scenario":
        case "detect": {
          const from = cmd.type === "detect" ? cmd.datasetId : cmd.from;
          if (!s.datasets.some((d) => d.id === from)) return wrongState(`Dataset "${from}" neexistuje.`);
          if (cmd.type === "edit_scenario") {
            const res = compileScenario(cmd.scenario);
            if (!res.ok) return reject(id, res.errors);
          }
          start(id, { kind: cmd.type, command: cmd, fallback: "ready" });
          break;
        }
        case "resume": {
          const job = store.readJob(id);
          const resumable: SessionStatus[] = ["interrupted", "failed", "cancelled"];
          if (!resumable.includes(s.status) || !job) return wrongState(`Není co obnovit (stav ${s.status}).`);
          start(id, job);
          break;
        }
      }
      return { seq: liveOf(id).seq };
    },

    get: (id) => store.read(id),
    artifact: (id, name) => store.readJson(store.artifactPath(id, name)),
    events: (id, afterSeq = 0) => store.events(id).filter((e) => e.seq > afterSeq),

    subscribe(id, listener) {
      store.read(id);
      const l = liveOf(id);
      l.listeners.add(listener);
      return () => l.listeners.delete(listener);
    },

    idle: (id) => jobs.get(id)?.done ?? Promise.resolve(),

    recover() {
      for (const id of store.list()) {
        if (!jobs.has(id) && BUSY.includes(store.read(id).status)) update(id, { status: "interrupted" });
      }
    },

    evidence: (id, datasetId) =>
      Promise.resolve(
        DatasetEvidence.parse(store.readJson(join(datasetOf(id, datasetId).dir, "evidence.json"))),
      ),

    async compare(id, a, b) {
      // both ids are checked against the session's datasets (and /^(dat|d)[0-9]+$/) before any path is built
      const da = datasetOf(id, a);
      const db = datasetOf(id, b);
      const stored = join(da.dir, `compare_${db.info.id}.json`);
      if (existsSync(stored)) return MetricDiff.array().parse(store.readJson(stored));
      return ports.dataer.compare(join(db.dir, "db.duckdb"), join(da.dir, "db.duckdb"));
    },

    scenario: (id, datasetId) =>
      store.readJson(join(datasetOf(id, datasetId).dir, "scenario.json")) as Scenario,

    async tables(id, datasetId) {
      return TableInfo.array().parse(
        await ports.dataer.tables(join(datasetOf(id, datasetId).dir, "db.duckdb")),
      );
    },

    async preview(id, datasetId, table, limit) {
      const db = join(datasetOf(id, datasetId).dir, "db.duckdb");
      if (!(await ports.dataer.tables(db)).some((t) => t.name === table))
        throw new NotFoundError(`Tabulka "${table}" v datasetu ${datasetId} neexistuje.`);
      return TablePreview.parse(await ports.dataer.preview(db, table, limit));
    },

    async exportDataset(id, datasetId, format) {
      const { dir } = datasetOf(id, datasetId);
      const out = await ports.dataer.export(join(dir, "db.duckdb"), format, join(dir, "export"));
      // "<session 8 chars>-dat1.xlsx": several downloads from different sessions do not overwrite
      const ext = out.filename.slice(out.filename.indexOf("."));
      return { ...out, filename: `jojo-${id.slice(0, 8)}-${datasetId}${ext}` };
    },

    detective(id, datasetId) {
      const path = join(datasetOf(id, datasetId).dir, "detective.json");
      return Promise.resolve(existsSync(path) ? DetectiveResult.parse(store.readJson(path)) : null);
    },
  };
}
