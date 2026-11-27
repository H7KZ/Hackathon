/**
 * Prompts of the causal design (docs/cascade-design.md D1–D4, CascadeOptions.design = "causal").
 * Changing a prompt changes the cache key -> re-record the demo cache.
 */
import { MODEL_SYNTAX, SHARED_RULES } from "./index";

export const CAUSAL_MAP = `${SHARED_RULES}
Task 4a: draw the causal map of the story as a conceptual graph (no scenario syntax yet).
Nodes {id (snake_case), kind, description, table?, baseline?}:
- lever: the parameter the story moves over time (e.g. late_prob of one supplier, demand). Levers are ROOTS: no incoming edge. baseline = its value before the story (a probability 0-1, or a rate multiplier like 1).
- event: something that happens and leaves records (an order, a late delivery, a lost sale, a complaint). table = the table of 02_model its records go to.
- state: a level that accumulates (stock). table = its snapshot table if 02_model has one.
- attribute: a property that routes the effect (product -> supplier).
- branch: a decision on a state (enough stock? -> sale, else lost sale).
Edges {id (snake_case), from, to, type, sign, p?, rationale}:
- type probabilistic: "from" makes "to" happen with probability p (give the baseline p), e.g. lost_sale -> complaint, p 0.25.
- type mechanical: records move a level or a level decides a branch, e.g. delivery -> stock, stock -> fulfil.
- type attribute: an attribute routes records, e.g. product_supplier -> late_delivery.
- sign positive = more "from" gives more "to"; negative = more "from" gives less "to" (late deliveries -> less stock).
Rules: the graph is acyclic, every lever and branch has an outgoing edge, the outcome the story talks about (revenue, complaints) is reached through a path from a lever. Give event/state nodes the table names of 02_model, so expectations can count them.`;

export const PROCESSES = `${SHARED_RULES}
Task 4b: realize the causal map (03a_causal_map) as a complete, runnable model: entities, flows and processes with EVERY parameter filled in, plus "trace".
Mapping (checked by code):
- event without an input event, driven by a lever -> arrival with "rate": {"curve": "<lever id>"} (or a constant rate when no lever drives it).
- probabilistic edge event -> event -> derive with "p" (the edge's baseline p) and lag, or a bernoulli field / bernoulli cond.
- branch with a condition on a state -> branch with flowGte, outcomes then/else.
- mechanical edge event -> state -> an effect (+1/-1) on the flow.
- lever -> attribute -> a bernoulli/normal field with {"curve": "<lever id>"}.
- attribute edge (product -> supplier) -> lookup / if / pick in fields.
- trace: {"<edge id>": "<JSON pointer into this object>"} for EVERY edge, pointing at what realizes it, e.g. "/processes/3/p", "/processes/2" (a whole branch), "/processes/0/fields/is_late", "/processes/0/effects/0".
- Curves are referenced only by lever ids, {"curve": "<lever id>"}, and only where an edge leaves that lever. Every other p / rate is a constant number: the story effect must emerge through the chain. Code builds the curves later.
- Every branch/derive process realizes some edge. Event/state tables named in the map must exist.
- Keep entity names, counts and idPrefixes of 02_model where possible; use at least 5 linked tables.
- Make the effect visible (a live run produced a valid model where the lever changed nothing):
  - The lever must reach every record in its scope: use {"curve": "<lever id>"} directly, do not hide it behind another condition (e.g. an "if" on a role or category the scoped ids may not have). The curve's scope (e.g. self.supplier_id) filters the records.
  - Keep levels tight so a disruption bites: replenish with topUp (order-up-to target about 1-2 weeks of demand), not fixed quantities, so a late delivery empties the shelf and turns purchases into lost sales.
  - Start in steady state: initial flow levels about the level the chain settles at, inflow about equal to outflow, so nothing drifts before the story starts.
  - Background rates high enough that the outcome tables have several rows per day.
- If errors are given, return the corrected full object; fix every listed path. Errors from the story gate (expectations measured on generated data, baseline drift) are fixed by changing parameters (rates, counts, initial values, quantities, topUp targets, lags), never by renaming tables or columns: the SQL reads them.
${MODEL_SYNTAX}`;

export const OVERLAY = `${SHARED_RULES}
Task 5: lay the story over the causal map as dated story points and lever values per period. Code builds the curves from your values; you never write curve dates or shapes.
- name: short Czech title of the dataset. start, end: ISO dates of the whole dataset (both days included); leave at least 8 weeks before the first story point so "before" is visible, and a few weeks after the last one.
- storyPoints: {id, phase, title, description (Czech), entity?: {name, ids}, start, end?}. Entity ids are <idPrefix>-001 .. <idPrefix>-<count> of 03b_processes.
- levers: one row per lever you move: {lever: <lever id of 03a_causal_map>, scope?: {field: Path, ids: [...]}, values: [{storyPointId, value}]}.
  - A value holds from its story point's start until its end. After an end the lever returns to its baseline; a last story point without end keeps the value to the end of the dataset.
  - The periods of one lever must be contiguous: the end of one story point = the start of the next one in that row.
  - scope limits the lever to records whose field has one of the ids (e.g. {"field": "self.supplier_id", "ids": ["SUP-002"]}); the field must exist on the record where the lever's curve is used.
- ONLY levers get values. Outcomes (sales, complaints, lost sales) are never in the matrix: they must emerge from the chain.
- If errors are given, return the corrected full object.`;

export const EXPECTATION_SQL = `${SHARED_RULES}
Task: write one DuckDB SQL query per hypothesis. The hypotheses (metric, direction, period) are fixed by code; you only measure them.
Each query:
- returns exactly two rows with columns period ('before' | 'after') and value DOUBLE;
- reads ONLY the listed observed tables of schema main (never truth.*), and reads the hypothesis' "table";
- "before" covers dates in [before.start, before.end), "after" covers [after.start, after.end) (end exclusive);
- measures an event as a daily rate (COUNT(*) / number of days in the window), so windows of different length compare fairly;
- measures a state (a flow snapshot table) as AVAILABILITY: the share of snapshot rows with value > 0, AVG(CASE WHEN value > 0 THEN 1 ELSE 0 END). Not the average level: late deliveries cause stock-outs and overshoots at once, so the level can rise while availability falls;
- respects "focus": "only" keeps just records related to the listed entity ids (join through foreign keys, e.g. sale -> product.supplier_id), "exclude" keeps all other records;
- for an event recorded as a flag or field of the table (e.g. a late delivery in table delivery), count the records where it happened.
Return {"queries": [{"hypothesisId", "sql"}]} with one query for EVERY hypothesis id. If errors are given, return the corrected full object.`;
