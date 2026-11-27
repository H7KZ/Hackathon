/**
 * Cascade adapter, owned by the cascade team (docs/handoffs/cascade.md).
 * Change freely; keep `Ports["cascade"]` in ../ports.ts and tests/support/fakePorts.ts in sync.
 */
import { basename, dirname } from "node:path";
import { runCascade, storyGate, whatIf, type CascadeDesign } from "@s2d/cascade";
import { createLlm, type Llm } from "@s2d/llm";
import type { Ports } from "../ports";

export function cascadePort(design: CascadeDesign = "v1"): Ports["cascade"] {
  let llm: Llm | undefined;
  // lazy: constructing the app (tests, server start) must not read LLM env or touch the cache
  const getLlm = () => (llm ??= createLlm());

  return {
    async run(input, { dir, until, onEvent, signal }) {
      await runCascade(input, {
        llm: getLlm(),
        runsDir: dirname(dir),
        runId: basename(dir),
        until,
        onEvent,
        signal,
        // A5 is accepted only when the story shows in the data (engine + expectations + flat baseline)
        verify: storyGate,
        design,
      });
    },
    whatIf: (question, base, { onEvent, signal }) => whatIf(getLlm(), question, base, { onEvent, signal }),
  };
}
