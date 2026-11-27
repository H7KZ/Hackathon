/** Blind detective output (SPEC §3.E). Must not reference the scenario. */
import { z } from "zod";

export const Finding = z.object({
  claim: z.string(),
  entities: z.array(z.string()),
  start: z.iso.date(),
  end: z.iso.date().optional(),
  supportingSql: z.string(),
});
export type Finding = z.infer<typeof Finding>;

export const DetectiveReport = z.object({
  narrative: z.string(),
  findings: z.array(Finding),
});
export type DetectiveReport = z.infer<typeof DetectiveReport>;

/** Minimal view of a story point used for scoring (comes from truth.story_points in DuckDB). */
export const TruthPoint = z.object({
  id: z.string(),
  entityIds: z.array(z.string()),
  start: z.iso.date(),
});
export type TruthPoint = z.infer<typeof TruthPoint>;

export const DetectiveScore = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  matched: z.array(z.object({ storyPointId: z.string(), findingIndex: z.number().int() })),
});
export type DetectiveScore = z.infer<typeof DetectiveScore>;
