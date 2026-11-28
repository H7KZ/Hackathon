/**
 * Demo cases (docs/demo-data.md). A case is written by hand in place of the LLM steps
 * (scenarios/demo/<id>.json + scenarios/<id>.json); `pnpm demo:record` runs it through the real
 * orchestrator, engine, DuckDB and evidence and stores the session as a bundle the UI replays offline
 * (services/frontend/public/demo/<id>.json). Additive contract: nothing the cascade sends to an LLM.
 */
import { z } from "zod";
import { CompanySpec, Influences } from "./artifacts";
import { DetectiveReport } from "./detective";
import { DatasetInfo, SessionEvent, SessionInput } from "./api";
import { CurveDef, IsoDate } from "./scenario";

const CaseId = z.string().regex(/^[a-z][a-z0-9_]*$/, { error: "must be a snake_case id" });

/** A what-if answered in advance: the question and the curves it replaces (same ids, same seed). */
export const DemoWhatIf = z.object({
  question: z.string().min(1),
  /** One sentence on what was changed (the what-if agent's `rationale`). */
  rationale: z.string().min(1),
  curves: z.array(CurveDef).min(1),
});
export type DemoWhatIf = z.infer<typeof DemoWhatIf>;

/** Hand-written case: what agents A1–A3, what-if and the detective would have answered. */
export const DemoCase = z.object({
  id: CaseId,
  /** File in scenarios/ (05_scenario); 02_model and 04_story are derived from it. */
  scenario: z.string().regex(/^[a-z0-9_]+\.json$/),
  title: z.string().min(1),
  summary: z.string().min(1),
  tags: z.array(z.string()).max(4),
  input: SessionInput,
  company: CompanySpec,
  influences: Influences,
  whatIfs: z.array(DemoWhatIf).min(1).max(3),
  /** Detective report per dataset id; "dat1" is required. Scored against truth like a real one. */
  detective: z.record(z.string(), DetectiveReport).refine((r) => "dat1" in r, { error: "needs dat1" }),
});
export type DemoCase = z.infer<typeof DemoCase>;

export const DemoStats = z.object({
  tables: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
  start: IsoDate,
  end: IsoDate,
});
export type DemoStats = z.infer<typeof DemoStats>;

/** One phase of the recorded session: the events one command produced, in order. */
const Events = z.array(SessionEvent);

/** A recorded session. `responses` maps GET paths under /sessions/:id (e.g. "/datasets/dat1/evidence"). */
export const DemoBundle = z.object({
  version: z.literal(1),
  id: CaseId,
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  input: SessionInput,
  stats: DemoStats,
  suggestions: z.array(z.string()),
  draft: Events,
  approve: Events,
  whatIfs: z.array(z.object({ question: z.string(), datasetId: z.string(), events: Events })),
  detect: z.array(z.object({ datasetId: z.string(), events: Events })),
  datasets: z.array(DatasetInfo),
  responses: z.record(z.string(), z.unknown()),
  /** Downloadable files per dataset id and format, as paths under the UI's public folder. */
  exports: z.record(z.string(), z.record(z.string(), z.string())),
});
export type DemoBundle = z.infer<typeof DemoBundle>;

export const DemoIndexEntry = DemoBundle.pick({
  id: true,
  title: true,
  summary: true,
  tags: true,
  input: true,
  stats: true,
});
export type DemoIndexEntry = z.infer<typeof DemoIndexEntry>;

/** services/frontend/public/demo/index.json: the picker's list. */
export const DemoIndex = z.object({ cases: z.array(DemoIndexEntry) });
export type DemoIndex = z.infer<typeof DemoIndex>;
