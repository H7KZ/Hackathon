/**
 * Demo ports (docs/demo-data.md): the LLM steps answered by a hand-written case instead of a model.
 * Everything else stays real: the orchestrator, the engine, DuckDB, integrity, evidence, compare and
 * detective scoring. Used by `pnpm demo:record`, which stores the session for the offline UI demo.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { readTruthPoints, runDetectiveSql, scoreFindings, withSandbox } from "@s2d/dataer";
import { compileScenario } from "@s2d/noiser";
import type { ArtifactName } from "@s2d/schema/artifacts";
import { DemoCase } from "@s2d/schema/demo";
import type { SessionInput } from "@s2d/schema/api";
import type { Scenario } from "@s2d/schema/scenario";
import type { Ports } from "../ports";
import { dataerPort } from "./dataer";

export interface LoadedCase {
  demo: DemoCase;
  scenario: Scenario;
}

/** Every case in `<scenariosDir>/demo/*.json` with its compiled scenario; throws naming the bad file. */
export function loadDemoCases(scenariosDir: string): LoadedCase[] {
  const dir = join(scenariosDir, "demo");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const parsed = DemoCase.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      if (!parsed.success) throw new Error(`scenarios/demo/${f}: ${parsed.error.message}`);
      const raw: unknown = JSON.parse(readFileSync(join(scenariosDir, parsed.data.scenario), "utf8"));
      const compiled = compileScenario(raw);
      if (!compiled.ok)
        throw new Error(
          `scenarios/${parsed.data.scenario}: ${compiled.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
        );
      return { demo: parsed.data, scenario: compiled.scenario };
    });
}

/** The artifacts the v1 cascade would have written; 02 and 04 are cut from the scenario itself. */
export function demoArtifacts(c: LoadedCase): Record<string, unknown> {
  const s = c.scenario;
  return {
    "01_company": c.demo.company,
    "02_model": { entities: s.entities, flows: s.flows, processes: s.processes },
    "03_influences": c.demo.influences,
    "04_story": { storyPoints: s.storyPoints, curves: s.curves, expectations: s.expectations },
    "05_scenario": s,
  };
}

const STEPS: ArtifactName[] = ["01_company", "02_model", "03_influences", "04_story", "05_scenario"];
const norm = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("cs-CZ");
const sameInput = (a: SessionInput, b: SessionInput) =>
  norm(a.company) === norm(b.company) && norm(a.story) === norm(b.story);

export function findCase(cases: readonly LoadedCase[], input: SessionInput): LoadedCase | undefined {
  return cases.find((c) => sameInput(c.demo.input, input));
}

export function demoCascadePort(cases: readonly LoadedCase[]): Ports["cascade"] {
  return {
    run(input, { dir, until, onEvent, signal }) {
      const c = findCase(cases, input);
      if (!c) return Promise.reject(new Error("Tohle zadání nepatří k žádné ukázce (scenarios/demo)."));
      const artifacts = demoArtifacts(c);
      for (const step of STEPS.slice(0, STEPS.indexOf(until) + 1)) {
        signal.throwIfAborted();
        const file = join(dir, `${step}.json`);
        if (existsSync(file)) {
          onEvent({ type: "step.done", step, cached: true });
          continue;
        }
        onEvent({ type: "step.started", step });
        writeFileSync(file, JSON.stringify(artifacts[step], null, 2));
        // A5's story gate: the recorder checks the same expectations on the stored dataset
        if (step === "05_scenario") onEvent({ type: "loop.iteration", step, n: 1, ok: true, feedback: [] });
        onEvent({ type: "step.done", step, cached: false });
      }
      return Promise.resolve();
    },
    whatIf(question, base, { onEvent }) {
      const c = cases.find((x) => x.scenario.meta.id === base.meta.id) ?? cases[0];
      const w = c?.demo.whatIfs.find((x) => norm(x.question) === norm(question));
      if (!w) {
        const offered = c?.demo.whatIfs.map((x) => `„${x.question}“`).join(", ") ?? "";
        return Promise.reject(new Error(`V ukázce jsou připravené jen otázky ${offered}.`));
      }
      onEvent({ type: "loop.iteration", step: "05_scenario", n: 1, ok: true, feedback: [] });
      onEvent({ type: "log", message: `Protipříklad hotový (1. pokus): ${w.rationale}` });
      const replaced = new Map(w.curves.map((x) => [x.id, x]));
      return Promise.resolve({ ...base, curves: base.curves.map((x) => replaced.get(x.id) ?? x) });
    },
  };
}

/**
 * Real dataer with the detective's report taken from the case. The report is still checked like a real
 * one: every finding's SQL must run on the sandbox and return rows, and the score comes from truth.
 */
export function demoDataerPort(cases: readonly LoadedCase[]): Ports["dataer"] {
  const real = dataerPort();
  return {
    ...real,
    async detective(dbPath) {
      const datasetId = basename(dirname(dbPath));
      const db = readFileSync(join(dirname(dbPath), "scenario.json"), "utf8");
      const id = (JSON.parse(db) as { meta?: { id?: string } }).meta?.id;
      const c = cases.find((x) => x.scenario.meta.id === id) ?? cases[0];
      const report = c?.demo.detective[datasetId];
      if (!report)
        throw new Error(
          `V ukázce je detektiv připravený jen pro ${Object.keys(c?.demo.detective ?? {}).join(", ")}.`,
        );
      await withSandbox(dbPath, async (sandbox) => {
        for (const f of report.findings) {
          const res = await runDetectiveSql(sandbox, f.supportingSql);
          if (!res.ok) throw new Error(`Detective finding "${f.claim}": ${res.error}`);
          if (res.rows.length === 0)
            throw new Error(`Detective finding "${f.claim}": its SQL returns no rows`);
        }
      });
      return { report, score: scoreFindings(report.findings, await readTruthPoints(dbPath)) };
    },
  };
}
