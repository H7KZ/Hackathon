/** Engine output — the hand-off from @s2d/noiser (pure) to @s2d/dataer (persistence). */
import { z } from "zod";
import { Ident, StoryPoint } from "./scenario";

export const Cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type Cell = z.infer<typeof Cell>;
export type Row = Record<string, Cell>;

export const GeneratedTable = z.object({
  name: Ident,
  visibility: z.enum(["observed", "ground_truth"]),
  /** Column names in order; required so an empty table still has its schema. */
  columns: z.array(z.string()).optional(),
  rows: z.array(z.record(z.string(), Cell)),
});
export type GeneratedTable = z.infer<typeof GeneratedTable>;

export const RunMeta = z.object({
  scenarioId: z.string(),
  seed: z.number().int(),
  scenarioHash: z.string(),
  engineVersion: z.string(),
});
export type RunMeta = z.infer<typeof RunMeta>;

export const RunResult = z.object({
  tables: z.array(GeneratedTable),
  meta: RunMeta,
  /** Written to truth.story_points; used to score the detective. */
  storyPoints: z.array(StoryPoint),
});
export type RunResult = z.infer<typeof RunResult>;
