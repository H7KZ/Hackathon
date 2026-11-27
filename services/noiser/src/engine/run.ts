/**
 * Engine entry point (SPEC §3.C). Pure: scenario + seed in, in-memory tables out.
 * Persisting to DuckDB is @s2d/dataer's job.
 *
 *   generate entities (static), init flows
 *   for day in [start..end]:
 *     apply flow effects scheduled for today (e.g. late deliveries)
 *     for process in topo order: arrival emits, branch/derive consume records due today
 *     snapshot flows
 *
 * Every entity, flow and process draws from its own stream hash(seed, id), so editing one process
 * never reshuffles another (SPEC §2 rule 3).
 */
import type { RunResult } from "@s2d/schema/run";
import type { ProcessDef, Scenario } from "@s2d/schema/scenario";
import { topoSort } from "../compiler/dag";
import { toDay } from "./days";
import { EntityStore } from "./entities";
import { EngineError } from "./errors";
import { FlowStore } from "./flows";
import { arrivalRunner } from "./processes/arrival";
import { branchRunner } from "./processes/branch";
import { Bus, type Runner } from "./processes/common";
import { deriveRunner } from "./processes/derive";
import { hashString } from "./rng";
import type { Runtime } from "./types";

export const ENGINE_VERSION = "1.0.0";

export interface RunOptions {
  seed?: number;
  /** Multiplies entity counts >= 50 and arrival rates (A5 loop uses 0.2). Default: meta.scale ?? 1. */
  scale?: number;
}

export function resolveOptions(scenario: Scenario, opts: RunOptions): { seed: number; scale: number } {
  const seed = opts.seed ?? scenario.meta.seed;
  const scale = opts.scale ?? scenario.meta.scale ?? 1;
  if (!Number.isSafeInteger(seed)) {
    throw new EngineError("options.seed", `seed must be an integer, got ${seed}.`);
  }
  if (!(Number.isFinite(scale) && scale > 0)) {
    throw new EngineError(
      "options.scale",
      `scale must be a finite number > 0 (e.g. 0.2 or 1), got ${scale}.`,
    );
  }
  return { seed, scale };
}

/** 16 hex chars, stable for the same scenario + effective seed/scale. */
export function scenarioHash(scenario: Scenario, seed: number, scale: number): string {
  const json = JSON.stringify({ ...scenario, meta: { ...scenario.meta, seed, scale } });
  return [1, 2].map((k) => hashString(json, k).toString(16).padStart(8, "0")).join("");
}

function runner(p: ProcessDef, index: number, rt: Runtime, bus: Bus): Runner {
  switch (p.type) {
    case "arrival":
      return arrivalRunner(p, index, rt, bus);
    case "branch":
      return branchRunner(p, index, rt, bus);
    case "derive":
      return deriveRunner(p, index, rt, bus);
  }
}

export function runScenario(scenario: Scenario, opts: RunOptions = {}): RunResult {
  const { seed, scale } = resolveOptions(scenario, opts);
  const topo = topoSort(scenario.processes);
  if (!topo.ok) throw new EngineError("processes", `Processes form a cycle: ${topo.cycle.join(", ")}.`);

  const entities = new EntityStore();
  const flows = new FlowStore();
  const rt: Runtime = {
    seed,
    scale,
    start: toDay(scenario.meta.start),
    end: toDay(scenario.meta.end),
    curves: new Map(scenario.curves.map((c) => [c.id, c])),
    entities,
    flows,
  };

  scenario.entities.forEach((def, i) => {
    entities.generate(def, i, rt);
  });
  flows.init(scenario.flows, rt);

  // runners are built in topo order so every source subscribes before records flow
  const bus = new Bus();
  const indexOf = new Map(scenario.processes.map((p, i) => [p.id, i]));
  const runners = topo.order.map((id) => {
    const index = indexOf.get(id) ?? -1;
    return { index, run: runner(scenario.processes[index] as ProcessDef, index, rt, bus) };
  });

  for (let day = rt.start; day <= rt.end; day++) {
    flows.applyDue(day);
    for (const r of runners) r.run.step(day);
    flows.snapshot(day);
  }

  return {
    // declaration order: entities, processes, snapshots
    tables: [
      ...entities.toTables(),
      ...[...runners].sort((a, b) => a.index - b.index).flatMap((r) => r.run.tables()),
      ...flows.toTables(),
    ],
    meta: {
      scenarioId: scenario.meta.id,
      seed,
      scenarioHash: scenarioHash(scenario, seed, scale),
      engineVersion: ENGINE_VERSION,
    },
    storyPoints: scenario.storyPoints,
  };
}
