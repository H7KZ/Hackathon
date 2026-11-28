# Continuation prompt: Story2Data open items after live e2e run 4

Paste everything below the line into a new Claude Code session opened in this repo.

---

You continue the work on **Story2Data (JOJO)**. The integration and the run-3 follow-up are merged to
`main` (PR #20). Cut a new branch from `main` (e.g. `feat/run4-followup`) and work there.

## Read first (in this order)

1. `AGENTS.md`: rules, hard rules 1–9, autonomy, Definition of done.
2. `docs/runs/2026-11-28-live-e2e-4.md`: run-4 results, what was fixed, what is open.
3. `docs/decisions.md` (the four 2026-11-28 entries) and `docs/handoffs/cascade.md` (section
   "Changed by the run-3 follow-up").
4. `docs/cascade-design.md` (D1–D8, causal design) and `docs/handoffs/dataer.md` (section "Scoring").

## How we work in this session

- **Discuss before you build.** For each item below: read the code and the evidence, then come back
  to me with the root cause, 2–3 options ranked (recommendation first), the cost in time and money
  (LLM calls), and what it changes in the contract or the cache. Start coding only after I pick an option.
- If you find **another problem** along the way, don't fix it silently: describe it in one line and
  ask whether we take it on.
- TDD: a test that fails first, then the fix. `pnpm verify:fast` after each change, `pnpm verify` before
  every commit batch.
- Contract changes start in `packages/schema` (ask me first). No new dependencies without asking.
- Live LLM calls are allowed for verification (I have credits). Always pin the model
  (`. scripts/live-env.sh`), run each API process with its own `RUNS_DIR`, and say up front roughly how
  many calls a run will make. Never run two API processes on the same `RUNS_DIR`.
- **Cache keys:** a prompt, schema or feedback-message change changes the cache key of that step and
  every later one. After each such change: `. scripts/live-env.sh; LLM_OFFLINE=1 pnpm evals` must stay
  green, and the three landing examples must still replay offline in the browser:
  `cd services/frontend; E2E_REAL=1 LLM_OFFLINE=1 E2E_CASE=<id> E2E_COMPANY="…" E2E_STORY="…" npx playwright test real`
  (texts in `services/frontend/lib/prompt.ts`). If they break, re-record live and commit only the
  cache files a replay reads: run the replays with `LLM_CACHE_TRACE=<file>` and add the untracked
  `.cache/llm/<key>.json` files listed there.
- `EVAL_LIVE=1` needs the API key in the shell (vitest does not load the env file). The same prompts
  record through a running API session with the eval's company and story.
- GitHub over SSH fails on this machine; push over HTTPS with `gh`:
  `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push https://github.com/H7KZ/Hackathon.git HEAD:refs/heads/<branch>`.
  Ask before pushing, opening a PR or touching `main`.

## Open items

### 1. The causal run's detective scored 0 %

**Evidence (run 4, session `runs-live4c/316b5f18-…`, may be gone):** the overlay's story points name
`SUP-001` (`sp_zpozdeni_zacina` 2024-03-01, `sp_zpozdeni_roste` 2024-03-25, `sp_zpozdeni_vrchol`
2024-04-22). The lever curve `late_prob_problem` has **no scope**. The detective found late deliveries
for **SUP-002 and SUP-003** from 2024-03-01 ("SUP-002 (problémový)", "SUP-003 … i když je veden jako
spolehlivý"), so the dates match but the ids do not. Likely cause: the lever reaches suppliers through
an attribute (e.g. a "problémový" flag picked per supplier), not through a scope on ids, so the answer
key (`entity.ids`) is not the set of records the lever actually moved. The detective may have been
right and the truth wrong.

**Ideas to weigh:**
- Derive story point entity ids from the data or from the lever's realization (which supplier rows
  carry the attribute the lever uses) instead of trusting the overlay.
- A check in the causal design: a lever whose story point names entity ids must be scoped to those
  ids (v1 already has `checkCurveScopes`), or the attribute must select exactly those ids.
- Score against the records the lever moved (ground truth from the engine) rather than declared ids.

**Done when:** on a live causal run, the story points name the suppliers whose data actually changes,
the detective scores recall > 0 when it names them with the right dates, and the honest-scoring rules
(nearest point, ±14 days, phase ≥ 1) still hold. Causal eval stays green offline.

### 2. Marketing's order volume climbs again after the campaign ends

**Evidence (run 4, session `runs-live4/bb97f5ba-…`; screenshot
`out/e2e-screens/review-bb97f5ba/09-dataset-d1.png`):** the curve `order_rate` (scope
`self.customer_segment = ["kampaň"]`) ramps 1 → 3 on 2025-04-01..04-07 and decays back to 1 on
2025-04-30..05-15. From mid-May to 30 June every series (campaign buyers, sales, deliveries, retention
emails) climbs back to ~85 % of the campaign peak; the detective calls it a "second wave". The story
says most new customers did **not** buy again, so a second climb contradicts it, yet all 3
expectations pass (none measures after the fade).

A5's realization is unusual: the curve is used three times as the `p` of bernoulli fields
`is_active_1/2/3` of `order_attempt`, and the branch `intent_check` ANDs them (so the effect is roughly
`p³`, with `p` above 1 clamped). Other candidates for the climb: the stock flow (initial 26–30 per
product, restocking by `supplier_restock`) recovering after the campaign drained it (lost sales
"nedostupné zboží" peak in April), or repeat orders (`repeat_campaign` p 0.12, `repeat_loyal` p 0.45)
accumulating.

**Ideas to weigh:**
- Diagnose first: run the scenario with the curve flat and with stock unlimited to see which mechanism
  makes the climb.
- An expectation (A4) or a story-gate check for "after the last story point the metric returns to its
  baseline", e.g. an `after`-window comparison against the pre-story baseline.
- A compiler or A5 check against using one curve as several multiplied probabilities, or values above
  1 as a probability.

**Done when:** the marketing data shows the campaign spike and a return to the baseline (no second
climb unless the story says so), checked by an expectation or the gate, live on Sonnet 5.5 and on the
first approve; the offline browser replay of "Příklad: Marketing" still works (re-record if needed).

### 3. v1 checks only one seed

**Evidence:** the v1 story gate (`services/cascade/src/gate.ts` `storyGate`) runs at the scenario
seed (42). The causal design wraps it in `seedRobust` (≥ 4 of seeds 1..5); the eval gate
(`tests/evals/gates.ts`) demands the same for both designs, and the v1 eval passes. Live runs are only
checked at seed 42, so a v1 story could be luck (the causal sale effect was: −1..−5 % on seeds 1..5
while seed 42 passed). Not applied to v1 in run 4 because it makes A5 harder to pass on the first approve.

**Ideas to weigh:**
- Use `seedRobust` in the v1 A5 loop too; measure first how many of the 4 run-4 v1 scenarios
  (`runs-live4/*/05_scenario.json`, may be gone; re-create from the cache replay) pass ≥ 4/5 seeds as
  they are. No LLM calls are needed for that measurement.
- Seed-robust only on the last A5 attempts, or as a warning event in the UI instead of a failure.
- Cost: 5 extra engine runs per A5 attempt (1–5 s each in the worker).

**Done when:** we decided with numbers (how many v1 scenarios pass ≥ 4/5 seeds now, and the A5
attempt count with the stricter gate). If it is adopted: all 4 v1 prompts still reach `ready` on the
first approve live, evals offline green, and the three examples replay offline.

## Finish

- A short run-5 report in `docs/runs/` (same table as run 4), `docs/decisions.md` entries for contract
  or behaviour decisions, and the handoffs you touched.
- Report in the terminal: what works now (concrete), what is still open, the cost of the live runs.
