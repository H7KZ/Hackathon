/**
 * Deterministic story checks (no engine, docs/cascade-design.md D5). compileScenario accepts a
 * scenario that is valid but carries no story; these catch that and go back to the agent as feedback.
 * A real Haiku run produced a single-process model with an unused late-delivery curve.
 */
import type { CompileError } from "@s2d/schema/api";
import type { DataModel, StoryPlan } from "@s2d/schema/artifacts";

/** The effect needs a chain to travel through: at least one branch or derive after an arrival. */
export function checkModelShape(model: Pick<DataModel, "processes">): CompileError[] {
  const hasChain = model.processes.some((p) => p.type === "branch" || p.type === "derive");
  if (hasChain) return [];
  return [
    {
      path: "processes",
      message:
        "The model has no causal chain: add branch/derive processes so the story's lever (an arrival or a field probability) leads to the outcome tables, e.g. order -> branch on stock -> sale / lost_sale -> derive complaint.",
    },
  ];
}

/** Every curve planned in 04_story must drive some Param, otherwise its story point never shows. */
export function checkCurveCoverage(scenario: unknown, story: Pick<StoryPlan, "curves">): CompileError[] {
  const used = new Set<string>();
  collectCurveRefs(scenario, used);
  return story.curves
    .filter((c) => !used.has(c.id))
    .map((c) => ({
      path: `curves.${c.id}`,
      message: `Curve "${c.id}" from 04_story is not used. Reference it as {"curve": "${c.id}"} in the Param it drives (an arrival rate or a bernoulli p in entities/processes).`,
    }));
}

function collectCurveRefs(node: unknown, used: Set<string>, key?: string): void {
  // the scenario's own curve list defines curves, it does not use them
  if (key === "curves") return;
  if (Array.isArray(node)) {
    for (const n of node) collectCurveRefs(n, used);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const rec = node as Record<string, unknown>;
  if (typeof rec.curve === "string") used.add(rec.curve);
  for (const [k, v] of Object.entries(rec)) collectCurveRefs(v, used, k);
}

type ModelTables = Pick<DataModel, "entities" | "flows" | "processes">;

/** Table name -> visibility of every table the model writes (entities, processes, outcomes, snapshots). */
export function modelTables(model: ModelTables): Map<string, "observed" | "ground_truth"> {
  const tables = new Map<string, "observed" | "ground_truth">();
  const add = (name: string, visibility?: "observed" | "ground_truth") => {
    // several processes may write one table; ground_truth on any of them hides it
    if (tables.get(name) !== "ground_truth") tables.set(name, visibility ?? "observed");
  };
  for (const e of model.entities) add(e.name, e.visibility);
  for (const f of model.flows) if (f.snapshot) add(f.snapshot.table, f.snapshot.visibility);
  for (const p of model.processes) {
    if (p.type === "branch") {
      if (p.then) add(p.then.table, p.then.visibility);
      if (p.else) add(p.else.table, p.else.visibility);
    } else add(p.table, p.visibility);
  }
  return tables;
}

export function observedTables(model: ModelTables): string[] {
  return [...modelTables(model)].filter(([, v]) => v === "observed").map(([t]) => t);
}

/**
 * Expectation SQL runs on the sandbox, which holds only observed tables (schema main). A real run
 * built every expectation on a ground_truth table, so all of them failed with "table does not exist".
 */
export function checkExpectationTables(
  expectations: Pick<StoryPlan, "expectations">["expectations"],
  model: ModelTables,
): CompileError[] {
  const tables = modelTables(model);
  const observed = observedTables(model).join(", ");
  const errors: CompileError[] = [];
  for (const [i, e] of expectations.entries()) {
    for (const t of sqlTables(e.sql)) {
      const v = tables.get(t);
      if (v === "observed") continue;
      errors.push({
        path: `expectations.${i}.sql`,
        message:
          v === "ground_truth"
            ? `Expectation "${e.id}" reads "${t}", a ground_truth table that is not in the evidence database. Use only observed tables: ${observed}.`
            : `Expectation "${e.id}" reads unknown table "${t}". Use only observed tables: ${observed}.`,
      });
    }
  }
  return errors;
}

/** Table names after FROM / JOIN, minus CTE names. Good enough for LLM-written evidence SQL. */
export function sqlTables(sql: string): string[] {
  // CTE names: "name AS (" or "name(col, ...) AS ("
  const ctes = new Set(
    [...sql.matchAll(/\b([a-z_][a-z0-9_]*)\s*(?:\([^()]*\))?\s+as\s*\(/gi)].map((m) =>
      (m[1] ?? "").toLowerCase(),
    ),
  );
  const refs = [...sql.matchAll(/\b(?:from|join)\s+(?:main\.)?"?([a-z_][a-z0-9_]*)"?/gi)]
    // EXTRACT(day FROM date), TRIM(x FROM y), SUBSTRING(s FROM 2): FROM inside a function call
    .filter((m) => !/\b(?:extract|trim|substring|overlay|position)\s*\([^()]*$/i.test(sql.slice(0, m.index)))
    .map((m) => (m[1] ?? "").toLowerCase());
  return [...new Set(refs.filter((t) => !ctes.has(t)))];
}
