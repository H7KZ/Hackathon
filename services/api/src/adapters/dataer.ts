/**
 * Dataer adapter, owned by the dataer team (docs/handoffs/dataer.md).
 * Change freely; keep `Ports["dataer"]` in ../ports.ts and tests/support/fakePorts.ts in sync.
 */
import { compareRuns, dailySeries, detective, runExpectations, storeRun, withSandbox } from "@s2d/dataer";
import { createLlm, type Llm } from "@s2d/llm";
import type { Ports } from "../ports";

export function dataerPort(opts: { llm?: Llm } = {}): Ports["dataer"] {
  let llm = opts.llm;
  // lazy: constructing the app (tests, server start) must not read LLM env or touch the cache
  const getLlm = () => (llm ??= createLlm());

  return {
    // writeRun + FK integrity check (throws a readable error naming table.column)
    store: (run, dbPath) => storeRun(dbPath, run),
    // LLM-written SQL runs only on a temporary read-only sandbox copy (AGENTS.md rule 5)
    evidence: (dbPath, expectations) =>
      withSandbox(dbPath, async (sandbox) => ({
        expectations: await runExpectations(sandbox, expectations),
        series: await dailySeries(sandbox),
      })),
    compare: (dbPathA, dbPathB) => compareRuns(dbPathA, dbPathB),
    detective: (dbPath, { onEvent, signal }) => detective(dbPath, { llm: getLlm(), onEvent, signal }),
  };
}
