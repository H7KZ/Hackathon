/**
 * Cascade artifacts 01–04 (SPEC §3.A). Step 05 is the Scenario itself.
 * Each artifact is an editable JSON file in runs/<runId>/NN_name.json.
 */
import { z } from "zod";
import { Expectation } from "./evidence";
import { CurveDef, EntityDef, FlowDef, Ident, ProcessDef, Scenario, StoryPoint } from "./scenario";

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

/** Order matters: saving an artifact invalidates every later one (SPEC §2 rule 9). */
export const ArtifactName = z.enum([
  "01_company",
  "02_model",
  "03_influences",
  "03a_causal_map",
  "03b_processes",
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
  "04_story": StoryPlan,
  "05_scenario": Scenario,
};
