/**
 * Real port implementations: thin wrappers over @s2d/{cascade,noiser,dataer}.
 * Pieces teammates haven't delivered yet reject with a Czech message the UI can show.
 */
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { runCascade } from "@s2d/cascade";
import { exportSandbox, openSandbox, runExpectations, writeRun } from "@s2d/dataer";
import { createLlm, type Llm } from "@s2d/llm";
import { runScenario } from "@s2d/noiser";
import type { Ports } from "./ports";

const notYet = (what: string) => Promise.reject(new Error(`${what} zatím není implementováno.`));

export function realPorts(): Ports {
  let llm: Llm | undefined;
  const getLlm = () => (llm ??= createLlm());

  return {
    cascade: {
      async run(input, { dir, until, onEvent, signal }) {
        signal.throwIfAborted();
        await runCascade(input, {
          llm: getLlm(),
          runsDir: dirname(dir),
          runId: basename(dir),
          until: until === "05_scenario" ? "04_story" : until,
          onStep: (step, status) => {
            onEvent({ type: "step.done", step, cached: status === "cached" });
          },
        });
        if (until === "05_scenario" && !existsSync(join(dir, "05_scenario.json"))) {
          throw new Error(
            "Krok A5 (05_scenario) v kaskádě zatím chybí. Nahraj scénář přes PUT /sessions/:id/artifacts/05_scenario.",
          );
        }
      },
      whatIf: () => notYet("cascade.whatIf"),
    },
    noiser: {
      run: (scenario, seed) => runScenario(scenario, { seed }),
    },
    dataer: {
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
    },
  };
}
