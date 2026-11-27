/**
 * Engine entry point (SPEC §3.C). Pure: scenario + seed in, in-memory tables out.
 * Persisting to DuckDB is @s2d/dataer's job.
 *
 *   generate entities (static)
 *   for day in [start..end]:
 *     for process in topo order: generate / consume records
 */
import type { RunResult } from "@s2d/schema/run";
import type { Scenario } from "@s2d/schema/scenario";
import { toDay } from "./days";
import { EntityStore } from "./entities";
import { EngineError } from "./errors";
import { hashString } from "./rng";
import type { FlowAccess, Runtime } from "./types";

export const ENGINE_VERSION = "0.1.0";

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

const noFlows: FlowAccess = {
  level: (flow, _keys, at) => {
    throw new EngineError(at, `flow "${flow}": flows are not supported yet`);
  },
  change: (flow, _keys, _delta, _day, _today, at) => {
    throw new EngineError(at, `flow "${flow}": flows are not supported yet`);
  },
};

export function runScenario(scenario: Scenario, opts: RunOptions = {}): RunResult {
  const { seed, scale } = resolveOptions(scenario, opts);
  const entities = new EntityStore();
  const rt: Runtime = {
    seed,
    scale,
    start: toDay(scenario.meta.start),
    end: toDay(scenario.meta.end),
    curves: new Map(scenario.curves.map((c) => [c.id, c])),
    entities,
    flows: noFlows,
  };

  scenario.entities.forEach((def, i) => {
    entities.generate(def, i, rt);
  });

  return {
    tables: entities.toTables(),
    meta: {
      scenarioId: scenario.meta.id,
      seed,
      scenarioHash: scenarioHash(scenario, seed, scale),
      engineVersion: ENGINE_VERSION,
    },
    storyPoints: scenario.storyPoints,
  };
}
