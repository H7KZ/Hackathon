/**
 * Cascade artifacts 01–04 (SPEC §3.A). Step 05 is the Scenario itself.
 * Each artifact is an editable JSON file in runs/<runId>/NN_name.json.
 */
import { z } from "zod";
import { Expectation } from "./evidence";
import { CurveDef, EntityDef, FlowDef, ProcessDef, StoryPoint } from "./scenario";

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

export const ArtifactName = z.enum(["01_company", "02_model", "03_influences", "04_story", "05_scenario"]);
export type ArtifactName = z.infer<typeof ArtifactName>;
