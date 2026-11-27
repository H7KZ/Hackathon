/**
 * What the orchestrator needs from the other services. Teammates implement these;
 * `createOrchestrator` gets them injected (fakes in tests, real adapters in server.ts).
 * Each service owns its own loops (atomic principle): the API only starts, observes and cancels.
 */
import type { ArtifactName } from "@s2d/schema/artifacts";
import type { MetricDiff } from "@s2d/schema/evidence";
import type { RunResult } from "@s2d/schema/run";
import type { Scenario } from "@s2d/schema/scenario";
import type { CascadeEvent, DatasetEvidence, DetectiveResult, SessionInput } from "./contract.draft";

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
    run(scenario: Scenario, seed: number): RunResult;
  };
  dataer: {
    store(run: RunResult, dbPath: string): Promise<void>;
    evidence(dbPath: string): Promise<DatasetEvidence>;
    compare(dbPathA: string, dbPathB: string): Promise<MetricDiff[]>;
    detective(dbPath: string, opts: JobOptions): Promise<DetectiveResult>;
  };
}
