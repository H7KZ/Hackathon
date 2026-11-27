/**
 * Generation settings chosen in the UI story editor ("Generovat data"), applied to the cascade's
 * 05_scenario right before the engine runs. The cascade output stays untouched on disk; the dataset's
 * scenario.json holds the applied version. Story curves are never changed here (hard rule 3).
 */
import type { Scenario } from "@s2d/schema/scenario";
import type { GenerationSettings } from "./contract.draft";

/** Value-like fields that may go missing; keys, references and dates never do. */
const MISSABLE_GENS = new Set(["normal", "poisson", "uniformInt", "categorical", "fake", "lookup"]);
const isKeyOrDate = (name: string) =>
  name === "id" || name === "date" || name === "ts" || name.endsWith("_id") || name.endsWith("_date");

type Fields = Record<string, { gen: string }>;

/** Observed process output tables with their fields (entities and flow snapshots get no noise). */
function observedOutputs(s: Scenario): { table: string; fields: Fields }[] {
  const out: { table: string; fields: Fields }[] = [];
  for (const p of s.processes) {
    const outs = p.type === "branch" ? [p.then, p.else] : [p];
    for (const o of outs) {
      if (o && (o.visibility ?? "observed") === "observed")
        out.push({ table: o.table, fields: o.fields });
    }
  }
  return out;
}

function noiseOf(s: Scenario, n: NonNullable<GenerationSettings["noise"]>): Scenario["noise"] {
  const outputs = observedOutputs(s);
  const missing: Record<string, number> = {};
  const duplicates: Record<string, number> = {};
  for (const { table, fields } of outputs) {
    if (n.duplicates > 0) duplicates[table] = n.duplicates / 100;
    if (n.missing > 0) {
      for (const [col, gen] of Object.entries(fields)) {
        if (MISSABLE_GENS.has(gen.gen) && !isKeyOrDate(col)) missing[`${table}.${col}`] = n.missing / 100;
      }
    }
  }
  // hourJitter adds a "ts" column: skip it when an observed process table already has one
  const clash = outputs.some((o) => "ts" in o.fields);
  return {
    ...(Object.keys(missing).length > 0 && { missing }),
    ...(Object.keys(duplicates).length > 0 && { duplicates }),
    ...(n.hourJitter && !clash && { hourJitter: true }),
  };
}

export function applySettings(scenario: Scenario, settings: GenerationSettings | undefined): Scenario {
  if (!settings) return scenario;
  const next: Scenario = structuredClone(scenario);
  if (settings.seed !== undefined) next.meta.seed = settings.seed;
  if (settings.scale !== undefined) {
    if (settings.scale === 1) delete next.meta.scale;
    else next.meta.scale = settings.scale;
  }
  if (settings.expectations) {
    const keep = new Set(settings.expectations);
    next.expectations = next.expectations.filter((e) => keep.has(e.id));
  }
  if (settings.noise) {
    const noise = noiseOf(next, settings.noise);
    if (noise && Object.keys(noise).length > 0) next.noise = noise;
    else delete next.noise;
  }
  return next;
}
