/**
 * DRAFT contract, pending approval by the packages/schema owner (docs/api-orchestrator.md).
 * Once approved, this moves verbatim to @s2d/schema/api (+ CascadeEvent to /artifacts) and this file is deleted.
 * Do not import it outside services/api.
 */
import { z } from "zod";
import { CompileError } from "@s2d/schema/api";
import { ArtifactName } from "@s2d/schema/artifacts";
import { DetectiveReport, DetectiveScore } from "@s2d/schema/detective";
import { ExpectationResult } from "@s2d/schema/evidence";

export const CascadeEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("step.started"), step: ArtifactName }),
  z.object({ type: z.literal("step.done"), step: ArtifactName, cached: z.boolean() }),
  z.object({
    type: z.literal("loop.iteration"),
    step: ArtifactName,
    n: z.number().int().positive(),
    ok: z.boolean(),
    feedback: z.array(z.union([CompileError, z.string()])),
  }),
  z.object({ type: z.literal("log"), message: z.string() }),
]);
export type CascadeEvent = z.infer<typeof CascadeEvent>;

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
  id: z.string().regex(/^d[0-9]+$/),
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

export const SessionCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approve") }),
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
  series: z.array(
    z.object({ table: z.string(), points: z.array(z.object({ day: z.iso.date(), value: z.number() })) }),
  ),
});
export type DatasetEvidence = z.infer<typeof DatasetEvidence>;

export const DetectiveResult = z.object({ report: DetectiveReport, score: DetectiveScore });
export type DetectiveResult = z.infer<typeof DetectiveResult>;
