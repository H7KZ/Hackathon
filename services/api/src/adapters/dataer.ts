/**
 * Dataer adapter, owned by the dataer team (docs/handoffs/dataer.md).
 * Change freely; keep `Ports["dataer"]` in ../ports.ts and tests/support/fakePorts.ts in sync.
 */
import { exportSandbox, openSandbox, runExpectations, writeRun } from "@s2d/dataer";
import type { Ports } from "../ports";

const notYet = (what: string) => Promise.reject(new Error(`${what} zatím není implementováno.`));

export function dataerPort(): Ports["dataer"] {
  return {
    store: (run, dbPath) => writeRun(dbPath, run),
    async evidence(dbPath, expectations) {
      // LLM-written SQL runs only on a read-only sandbox copy (AGENTS.md rule 5)
      const sandboxPath = `${dbPath}.sandbox`;
      await exportSandbox(dbPath, sandboxPath);
      const sandbox = await openSandbox(sandboxPath);
      try {
        return { expectations: await runExpectations(sandbox, expectations), series: [] };
      } finally {
        sandbox.close();
      }
    },
    compare: () => notYet("dataer.compare"),
    detective: () => notYet("dataer.detective"),
  };
}
