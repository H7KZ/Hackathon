/**
 * Agent evals (AGENTS.md "Verification for LLM agents").
 * Each case runs the real cascade through @s2d/llm. Offline (default) it replays .cache/llm,
 * so a case without recorded outputs is skipped; EVAL_LIVE=1 calls the model and records the cache.
 *
 * Gates per case:
 *   1. every artifact validates (zod)                    — enforced by @s2d/llm
 *   2. 05_scenario compiles                               — A5 repair loop + compileScenario
 *   3. expectations pass on >= 4/5 seeds                  — TODO when engine exists
 *   4. detective recall >= MIN_RECALL vs truth.story_points — TODO when detective exists
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLlm, findRepoRoot, LlmCacheMiss } from "@s2d/llm";
import { compileScenario } from "@s2d/noiser";
import { runCascade } from "../../src/cascade";

const LIVE = process.env.EVAL_LIVE === "1";
const ROOT = findRepoRoot();

const CASES = [
  {
    id: "supplier_delay",
    company: "Síť 5 prodejen s domácími potřebami v ČR. Zboží od 3 dodavatelů, zásobování týdně.",
    story:
      "Síti prodejen klesají tržby. Poptávka ale neklesla: jeden dodavatel začal od března dodávat pozdě, což způsobilo výpadky zásob, neuskutečněné nákupy a více stížností.",
  },
];

describe("cascade evals", () => {
  for (const c of CASES) {
    it(`${c.id}: A1–A5 produce valid artifacts and 05 compiles`, async (ctx) => {
      const llm = createLlm({ offline: !LIVE });
      const runsDir = join(ROOT, "runs", "evals");
      try {
        const res = await runCascade(c, { llm, runsDir, runId: `${c.id}-${LIVE ? "live" : "replay"}` });
        expect(res.story?.expectations.length ?? 0).toBeGreaterThan(0);
        expect(compileScenario(res.scenario).ok).toBe(true);
        mkdirSync(runsDir, { recursive: true });
        writeFileSync(
          join(runsDir, `${c.id}.result.json`),
          JSON.stringify({ case: c.id, pass: true }, null, 2),
        );
      } catch (err) {
        // In CI a missing recording is a failure, not a skip (otherwise the gate is always green).
        // runCascade wraps the miss in CascadeStepError, so look at the cause too
        const miss =
          err instanceof LlmCacheMiss || (err instanceof Error && err.cause instanceof LlmCacheMiss);
        if (miss && !process.env.CI) {
          console.warn(`[eval] ${c.id}: no recorded LLM output, run with EVAL_LIVE=1 to record`);
          ctx.skip();
        }
        throw err;
      }
    });
  }
});
