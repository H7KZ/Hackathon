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
- Make the effect visible: background rates high enough that moving a lever moves the outcome tables.
- If errors are given, return the corrected full object; fix every listed path.
${MODEL_SYNTAX}`;
