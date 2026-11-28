/** REST API request/response shapes shared by services/api and services/frontend. */
import { z } from "zod";
import { ArtifactName, CascadeEvent } from "./artifacts";
import { DetectiveReport, DetectiveScore } from "./detective";
import { CompileError } from "./errors";
import { ExpectationResult } from "./evidence";
import { IsoDate } from "./scenario";

export { CompileError } from "./errors";

export const Health = z.object({ status: z.literal("ok"), version: z.string() });
export type Health = z.infer<typeof Health>;

export const ValidateResponse = z.object({ ok: z.boolean(), errors: z.array(CompileError) });
export type ValidateResponse = z.infer<typeof ValidateResponse>;

export const GenerateRequest = z.object({
  scenarioId: z.string(),
  seed: z.number().int().optional(),
  scale: z.number().positive().optional(),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;

// --- Session contract (docs/api-orchestrator.md) ---

export const SessionStatus = z.enum([
  "drafting",
  "refining",
  "awaiting_refinement",
  "generating",
  "detecting",
  "ready",
  "failed",
  "cancelled",
  "interrupted",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const SessionInput = z.object({ story: z.string().min(1), company: z.string().min(1) });
export type SessionInput = z.infer<typeof SessionInput>;

export const DatasetInfo = z.object({
  /** "dat1", "dat2", … ("d1" … in sessions created before 2026-11-28). */
  id: z.string().regex(/^(dat|d)[0-9]+$/),
  parent: z.string().nullable(),
  seed: z.number().int(),
  origin: z.enum(["approve", "what_if", "edit_scenario"]),
  question: z.string().optional(),
});
export type DatasetInfo = z.infer<typeof DatasetInfo>;

export const SessionState = z.object({
  id: z.string(),
  status: SessionStatus,
  input: SessionInput,
  datasets: z.array(DatasetInfo),
  error: z.string().optional(),
});
export type SessionState = z.infer<typeof SessionState>;

/** UI story-editor settings applied to 05_scenario before the engine runs (services/api/src/settings.ts). */
export const GenerationSettings = z.object({
  seed: z.number().int().optional(),
  /** meta.scale; 1 = as designed (flow levels do not scale, docs/decisions.md). */
  scale: z.number().min(0.1).max(5).optional(),
  /** Percent of value cells left empty / rows duplicated in observed process tables; hourJitter adds `ts`. */
  noise: z
    .object({
      missing: z.number().min(0).max(50),
      duplicates: z.number().min(0).max(50),
      hourJitter: z.boolean(),
    })
    .optional(),
  /** Ids of the expectations to keep; omitted = all. */
  expectations: z.array(z.string()).optional(),
  /**
   * meta.start / meta.end chosen by the user; omitted = the cascade's period. Must contain every
   * curve segment and story point (the API rejects it otherwise).
   */
  period: z
    .object({ start: IsoDate, end: IsoDate })
    .refine((p) => p.start < p.end, { error: "period.start must be before period.end" })
    .optional(),
});
export type GenerationSettings = z.infer<typeof GenerationSettings>;

export const SessionCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approve"), settings: GenerationSettings.optional() }),
  z.object({ type: z.literal("edit_artifact"), name: ArtifactName, value: z.unknown() }),
  z.object({ type: z.literal("what_if"), question: z.string().min(1), from: z.string() }),
  z.object({ type: z.literal("edit_scenario"), from: z.string(), scenario: z.unknown() }),
  z.object({ type: z.literal("detect"), datasetId: z.string() }),
  z.object({ type: z.literal("cancel") }),
  z.object({ type: z.literal("resume") }),
]);
export type SessionCommand = z.infer<typeof SessionCommand>;

const Seq = { seq: z.number().int().positive() };
export const SessionEvent = z.discriminatedUnion("type", [
  z.object({ ...Seq, type: z.literal("status"), status: SessionStatus }),
  z.object({ ...Seq, type: z.literal("cascade"), event: CascadeEvent }),
  z.object({ ...Seq, type: z.literal("dataset.ready"), datasetId: z.string() }),
  z.object({ ...Seq, type: z.literal("detective.done"), datasetId: z.string() }),
  z.object({
    ...Seq,
    type: z.literal("error"),
    message: z.string(),
    errors: z.array(CompileError).optional(),
  }),
]);
export type SessionEvent = z.infer<typeof SessionEvent>;

export const DatasetEvidence = z.object({
  expectations: z.array(ExpectationResult),
  /**
   * Daily series per observed table and DATE/TIMESTAMP column: `metric` "rows" = row count per day,
   * "<column>.sum" = per-day sum of a numeric non-key column (snapshot tables move only in their values).
   */
  series: z.array(
    z.object({
      table: z.string(),
      dateColumn: z.string(),
      metric: z.string(),
      points: z.array(z.object({ day: z.iso.date(), value: z.number() })),
    }),
  ),
});
export type DatasetEvidence = z.infer<typeof DatasetEvidence>;

export const DetectiveResult = z.object({ report: DetectiveReport, score: DetectiveScore });
export type DetectiveResult = z.infer<typeof DetectiveResult>;
