/**
 * Cascade artifacts 01–04 (SPEC §3.A). Step 05 is the Scenario itself.
 * Each artifact is an editable JSON file in runs/<runId>/NN_name.json.
 */
import { z } from "zod";
import { Expectation, ExpectationCheck } from "./evidence";
import { CurveDef, EntityDef, FlowDef, Ident, IsoDate, ProcessDef, Scenario, StoryPoint } from "./scenario";

export const CompanySpec = z.object({
  industry: z.string(),
  size: z.string().describe("e.g. '5 prodejen, 40 zaměstnanců'"),
  actors: z.array(
    z.object({
      kind: z.enum(["supplier", "customer", "competitor", "employee", "partner", "other"]),
      name: z.string(),
      description: z.string(),
    }),
  ),
  keyProcesses: z.array(z.string()).min(1),
});
export type CompanySpec = z.infer<typeof CompanySpec>;

export const DataModel = z.object({
  entities: z.array(EntityDef).min(1),
  flows: z.array(FlowDef),
  processes: z.array(ProcessDef).min(1).describe("skeleton; parameters may be placeholders"),
});
export type DataModel = z.infer<typeof DataModel>;

export const InfluenceEdge = z.object({
  from: z.string(),
  to: z.string(),
  direction: z.enum(["positive", "negative"]),
  weight: z.number().min(0).max(1),
  delayDays: z.number().int().nonnegative(),
  rationale: z.string(),
});
export const Influences = z.object({ edges: z.array(InfluenceEdge).min(1) });
export type Influences = z.infer<typeof Influences>;

export const StoryPlan = z.object({
  storyPoints: z.array(StoryPoint).min(1),
  curves: z.array(CurveDef).min(1),
  expectations: z.array(Expectation).min(1),
});
export type StoryPlan = z.infer<typeof StoryPlan>;

// ---------- causal design (docs/cascade-design.md D1/D4), CascadeOptions.design = "causal" ----------

/**
 * lever = parameter the story moves (only levers get curves); event = records of a table;
 * state = a flow level; attribute = a field of records/entities; branch = a decision on state.
 */
export const CausalNodeKind = z.enum(["lever", "event", "state", "attribute", "branch"]);
export const CausalNode = z.object({
  id: Ident,
  kind: CausalNodeKind,
  description: z.string(),
  /** event: table its records are written to; state: snapshot table of the flow. Metrics for expectations. */
  table: Ident.optional(),
  /** lever only: value before the story (e.g. late probability 0.05, demand multiplier 1). */
  baseline: z.number().optional(),
});
export type CausalNode = z.infer<typeof CausalNode>;

/** D1: probabilistic -> derive/branch/bernoulli p; mechanical -> flow effects/conditions; attribute -> lookup/if/pick. */
export const CausalEdgeType = z.enum(["probabilistic", "mechanical", "attribute"]);
export const CausalEdge = z.object({
  id: Ident,
  from: Ident,
  to: Ident,
  type: CausalEdgeType,
  sign: z.enum(["positive", "negative"]),
  /** probabilistic only: baseline probability of `to` given `from`. */
  p: z.number().min(0).max(1).optional(),
  rationale: z.string(),
});
export type CausalEdge = z.infer<typeof CausalEdge>;

/** 03a_causal_map (agent 4a): the conceptual graph only, no scenario syntax. */
export const CausalMap = z.object({
  nodes: z.array(CausalNode).min(2),
  edges: z.array(CausalEdge).min(1),
});
export type CausalMap = z.infer<typeof CausalMap>;

/** 03b_processes (agent 4b): the map realized as scenario parts; `trace` = edgeId -> JSON pointer (RFC 6901). */
export const ProcessesPlan = z.object({
  entities: z.array(EntityDef).min(1),
  flows: z.array(FlowDef),
  processes: z.array(ProcessDef).min(1),
  trace: z.record(z.string(), z.string().regex(/^\//, { error: 'JSON pointer must start with "/"' })),
});
export type ProcessesPlan = z.infer<typeof ProcessesPlan>;

/** One lever's value during one period; the period's dates are its story point's start..end. */
export const LeverValue = z.object({ storyPointId: z.string(), value: z.number() });

/** One row of the lever x period matrix (D2). Code turns it into a CurveDef with id = lever. */
export const LeverRow = z.object({
  lever: Ident,
  /** Limits the lever to records whose field has one of the ids (e.g. self.supplier_id in [SUP-002]). */
  scope: CurveDef.shape.scope,
  values: z.array(LeverValue).min(1),
});
export type LeverRow = z.infer<typeof LeverRow>;

/** 04a_overlay (agents 5–6): story points and lever values per period. No curve dates or shapes. */
export const StoryOverlay = z.object({
  name: z.string(),
  /** Scenario date range, both days included. */
  start: IsoDate,
  end: IsoDate,
  storyPoints: z.array(StoryPoint).min(1),
  levers: z.array(LeverRow).min(1),
});
export type StoryOverlay = z.infer<typeof StoryOverlay>;

/** Half-open date window [start, end). */
export const DateWindow = z.object({ start: IsoDate, end: IsoDate });

/**
 * D3: an expectation derived by code from the overlay (which lever moves, which way) and the map
 * (edge signs along the paths). Off-path metrics and out-of-scope records are `stable` controls.
 */
export const Hypothesis = z.object({
  id: z.string(),
  storyPointId: z.string(),
  /** Metric node of 03a_causal_map and the observed table it is counted in. */
  node: Ident,
  table: Ident,
  direction: ExpectationCheck.shape.kind,
  minRelChange: z.number().nonnegative(),
  /** Restrict to (only) or leave out (exclude) records related to these entity ids, e.g. supplier SUP-002. */
  focus: z
    .object({ entity: z.string(), ids: z.array(z.string()).min(1), mode: z.enum(["only", "exclude"]) })
    .optional(),
  before: DateWindow,
  after: DateWindow,
  /** Edge ids of the strongest path from the moved lever; empty for off-path controls. */
  path: z.array(z.string()),
  description: z.string(),
});
export type Hypothesis = z.infer<typeof Hypothesis>;

export const ExpectationQuery = z.object({ hypothesisId: z.string(), sql: z.string().min(1) });
/** What the 04b agent returns: only SQL, one query per hypothesis. */
export const ExpectationQueries = z.object({ queries: z.array(ExpectationQuery).min(1) });
export type ExpectationQueries = z.infer<typeof ExpectationQueries>;

/** 04b_expectations: hypotheses (code) + their SQL (agent). Code then writes 04_story. */
export const ExpectationsPlan = z.object({
  hypotheses: z.array(Hypothesis).min(1),
  queries: z.array(ExpectationQuery),
});
export type ExpectationsPlan = z.infer<typeof ExpectationsPlan>;

/** Order matters: saving an artifact invalidates every later one (SPEC §2 rule 9). */
export const ArtifactName = z.enum([
  "01_company",
  "02_model",
  "03_influences",
  "03a_causal_map",
  "03b_processes",
  "04a_overlay",
  "04b_expectations",
  "04_story",
  "05_scenario",
]);
export type ArtifactName = z.infer<typeof ArtifactName>;

/** Schema of every artifact file, for loading and validating hand edits. */
export const ArtifactSchemas: Record<ArtifactName, z.ZodType> = {
  "01_company": CompanySpec,
  "02_model": DataModel,
  "03_influences": Influences,
  "03a_causal_map": CausalMap,
  "03b_processes": ProcessesPlan,
  "04a_overlay": StoryOverlay,
  "04b_expectations": ExpectationsPlan,
  "04_story": StoryPlan,
  "05_scenario": Scenario,
};
