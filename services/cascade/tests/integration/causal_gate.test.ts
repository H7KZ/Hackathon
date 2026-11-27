/**
 * D3 on real data: the hypotheses that code derives from the supplier_delay causal map must hold in
 * the generated data (engine + evidence, same gate as the evals) with the SQL an agent would write.
 */
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "@s2d/test-utils";
import { finishCausal } from "../../src/causal/assemble";
import { deriveHypotheses } from "../../src/causal/hypotheses";
import { causalStory } from "../../src/causal/sql";
import { causalMap, overlay, processesPlan, queries } from "../unit/causal_fixtures";
import { storyGate } from "../../src/gate";
import { expectationGate } from "../evals/gates";

describe("causal design: derived hypotheses on generated data", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  it("supplier_delay hypotheses pass at seed 42 and on >= 4/5 seeds", async () => {
    const tmp = makeTempDir();
    cleanup = tmp.cleanup;
    const hypotheses = deriveHypotheses(causalMap, overlay, processesPlan);
    const story = causalStory(causalMap, overlay, { hypotheses, queries });
    const res = finishCausal({
      input: { story: "s", company: "c" },
      runId: "gate",
      plan: processesPlan,
      overlay,
      story,
    });
    if (!res.ok) throw new Error(JSON.stringify(res.errors));
    // the same gate v1's A5 runs (engine, FK integrity, expectations, flat baseline)
    expect(await storyGate(res.scenario)).toEqual([]);
    const gate = await expectationGate(res.scenario, tmp.dir);
    expect(gate.main.failed).toEqual([]);
    expect(gate.robust.flatMap((r) => r.failed.map((f) => `seed ${r.seed}: ${f.id}`))).toEqual([]);
    expect(gate.pass).toBe(true);
  }, 120_000);
});
