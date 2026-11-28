/**
 * Expectations = SQL hypotheses verifiable only from data (SPEC §3.D).
 * Lives outside scenario.ts so evidence/ can import it without seeing the scenario (SPEC §2 rule 7).
 */
import { z } from "zod";

export const ExpectationCheck = z.object({
  /** stable = |relative change| < minRelChange (e.g. "demand did not drop"). */
  kind: z.enum(["increase", "decrease", "stable"]),
  minRelChange: z.number().nonnegative(),
});
export type ExpectationCheck = z.infer<typeof ExpectationCheck>;

export const Expectation = z.object({
  id: z.string(),
  storyPointId: z.string(),
  description: z.string(),
  /** Must return rows (period TEXT 'before'|'after', value DOUBLE). */
  sql: z.string().min(1),
  check: ExpectationCheck,
});
export type Expectation = z.infer<typeof Expectation>;

export const ExpectationResult = z.object({
  id: z.string(),
  pass: z.boolean(),
  before: z.number().nullable(),
  after: z.number().nullable(),
  relChange: z.number().nullable(),
  error: z.string().optional(),
});
export type ExpectationResult = z.infer<typeof ExpectationResult>;

/** An observed table (schema `main`) of a stored run: what the "Data" view lists. */
export const TableInfo = z.object({
  name: z.string(),
  rows: z.number().int().nonnegative(),
  columns: z.array(z.object({ name: z.string(), type: z.string() })),
});
export type TableInfo = z.infer<typeof TableInfo>;

/** First rows of one observed table (JSON-safe values: DATE as ISO string, BIGINT as number). */
export const TablePreview = TableInfo.extend({
  rowsShown: z.array(z.record(z.string(), z.unknown())),
});
export type TablePreview = z.infer<typeof TablePreview>;

/** One metric compared between run A and run B (SPEC §3.F). */
export const MetricDiff = z.object({
  metric: z.string(),
  a: z.number().nullable(),
  b: z.number().nullable(),
  delta: z.number().nullable(),
  relChange: z.number().nullable(),
});
export type MetricDiff = z.infer<typeof MetricDiff>;
