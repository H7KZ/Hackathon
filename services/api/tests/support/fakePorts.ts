/**
 * Fake implementations of the ports teammates will deliver (cascade, noiser, dataer).
 * Deterministic, no LLM, no DuckDB. `gate` lets a test hold a job open (busy/cancel tests).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadScenarioFixture } from "@s2d/test-utils";
import type { Scenario } from "@s2d/schema/scenario";
import type { Ports } from "../../src/ports";

const ORDER = ["01_company", "02_model", "03_influences", "04_story", "05_scenario"] as const;

export interface FakeCalls {
  /** One entry per artifact the fake cascade actually produced (not reused from disk). */
  produced: string[];
  whatIf: string[];
  noiserSeeds: number[];
  detective: number;
}

export function fakePorts(opts: { gate?: Promise<void>; failAt?: (typeof ORDER)[number] } = {}) {
  const calls: FakeCalls = { produced: [], whatIf: [], noiserSeeds: [], detective: 0 };
  const scenario = loadScenarioFixture("supplier_delay") as Scenario;
  const artifacts: Record<(typeof ORDER)[number], unknown> = {
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
  const artifact = (name: (typeof ORDER)[number]) => artifacts[name];

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
          signal.throwIfAborted();
          if (opts.failAt === name) throw new Error(`fake failure at ${name}`);
          if (name === "05_scenario") {
            onEvent({ type: "loop.iteration", step: name, n: 1, ok: true, feedback: [] });
          }
          writeFileSync(file, JSON.stringify(artifact(name)));
          calls.produced.push(name);
          onEvent({ type: "step.done", step: name, cached: false });
        }
      },
      whatIf(question, base, { signal }) {
        signal.throwIfAborted();
        calls.whatIf.push(question);
        return Promise.resolve({ ...base, meta: { ...base.meta, name: `${base.meta.name} (${question})` } });
      },
    },
    noiser: {
      run(s, seed) {
        calls.noiserSeeds.push(seed);
        return {
          tables: [],
          storyPoints: s.storyPoints,
          meta: {
            scenarioId: s.meta.id,
            seed,
            scenarioHash: JSON.stringify(s).length.toString(),
            engineVersion: "fake",
          },
        };
      },
    },
    dataer: {
      store(run, dbPath) {
        writeFileSync(dbPath, JSON.stringify(run.meta));
        return Promise.resolve();
      },
      evidence(dbPath) {
        const meta = JSON.parse(readFileSync(dbPath, "utf8")) as { seed: number };
        return Promise.resolve({
          expectations: [],
          series: [{ table: "seed", points: [{ day: "2025-01-01", value: meta.seed }] }],
        });
      },
      compare() {
        return Promise.resolve([{ metric: "fake", a: 1, b: 2, delta: 1, relChange: 1 }]);
      },
      detective(_dbPath, { signal }) {
        signal.throwIfAborted();
        calls.detective += 1;
        return Promise.resolve({
          report: { narrative: "fake", findings: [] },
          score: { recall: 1, precision: 1, matched: [] },
        });
      },
    },
  };
  return { ports, calls, scenario };
}
