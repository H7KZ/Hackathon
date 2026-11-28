/**
 * Fake ports: deterministic, no LLM, no DuckDB. Used by the API tests and by `API_PORTS=fake`
 * (frontend / noiser development without API keys or a recorded cache). Not for the demo.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactName } from "@s2d/schema/artifacts";
import type { Scenario } from "@s2d/schema/scenario";
import type { Ports } from "../ports";

/** The v1 cascade (CascadeOptions.design "v1"); the fake does not model the causal path. */
const ORDER: readonly ArtifactName[] = ["01_company", "02_model", "03_influences", "04_story", "05_scenario"];
const DAY_MS = 86_400_000;

export interface FakeCalls {
  /** One entry per artifact the fake cascade actually produced (not reused from disk). */
  produced: string[];
  whatIf: string[];
  noiserSeeds: number[];
  detective: number;
}

export interface FakeOptions {
  /** The scenario every fake artifact is derived from (e.g. scenarios/supplier_delay.json). */
  scenario: Scenario;
  /** Holds every produced step until resolved (busy/cancel tests). */
  gate?: Promise<void>;
  failAt?: ArtifactName;
  /** Artificial delay per step so a UI can show progress. */
  delayMs?: number;
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason as Error);
    });
  });

/** Daily orders that drop by 30 % from the first story point on: something to draw. */
function fakeSeries(storyPoints: Scenario["storyPoints"], seed: number) {
  const first = storyPoints[0]?.start ?? "2025-03-01";
  const t0 = Date.parse(first);
  const points = Array.from({ length: 120 }, (_, i) => {
    const t = t0 + (i - 60) * DAY_MS;
    const base = 100 + ((seed * 7 + i * 13) % 11) - 5;
    return { day: new Date(t).toISOString().slice(0, 10), value: t >= t0 ? Math.round(base * 0.7) : base };
  });
  return [{ table: "objednavky", dateColumn: "date", metric: "rows", points }];
}

const pad = (n: number) => String(n + 1).padStart(6, "0");
/** Two small observed tables for the Data view (rows are generated on demand). */
const FAKE_TABLES = [
  {
    name: "prodejna",
    rows: 5,
    columns: [
      { name: "id", type: "VARCHAR" },
      { name: "mesto", type: "VARCHAR" },
    ],
    row: (i: number) => ({
      id: `STO-00${String(i + 1)}`,
      mesto: ["Praha", "Brno", "Ostrava", "Plzeň", "Olomouc"][i % 5],
    }),
  },
  {
    name: "objednavky",
    rows: 1200,
    columns: [
      { name: "id", type: "VARCHAR" },
      { name: "date", type: "DATE" },
      { name: "prodejna_id", type: "VARCHAR" },
      { name: "mnozstvi", type: "BIGINT" },
    ],
    row: (i: number) => ({
      id: `objednavky-${pad(i)}`,
      date: new Date(Date.UTC(2025, 0, 1 + Math.floor(i / 10))).toISOString().slice(0, 10),
      prodejna_id: `STO-00${String((i % 5) + 1)}`,
      mnozstvi: 1 + ((i * 7) % 5),
    }),
  },
];

export function fakePorts(opts: FakeOptions) {
  const { scenario } = opts;
  const calls: FakeCalls = { produced: [], whatIf: [], noiserSeeds: [], detective: 0 };
  const artifacts: Partial<Record<ArtifactName, unknown>> = {
    "01_company": {
      industry: "maloobchod",
      size: "5 prodejen",
      actors: [{ kind: "supplier", name: "SUP-002", description: "dodavatel" }],
      keyProcesses: ["zásobování"],
    },
    "02_model": { entities: scenario.entities, flows: scenario.flows, processes: scenario.processes },
    "03_influences": {
      edges: [
        { from: "delay", to: "stock", direction: "negative", weight: 0.7, delayDays: 7, rationale: "x" },
      ],
    },
    "04_story": {
      storyPoints: scenario.storyPoints,
      curves: scenario.curves,
      expectations: scenario.expectations,
    },
    "05_scenario": scenario,
  };

  const ports: Ports = {
    cascade: {
      async run(_input, { dir, until, onEvent, signal }) {
        for (const name of ORDER.slice(0, ORDER.indexOf(until) + 1)) {
          const file = join(dir, `${name}.json`);
          onEvent({ type: "step.started", step: name });
          if (existsSync(file)) {
            onEvent({ type: "step.done", step: name, cached: true });
            continue;
          }
          if (opts.gate) await opts.gate;
          if (opts.delayMs) await wait(opts.delayMs, signal);
          signal.throwIfAborted();
          if (opts.failAt === name) throw new Error(`fake failure at ${name}`);
          if (name === "05_scenario") {
            onEvent({ type: "loop.iteration", step: name, n: 1, ok: true, feedback: [] });
          }
          writeFileSync(file, JSON.stringify(artifacts[name]));
          calls.produced.push(name);
          onEvent({ type: "step.done", step: name, cached: false });
        }
      },
      async whatIf(question, base, { signal }) {
        if (opts.delayMs) await wait(opts.delayMs, signal);
        signal.throwIfAborted();
        calls.whatIf.push(question);
        return { ...base, meta: { ...base.meta, name: `${base.meta.name} (${question})` } };
      },
    },
    noiser: {
      run(s, seed) {
        calls.noiserSeeds.push(seed);
        return Promise.resolve({
          tables: [],
          storyPoints: s.storyPoints,
          meta: {
            scenarioId: s.meta.id,
            seed,
            scenarioHash: JSON.stringify(s).length.toString(),
            engineVersion: "fake",
          },
        });
      },
    },
    dataer: {
      store(run, dbPath) {
        writeFileSync(dbPath, JSON.stringify({ meta: run.meta, storyPoints: run.storyPoints }));
        return Promise.resolve();
      },
      evidence(dbPath, expectations) {
        const db = JSON.parse(readFileSync(dbPath, "utf8")) as {
          meta: { seed: number };
          storyPoints: Scenario["storyPoints"];
        };
        return Promise.resolve({
          expectations: expectations.map((e) => ({
            id: e.id,
            pass: true,
            before: 100,
            after: 70,
            relChange: -0.3,
          })),
          series: fakeSeries(db.storyPoints, db.meta.seed),
        });
      },
      compare() {
        return Promise.resolve([{ metric: "objednavky.count", a: 100, b: 85, delta: -15, relChange: -0.15 }]);
      },
      tables() {
        return Promise.resolve(FAKE_TABLES.map(({ name, rows, columns }) => ({ name, rows, columns })));
      },
      preview(_dbPath, table, limit) {
        const t = FAKE_TABLES.find((x) => x.name === table);
        if (!t) return Promise.reject(new Error(`Tabulka "${table}" neexistuje.`));
        const n = Math.min(200, Math.max(1, limit), t.rows);
        return Promise.resolve({
          name: t.name,
          rows: t.rows,
          columns: t.columns,
          rowsShown: Array.from({ length: n }, (_, i) => t.row(i)),
        });
      },
      export(_dbPath, format, outDir) {
        mkdirSync(outDir, { recursive: true });
        const file = join(outDir, `fake.${format}`);
        writeFileSync(file, `fake ${format} export`);
        return Promise.resolve({
          file,
          filename: `dataset.${format}`,
          contentType: "application/octet-stream",
        });
      },
      async detective(_dbPath, { onEvent, signal }) {
        if (opts.delayMs) await wait(opts.delayMs, signal);
        signal.throwIfAborted();
        onEvent({ type: "log", message: "SQL: SELECT count(*) FROM objednavky" });
        calls.detective += 1;
        return {
          report: { narrative: "Od března klesly objednávky o 30 %.", findings: [] },
          score: { recall: 1, precision: 1, matched: [] },
        };
      },
    },
  };
  return { ports, calls, scenario };
}
