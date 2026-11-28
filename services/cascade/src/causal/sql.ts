/** 04b_expectations (D3): code derives the hypotheses, the agent writes only SQL; code builds 04_story. */
import type { Llm } from "@s2d/llm";
import type { CompileError } from "@s2d/schema/api";
import {
  ExpectationQueries,
  type CausalMap,
  type ExpectationsPlan,
  type Hypothesis,
  type ProcessesPlan,
  type StoryOverlay,
  type StoryPlan,
} from "@s2d/schema/artifacts";
import { checkExpectationTables, observedTables, sqlTables } from "../checks";
import { EXPECTATION_SQL } from "../prompts/causal";
import { userPrompt } from "../prompts/index";
import { buildCurves } from "./curves";

export function checkQueries(
  hypotheses: readonly Hypothesis[],
  queries: ExpectationQueries["queries"],
  plan: ProcessesPlan,
): CompileError[] {
  const errors: CompileError[] = [];
  const ids = hypotheses.map((h) => h.id);
  for (const h of hypotheses)
    if (!queries.some((q) => q.hypothesisId === h.id))
      errors.push({
        path: "queries",
        message: `No query for hypothesis "${h.id}". Write one query per hypothesis.`,
      });
  queries.forEach((q, i) => {
    const h = hypotheses.find((x) => x.id === q.hypothesisId);
    if (!h) {
      errors.push({
        path: `queries.${i}.hypothesisId`,
        message: `Unknown hypothesis "${q.hypothesisId}". Hypotheses: ${ids.join(", ")}.`,
      });
      return;
    }
    if (queries.findIndex((x) => x.hypothesisId === q.hypothesisId) !== i)
      errors.push({ path: `queries.${i}`, message: `Second query for "${q.hypothesisId}"; keep one.` });
    if (!/\bperiod\b/i.test(q.sql) || !/\bvalue\b/i.test(q.sql))
      errors.push({
        path: `queries.${i}.sql`,
        message: "SQL must return columns `period` ('before'|'after') and `value` DOUBLE.",
      });
    if (!sqlTables(q.sql).includes(h.table))
      errors.push({
        path: `queries.${i}.sql`,
        message: `Hypothesis "${h.id}" measures table "${h.table}", but the SQL does not read it.`,
      });
  });
  const asExpectations = queries.map((q) => ({ id: q.hypothesisId, sql: q.sql }));
  for (const e of checkExpectationTables(asExpectations, plan))
    errors.push({ path: e.path.replace(/^expectations/, "queries"), message: e.message });
  return errors;
}

export function a4bExpectations(
  llm: Llm,
  a: { hypotheses: Hypothesis[]; plan: ProcessesPlan; overlay: StoryOverlay },
): Promise<ExpectationQueries> {
  return llm.object({
    schemaName: "04b_expectations",
    schema: ExpectationQueries,
    instructions: EXPECTATION_SQL,
    prompt: userPrompt({
      Hypotheses: a.hypotheses.map(({ path: _path, ...h }) => h),
      "Observed tables (schema main) and their columns": observedColumns(a.plan),
      "Entities (id format <idPrefix>-001)": a.plan.entities.map((e) => ({
        name: e.name,
        idPrefix: e.idPrefix,
        fields: Object.keys(e.fields),
      })),
    }),
  });
}

/** Column names per observed table, so the SQL agent does not guess them. */
export function observedColumns(plan: ProcessesPlan): Record<string, string[]> {
  const cols: Record<string, Set<string>> = {};
  const add = (table: string, names: string[]) => {
    cols[table] ??= new Set();
    for (const n of names) cols[table].add(n);
  };
  for (const e of plan.entities) add(e.name, Object.keys(e.fields));
  for (const f of plan.flows)
    if (f.snapshot) add(f.snapshot.table, ["date", ...f.keys.map((k) => `${k}_id`), "value"]);
  for (const p of plan.processes) {
    if (p.type === "branch") {
      if (p.then) add(p.then.table, Object.keys(p.then.fields));
      if (p.else) add(p.else.table, Object.keys(p.else.fields));
    } else add(p.table, Object.keys(p.fields));
  }
  const observed = new Set(observedTables(plan));
  return Object.fromEntries(
    Object.entries(cols)
      .filter(([t]) => observed.has(t))
      .map(([t, c]) => [t, [...c]]),
  );
}

/** 04_story of the causal design, built by code (the UI timeline edits it like the v1 artifact). */
export function causalStory(
  map: CausalMap,
  overlay: StoryOverlay,
  exp: ExpectationsPlan,
  plan?: Pick<ProcessesPlan, "processes">,
): StoryPlan {
  return {
    storyPoints: overlay.storyPoints,
    curves: buildCurves(map, overlay, plan),
    expectations: exp.hypotheses.flatMap((h) => {
      const q = exp.queries.find((x) => x.hypothesisId === h.id);
      return q
        ? [
            {
              id: h.id,
              storyPointId: h.storyPointId,
              description: h.description,
              sql: q.sql,
              check: { kind: h.direction, minRelChange: h.minRelChange },
            },
          ]
        : [];
    }),
  };
}
