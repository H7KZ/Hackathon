/**
 * Cascade adapter, owned by the cascade team (docs/handoffs/cascade.md).
 * Change freely; keep `Ports["cascade"]` in ../ports.ts and tests/support/fakePorts.ts in sync.
 */
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { runCascade } from "@s2d/cascade";
import { createLlm, type Llm } from "@s2d/llm";
import type { Ports } from "../ports";

export function cascadePort(): Ports["cascade"] {
  let llm: Llm | undefined;
  // lazy: constructing the app (tests, server start) must not read LLM env or touch the cache
  const getLlm = () => (llm ??= createLlm());

  return {
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
    whatIf: () => Promise.reject(new Error("cascade.whatIf zatím není implementováno.")),
  };
}
