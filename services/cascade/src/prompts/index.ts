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
- Process: arrival {id, table, per: [entity], rate?: Param, schedule?: {everyDays, phase?: "random"}, where?, fields, effects?} | branch {id, source, lag?, cond, then?: {table, fields, effects?}, else?: {table, fields, effects?}} | derive {id, table, source, p: Param, lag?: {min, max}, fields, effects?}. A branch outcome is consumed as source "<branchId>:then" or "<branchId>:else".
- Flow (a stateful level, e.g. stock per store x product): {id, keys: [entity, ...], initial: FieldGen, min?: number, snapshot?: {table, visibility?}}. The snapshot table gets columns date, <key>_id per key, value.
- Effect (how a record moves a flow; without effects a flow never changes): {flow, keys: {<key entity>: Path}, delta: Path (an earlier numeric field, e.g. "self.quantity"), sign: 1 | -1, on?: Path (date field when it applies, e.g. "self.delivered_date")}. E.g. a delivery adds (+1) its quantity to stock, a sale removes (-1) it; a branch on {"kind":"flowGte", "flow":"stock", "keys":{...}, "value":"source.quantity"} decides sale vs. lost sale.
- visibility (on entities, process tables, outcomes, snapshots): "observed" (default, analysts see it) | "ground_truth" (hidden cause, e.g. purchase attempts; NOT readable by expectations). Several processes may write one table only with the same visibility.
Example (different domain, syntax only):
${JSON.stringify(MODEL_EXAMPLE)}`;

/**
 * How to size background numbers so the story shows in the data (story gate, gate.ts). Learned from
 * live runs on 2026-11-27: a lever hidden behind an "if", fixed delivery quantities with large stock,
 * too little cover (weekly waves of lost sales before the story), and a chain-wide revenue target that
 * one of three suppliers cannot move by 10 %. Shared by v1 A5 and causal 4b.
 */
export const CALIBRATION = `- Make the effect visible (the story gate measures it on generated data):
  - The lever must reach every record in its scope: use {"curve": "<id>"} directly, do not hide it behind another condition (e.g. an "if" on a role or category the scoped ids may not have). The curve's scope (e.g. self.supplier_id) filters the records.
  - Replenish with topUp (order-up-to), not fixed quantities. Size it so the BASELINE is calm and the lever bites: the target covers about 2 weeks of demand (stock-outs on fewer than 2% of days before the story; ~1.5 weeks of cover gave weekly waves of lost sales that look like a fake event), and a disruption the lever causes (e.g. a late delivery) lasts clearly longer than that cover, so the shelf empties and purchases turn into lost sales.
  - Start in steady state: initial flow levels about the level the chain settles at, inflow about equal to outflow, so nothing drifts before the story starts.
  - A whole-company outcome moves only by the affected share: if one of three suppliers is late, chain revenue falls by at most about a third of that supplier's lost sales. Give the affected part enough weight (e.g. more of the products, or the best-selling ones, from that supplier) so whole-company expectations reach their threshold.
  - Background rates high enough that the outcome tables have several rows per day.`;

export const A1_COMPANY = `${SHARED_RULES}
Task A1: describe the company and its environment: industry, size, actors around it (suppliers, customers, competitors, ...) and the key business processes relevant to the story.`;

export const A2_MODEL = `${SHARED_RULES}
Task A2: design the data model: entities (with field generators), stateful flows (e.g. stock) and a skeleton of processes (arrival / branch / derive) that can produce the story. Use at least 5 linked tables.
${MODEL_SYNTAX}`;

export const A3_INFLUENCES = `${SHARED_RULES}
Task A3: build the causal influence graph between process parameters and outcomes: edges from -> to, direction, weight 0-1, delay in days, short rationale.
Edge endpoints (from, to) must name parts of 02_model exactly (checked by code):
- "<process_id>" (a whole process), "<process_id>.<param>" (rate, p, cond, or a field of its records / branch outcomes, e.g. "delivery.is_late"),
- "<table>" (a table the model writes, e.g. "lost_sale"), "<entity>.<field>" (e.g. "product.supplier_id"), "<flow_id>" (e.g. "stock").
- The story's lever (the parameter a curve will move) must be a ROOT: it has outgoing edges and no incoming edge. Everything downstream has an incoming edge and is never driven by a curve.`;

/** Rule 3 (AGENTS.md): a real A4 run ramped complaint_prob directly instead of letting it emerge. */
export const LEVERS_ONLY = `Curves only on ROOT CAUSES (levers):
- A curve may move only the parameter where the story starts (e.g. a supplier's late-delivery probability, demand). Usually 1-2 curves.
- Downstream probabilities and rates (complaints, cancellations, churn, switching to a competitor, lost sales, revenue) stay CONSTANT numbers. Their outcome must grow because more source records reach them through the process chain (e.g. more stock-outs -> more lost sales -> more complaints at the same p).
- If the story says "more complaints", that is a consequence to show in the data, not a curve.`;

export const A4_STORY = `${SHARED_RULES}
Task A4: split the story into dated story points, define root curves (only on parameters) and SQL expectations.
${LEVERS_ONLY}
Curves and story points:
- A curve that targets specific entities has "scope": {"field": "self.<field holding the id>", "ids": ["SUP-002"]}, e.g. "self.supplier_id"; never "day". Ids are "<idPrefix>-001".."<idPrefix>-<count>" of 02_model entities. Omit scope for a curve that applies to every record.
- Every story point that a curve segment refers to names the affected entity: "entity": {"name": "<entity>", "ids": [...]}, usually the same ids as the curve scope.
Expectations:
- Each expectation SQL must return columns period ('before'|'after') and value DOUBLE, reading only schema main.
- The SQL may read ONLY the listed observed tables. ground_truth tables (hidden causes, e.g. purchase attempts) are not in the evidence database; build day lists from observed tables (e.g. sales, deliveries).
- Test consequences through the chain with COUNTS or LEVELS (e.g. complaints per week, lost sales per day, revenue per day), not a ratio whose probability is constant (complaints per lost sale stays flat by design).
- Add at least one control that must stay stable (e.g. demand / visits).
- Measure the effect where it happens: if a story point is about specific entities (e.g. supplier SUP-002), scope its curve to them and restrict the expectation SQL to the affected records (e.g. sales of products whose supplier is SUP-002, via product.supplier_id), with a stable control on the unaffected rest. A whole-company total moves only by the affected share (one of three suppliers moves chain revenue by a few percent); use one only with a threshold that share can reach.
Curves: {id, baseline, segments: [{kind: step|ramp|spike|decay, start, end?, to, storyPointId}], scope?: {field: Path, ids: [...]}, clamp?: [min, max]}. scope limits the curve to records whose field has one of the ids (e.g. {"field": "self.supplier_id", "ids": ["SUP-002"]}); entity ids are <idPrefix>-001 .. <idPrefix>-<count> of 02_model.`;

export const A5_DETAIL = `${SHARED_RULES}
Task A5: turn the model skeleton (02_model) into a complete, runnable model: final entities (with counts and field generators), flows and processes with EVERY parameter filled in.
- Curves, story points and expectations are taken from 04_story by code: reference curves only as {"curve": "<id>"} using ids defined there, never invent new curve ids.
- Keep the table names and visibility of 02_model: the expectations in 04_story read those observed tables.
- Use a curve only where 04_story intends that lever; every downstream p / rate is a constant number, so the story effect emerges through the process chain.
- Realize each influence edge of 03_influences as a probability, rate or condition in some process.
- Pick start/end (ISO dates, both days included) so that every story point and curve segment date lies within start..end.
- Keep the count and idPrefix of entities named by 04_story (story point entities, curve scope ids like SUP-002), so those ids exist.
${CALIBRATION}
- If compiler or story gate errors are given, return the corrected full object; fix every listed path. Story gate errors (an expectation measured on generated data, baseline drift) are fixed by changing parameters (counts, rates, initial values, quantities, topUp targets, lags, product-supplier mix), never by renaming tables or columns: the expectations read them.
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
