/**
 * What the orchestrator needs from the other services. Teammates implement these;
 * `createOrchestrator` gets them injected (fakes in tests, real adapters in server.ts).
 * Each service owns its own loops (atomic principle): the API only starts, observes and cancels.
 */
import type { ArtifactName, CascadeEvent } from "@s2d/schema/artifacts";
import type { Expectation, MetricDiff, TableInfo, TablePreview } from "@s2d/schema/evidence";
import type { RunResult } from "@s2d/schema/run";
import type { Scenario } from "@s2d/schema/scenario";
import type { DatasetEvidence, DetectiveResult, SessionInput } from "@s2d/schema/api";

export interface JobOptions {
  onEvent: (e: CascadeEvent) => void;
  signal: AbortSignal;
}

export interface Ports {
  cascade: {
    /** Runs steps up to and including `until`, reusing artifact files already in `dir`. */
    run(input: SessionInput, opts: JobOptions & { dir: string; until: ArtifactName }): Promise<void>;
    /** Counterfactual: returns a new scenario; the cascade owns its own validation loop. */
    whatIf(question: string, base: Scenario, opts: JobOptions): Promise<Scenario>;
  };
  noiser: {
    /** Runs in a worker thread (`runScenarioInWorker`), so HTTP and SSE stay responsive. */
    run(scenario: Scenario, seed: number): Promise<RunResult>;
  };
  dataer: {
    store(run: RunResult, dbPath: string): Promise<void>;
    /** Runs the scenario's expectations (SQL hypotheses, SPEC rule 7) on a sandbox copy + standard series. */
    evidence(dbPath: string, expectations: Expectation[]): Promise<DatasetEvidence>;
    compare(dbPathA: string, dbPathB: string): Promise<MetricDiff[]>;
    detective(dbPath: string, opts: JobOptions): Promise<DetectiveResult>;
    /** Observed tables with row counts (Data view, dataset totals). Read-only. */
    tables(dbPath: string): Promise<TableInfo[]>;
    /** First `limit` rows of one observed table; rejects unknown and ground-truth tables. */
    preview(dbPath: string, table: string, limit: number): Promise<TablePreview>;
  };
}
