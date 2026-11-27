/**
 * Prompts for the cascade (SPEC §3.A). Instructions in English (model quality), data values in Czech.
 * Changing a prompt changes the cache key -> re-record the demo cache (`pnpm cascade` online).
 */
import { MODEL_EXAMPLE } from "./example";

export const SHARED_RULES = `You design configuration for a deterministic synthetic-data engine.
Rules:
- You NEVER produce data rows or code. Only the JSON object requested by the schema.
- The story must emerge from a causal process chain: change PARAMETERS (probabilities, rates) over time, never outcome metrics.
- Every derived record must reference its source entity (foreign keys).
- Human-readable values (names, categories, descriptions) are in Czech (cs-CZ). Identifiers are English snake_case.`;

/** Syntax of the model JSON. Every rule here is one the zod schema / compiler rejected in a real run. */
export const MODEL_SYNTAX = `Model JSON syntax (follow exactly, the output is validated):
- Path (a string) is ONLY one of: "day" | "self.<field>" (an EARLIER field of the same record) | "source.<field>" (a field of the source record; branch/derive only) | "key.<entity>" (the arrival's own entity id; only in an arrival with "per"). Never a bare field name like "store_id".
- Param is ONLY a number or {"curve": "<curveId>", "scale"?: number}. Never a string, never another object. In 02_model use plain numbers unless a curve is meant.
- Field generators always have "gen": id | ref {path} | lookup {entity, key: Path, field} | pick {entity, weightBy?, where?} | const {value} | normal {mean, sd, min?, max?, round?} | poisson {lambda} | uniformInt {min, max} | bernoulli {p} | categorical {values: string[], weights?} | dateOffset {base: Path, days: Path} | fake {kind: personName|companyName|city|email|productName} | if {cond, then: FieldGen, else: FieldGen} | topUp {flow, keys, target}.
- Entity foreign keys use {"gen":"pick","entity":"<entity>"} (entity rows have no source/key). Record foreign keys use ref with "key.<entity>" or "source.<field>", or lookup.
- dateOffset.days is a Path to an earlier numeric field, so generate the number first (e.g. "delay_days") and use "self.delay_days".
- categorical values are strings (e.g. ["1","2","3"], not [1,2,3]).
- Cond (has "kind"): fieldEq {path, value} | fieldGt {path, value: number} | flowGt/flowGte {flow, keys: {<key>: Path}, value: number | Path} | bernoulli {p: Param} | and/or {conds} | not {cond}.
- Entity: name snake_case, count positive integer, idPrefix uppercase letters (e.g. "STO"), fields include "id": {"gen":"id"}.
- Process: arrival {id, table, per: [entity], rate?: Param, schedule?: {everyDays}, fields} | branch {id, source, cond, then?: {table, fields}, else?: {table, fields}} | derive {id, table, source, p: Param, lag?: {min, max}, fields}. A branch outcome is consumed as source "<branchId>:then" or "<branchId>:else".
Example (different domain, syntax only):
${JSON.stringify(MODEL_EXAMPLE)}`;

export const A1_COMPANY = `${SHARED_RULES}
Task A1: describe the company and its environment: industry, size, actors around it (suppliers, customers, competitors, ...) and the key business processes relevant to the story.`;

export const A2_MODEL = `${SHARED_RULES}
Task A2: design the data model: entities (with field generators), stateful flows (e.g. stock) and a skeleton of processes (arrival / branch / derive) that can produce the story. Use at least 5 linked tables.
${MODEL_SYNTAX}`;

export const A3_INFLUENCES = `${SHARED_RULES}
Task A3: build the causal influence graph between process parameters and outcomes: edges from -> to, direction, weight 0-1, delay in days, short rationale.`;

/** Rule 3 (AGENTS.md): a real A4 run ramped complaint_prob directly instead of letting it emerge. */
export const LEVERS_ONLY = `Curves only on ROOT CAUSES (levers):
- A curve may move only the parameter where the story starts (e.g. a supplier's late-delivery probability, demand). Usually 1-2 curves.
- Downstream probabilities and rates (complaints, cancellations, churn, switching to a competitor, lost sales, revenue) stay CONSTANT numbers. Their outcome must grow because more source records reach them through the process chain (e.g. more stock-outs -> more lost sales -> more complaints at the same p).
- If the story says "more complaints", that is a consequence to show in the data, not a curve.`;

export const A4_STORY = `${SHARED_RULES}
Task A4: split the story into dated story points, define root curves (only on parameters) and SQL expectations.
${LEVERS_ONLY}
Expectations:
- Each expectation SQL must return columns period ('before'|'after') and value DOUBLE, reading only schema main.
- The SQL may read ONLY the listed observed tables. ground_truth tables (hidden causes, e.g. purchase attempts) are not in the evidence database; build day lists from observed tables (e.g. sales, deliveries).
- Test consequences through the chain with COUNTS or LEVELS (e.g. complaints per week, lost sales per day, revenue per day), not a ratio whose probability is constant (complaints per lost sale stays flat by design).
- Add at least one control that must stay stable (e.g. demand / visits).`;

export const A5_DETAIL = `${SHARED_RULES}
Task A5: turn the model skeleton (02_model) into a complete, runnable model: final entities (with counts and field generators), flows and processes with EVERY parameter filled in.
- Curves, story points and expectations are taken from 04_story by code: reference curves only as {"curve": "<id>"} using ids defined there, never invent new curve ids.
- Keep the table names and visibility of 02_model: the expectations in 04_story read those observed tables.
- Use a curve only where 04_story intends that lever; every downstream p / rate is a constant number, so the story effect emerges through the process chain.
- Realize each influence edge of 03_influences as a probability, rate or condition in some process.
- Pick start/end (ISO dates) so that every story point and curve segment lies inside [start, end).
- Make the expected effect visible: background rates high enough that the story points move the outcome tables.
- If compiler errors are given, return the corrected full object; fix every listed path.
${MODEL_SYNTAX}`;

export const WHAT_IF = `${SHARED_RULES}
Task: answer a counterfactual question ("what if ...") about an existing scenario by changing PARAMETERS ONLY.
- Return the complete list of curves (copy unchanged ones). You may change baselines, segments (dates, values, kinds) and clamps, and add a curve only if a patched Param references it.
- Patch existing Param values (numbers or {"curve": id}) by JSON pointer, e.g. /processes/2/rate. Never add or remove entities, fields, flows, processes or references; never change meta or the seed.
- Keep everything not affected by the question identical, so the difference against the base scenario is only the counterfactual.
- If errors are given, return the corrected full object.`;

export function userPrompt(sections: Record<string, unknown>): string {
  return Object.entries(sections)
    .map(([k, v]) => `## ${k}\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`)
    .join("\n\n");
}
