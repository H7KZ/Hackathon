/**
 * Agent evals (AGENTS.md "Verification for LLM agents").
 * Each case runs the real cascade through @s2d/llm. Offline (default) it replays .cache/llm,
 * so a case without recorded outputs is skipped; EVAL_LIVE=1 calls the model and records the cache.
 *
 * Gates per case:
 *   1. every artifact validates (zod)                    — enforced by @s2d/llm
 *   2. 05_scenario compiles                               — A5 repair loop + compileScenario
 *   3. expectations pass at seed 42 and on >= 4/5 seeds 1..5 — gates.ts (engine + evidence)
 *   4. detective recall >= MIN_RECALL vs truth.story_points — TODO: dataer has no detective agent yet
 *
 * Every run starts in a fresh temp runs dir: reusing one would replay old artifacts from disk and never
 * call the agents, so a prompt change would go untested. A failed run's dir is kept and logged.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLlm, findRepoRoot, LlmCacheMiss } from "@s2d/llm";
import { compileScenario } from "@s2d/noiser";
import { runCascade } from "../../src/cascade";
import { expectationGate } from "./gates";

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
    it(`${c.id}: A1–A5 produce valid artifacts, 05 compiles, expectations pass on the data`, async (ctx) => {
      const llm = createLlm({ offline: !LIVE });
      const resultsDir = join(ROOT, "runs", "evals");
      const runsDir = mkdtempSync(join(tmpdir(), `s2d-eval-${c.id}-`));
      let keep = true;
      try {
        const res = await runCascade(
          { story: c.story, company: c.company },
          { llm, runsDir, runId: `${c.id}-${LIVE ? "live" : "replay"}` },
        );
        expect(res.story?.expectations.length ?? 0).toBeGreaterThan(0);
        const compiled = compileScenario(res.scenario);
        if (!compiled.ok) throw new Error(`05_scenario does not compile: ${JSON.stringify(compiled.errors)}`);
        const gate = await expectationGate(compiled.scenario, res.dir);
        mkdirSync(resultsDir, { recursive: true });
        writeFileSync(
          join(resultsDir, `${c.id}.result.json`),
          `${JSON.stringify({ case: c.id, pass: gate.pass, gate }, null, 2)}\n`,
        );
        expect(gate.main.failed, `expectations failing at seed 42 (artifacts in ${res.dir})`).toEqual([]);
        expect(gate.pass, `expectations pass on < 4/5 seeds (artifacts in ${res.dir})`).toBe(true);
        keep = false;
      } catch (err) {
        // In CI a missing recording is a failure, not a skip (otherwise the gate is always green).
        // runCascade wraps the miss in CascadeStepError, so look at the cause too
        const miss =
          err instanceof LlmCacheMiss || (err instanceof Error && err.cause instanceof LlmCacheMiss);
        if (miss && !process.env.CI) {
          console.warn(`[eval] ${c.id}: no recorded LLM output, run with EVAL_LIVE=1 to record`);
          keep = false;
          ctx.skip();
        }
        throw err;
      } finally {
        if (keep) console.warn(`[eval] ${c.id}: artifacts kept in ${runsDir}`);
        else rmSync(runsDir, { recursive: true, force: true });
      }
    });
  }
});
