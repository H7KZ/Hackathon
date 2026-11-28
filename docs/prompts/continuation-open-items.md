# Continuation prompt: Story2Data open items after live e2e run 3

Paste everything below the line into a new Claude Code session opened in this repo.

---

You continue the integration work on **Story2Data (JOJO)**. Everything is wired together on branch
`feat/integration-all` (not pushed yet). Work on that branch, or on a new branch cut from it.

## Read first (in this order)

1. `AGENTS.md`: rules, hard rules 1–9, autonomy, Definition of done.
2. `docs/runs/2026-11-28-live-e2e-3.md`: what the live runs showed, the 9 bugs already fixed, what is open.
3. `docs/handoffs/cascade.md` (section "Changed by live run 3") and `docs/cascade-design.md`.
4. `git log --oneline main..feat/integration-all`.

## How we work in this session

- **Discuss before you build.** For each item below: read the code and the evidence, then come back
  to me with the root cause, 2–3 options ranked (recommendation first), the cost in time and money
  (LLM calls), and what it changes in the contract or the cache. Start coding only after I pick an option.
- If you find **another problem** along the way, don't fix it silently: describe it in one line and
  ask whether we take it on.
- TDD: a test that fails first, then the fix. `pnpm verify:fast` after each change, `pnpm verify` before every commit batch.
- Contract changes start in `packages/schema` (ask me first). No new dependencies without asking.
- Live LLM calls are allowed for verification (I have credits). Always pin the model
  (`. scripts/live-env.sh`), run each API process with its own `RUNS_DIR`, and say up front roughly
  how many calls a run will make.
- **Cache keys:** changing a prompt, a schema or a feedback message changes the cache key of that
  step and every later step. After each such change: `pnpm evals` offline (command in
  `docs/handoffs/cascade.md`) must stay green, and the offline demo must still replay
  (`. scripts/live-env.sh; cd services/frontend; E2E_REAL=1 LLM_OFFLINE=1 npx playwright test real`).
  If they break, re-record (live) and commit only the cache files the replay reads.
- Ask before pushing, opening a PR or touching `main`.

## Open items

### 1. The first A5 round often fails on harder stories

**Evidence (run 3, Sonnet 5.5):** marketing and podpora failed attempts 1–5. They passed only after a
second "Generovat data" (A5 resumes at attempt 6; podpora succeeded at 9).
- Marketing: `exp_campaign_buyers_up` −0.5 % against +30 % needed. The campaign curve does not reach the measured table.
- Podpora: A4 bent 4 curves for one lever (`update_rollout`, `rollout_old`, `rollout_new`,
  `issue_rate`). `issue_rate` bends a phase-2 outcome point onto a downstream parameter.
- Attempts regress: attempt 4 reintroduced the error of attempt 1. The model sees only the last attempt.
- Data: `out/live-e2e/run-c/`, `out/live-e2e/run-d/` (gitignored, may be gone),
  `runs/<session>/05_scenario.rejected-N*.json`, `events.jsonl`.

**Ideas to weigh:**
- An A4 check: a story point with phase ≥ 2 that only follows from an earlier point gets no bending curve.
- Tell A5 which errors were already fixed and which keep coming back (history), not only the last attempt.
- Keep the best attempt so far (fewest failing checks) as `previous`.
- More attempts or a better story-gate message (show the chain from lever to the measured table).

**Done when:** marketing and podpora reach `ready` on the **first** approve, live on Sonnet 5.5, and
dodavatel / elektro_novak still pass (`node scripts/live-e2e.mjs`). Evals offline green, demo replays.

### 2. The detective cannot score segment-level stories

**Evidence:** marketing ("campaign customers") scored recall 0. A4 had to name entity ids and
invented `CUS-001…005`. The detective correctly reported the "kampaň" segment with the exact date
(2025-03-15), but `scoreFindings` matches entity ids only. Podpora lost two points the same way: the
detective described the surge through escalations and agents, not through the router ids.

**Ideas to weigh:**
- `StoryPoint` can name a categorical value (table, column, values), e.g. `segment = "kampaň"`, next
  to or instead of `entity.ids`. That is a contract change in `packages/schema/src/scenario.ts`,
  which then has to reach the compiler, `writeRun` (`truth.story_points`), `scoreFindings` and the A4
  checks that demand entity ids.
- The detective's report can name segments (a finding field), and scoring matches them.
- Precision 25–33 % comes from true downstream findings matched to the same point. Decide whether
  that counts as an error.

**Done when:** a segment story scores recall > 0 when the detective names the segment and date, the
existing scoring tests still pass, and the honest-scoring rules in `docs/runs/2026-11-27-live-e2e-2.md` still hold.

### 3. The causal design falls short on effect strength

**Evidence:** `CASCADE_DESIGN=causal`, supplier_delay prompt. The direction is right after the
branch-sign fix, but `sp_late_persist_sale` measures −8.2 % / −8.6 % against `MIN_CHANGE` −10 %.
Both 4b repair rounds fail (`services/cascade/src/causal/hypotheses.ts`, `cascade.ts` causal 05 → 4b loop).

**Ideas to weigh:**
- Derive the expected effect size from the path strength (product of p) instead of a flat 10 %.
- Give 4b the measured numbers and the chain, and allow a third round.
- Measure the peak window instead of the whole period.

**Done when:** the causal eval case passes live (seed 42 and ≥ 4/5 of seeds 1..5) and its cache is
recorded, `pnpm evals` offline green. v1 stays the default unless I decide otherwise.

## Extra items agreed with me

Same rule: discuss the approach before building.

### 4. Engine in a worker thread

**Evidence:** `noiser.run` + `dataer.store` run synchronously in the API process (1–10 s for large
scenarios, e.g. podpora on GPT-5: 409 097 rows). The harness saw occasional `ECONNRESET` on GETs
during those jobs, and SSE heartbeats stall. `docs/handoffs/noiser.md` already says: make the port
async and run it in a worker.

**Done when:** `Ports["noiser"].run` is async (port-change rule in `docs/handoffs/README.md`: update
`fakePorts`, the orchestrator call site, and the "Port changes" line in `docs/api-orchestrator.md`).
The engine runs in a `worker_threads` worker with the same deterministic output (golden hashes
unchanged), and a test shows the API answers `GET /health` while a large generation runs. The story
gate in the cascade (`gate.ts`) keeps working.

### 5. Offline demo for all three landing examples

**Evidence:** only "Příklad: Dodavatel" was verified offline in the browser. Marketing and Podpora
needed a second "Generovat data" in run 3, so their replay may need the resume path, or their
recordings may be incomplete.

**Done when:** each of the three examples replays offline in the browser (`E2E_REAL=1
LLM_OFFLINE=1`, `E2E_COMPANY` / `E2E_STORY` set to the example) through data, detective and the
suggested what-if. Re-record what is missing (live, pinned model), commit the cache files, and list in
`scripts/demo.mjs` which examples replay.

### 6. Move the session contract to `@s2d/schema/api`

**Evidence:** `services/api/src/contract.draft.ts` still holds `SessionState`, `SessionCommand`,
`SessionEvent`, `DatasetEvidence`, `DetectiveResult`, `GenerationSettings` (and `CascadeEvent`,
which belongs in `/artifacts`). The plan in `docs/api-orchestrator.md` is to move them unchanged and
delete the draft. The frontend imports them type-only from `@s2d/api`.

**Done when:** the types live in `packages/schema/src/api.ts` (`CascadeEvent` in `artifacts.ts`),
the draft file is deleted, every import is updated, the frontend imports from `@s2d/schema/api`,
boundaries pass (`pnpm deps:check`, eslint), and `docs/decisions.md` has an entry. Shared hotspot:
keep it one small commit.

### 7. Push the branch and open a PR

Last step, only after I say go. `git fetch origin && git rebase origin/main` on the branch, resolve
conflicts (lockfile: take main's and run `pnpm install`; `.cache/llm/`: keep both sides, they are
content-addressed), `pnpm verify` green, push (`--force-with-lease` only on our own branch, ask
first), open the PR with `.github/pull_request_template.md`, and link the run-3 and run-4 reports.
SSH access to GitHub must work on the machine. In the session that wrote this prompt, `git fetch`
failed with "Permission denied (publickey)".

## Finish

- Update `docs/runs/` with a short run-4 report (same table format as run 3), `docs/decisions.md` for
  contract or behaviour decisions, and the handoffs you touched.
- Report in the terminal: what works now (concrete), what is still open, the cost of the live runs.
