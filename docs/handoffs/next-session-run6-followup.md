You continue the work on **Story2Data (JOJO)**. The run-5 follow-up lives on branch `feat/run5-followup`
(head `4cbd928`, not pushed, no PR). Continue on that branch, or cut `feat/run6-followup` from it. Ask me
which one first.

## Read first (in this order)

1. `AGENTS.md`: rules, hard rules 1–9, autonomy, Definition of done.
2. `docs/runs/2026-11-28-live-e2e-6.md`: run-6 results, what changed, what is open, why it stopped.
3. `docs/decisions.md` (the two "Run-5 follow-up" entries) and `docs/handoffs/cascade.md` (section
   "Changed by the run-5 follow-up").
4. `services/api/src/settings.ts` (`applySettings`), `services/api/src/orchestrator.ts` (`approve` job),
   `services/cascade/src/cascade.ts` (A5 `verify`) and `services/cascade/src/gate.ts` (`storyGate`).

## How we work in this session

- **Discuss before you build.** For each item: read the code and the evidence, then come back to me with
  the root cause, 2–3 options ranked (recommendation first), the cost in time and money (LLM calls), and
  what it changes in the contract or the cache. Start coding only after I pick an option.
- **Anything else you find** (a bug, a weak check, a UX problem): describe it in one line, propose what to
  do, and ask whether we take it on. Don't fix it silently, and don't drop it either.
- TDD: a test that fails first, then the fix. `pnpm verify:fast` after each change, `pnpm verify` (clean
  worktree at your HEAD) before every commit batch.
- Contract changes start in `packages/schema` (ask me first). No new dependencies without asking.
- Live LLM calls are allowed for verification. Always pin the model (`. scripts/live-env.sh`), run each API
  process with its own `RUNS_DIR`, and say up front roughly how many calls a run will make. Never run two
  API processes on the same `RUNS_DIR`.
- Ask before pushing, opening a PR or touching `main`. Push over HTTPS with `gh`:
  `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push https://github.com/H7KZ/Hackathon.git HEAD:refs/heads/<branch>`.

## Gotchas from run 6 (save yourself the time)

- **Check the credit first.** Run 6 stopped with "Your credit balance is too low to access the Anthropic
  API". Before any live run, make one cheap call (e.g. a cached-miss detective on a tiny db) or ask me.
- **`EVAL_LIVE=1 pnpm evals` cannot record**: the cascade evals script does not load the API key, and agents
  must not touch `.env`. Record through the API instead (its start script loads the key): the harness case
  `supplier_delay_causal` against a **v1** API sends exactly the v1 eval's prompts; against a
  `CASCADE_DESIGN=causal` API, the causal eval's.
- Next.js allows **one dev server per folder**: stop any `next dev` on :3000 before `pnpm test:e2e` or the
  real/review specs (they start their own on :3310).
- Hooks block `curl`, inline `fetch` in `node -e`, `sleep N; …` chains and anything mentioning `.env`. Put
  HTTP calls in a script file (`wait-health.mjs` pattern) and wait with an `until …; do sleep 5; done` loop.
- Stopping a background `pnpm --filter @s2d/api start` leaves its node child on the port:
  `Get-NetTCPConnection -LocalPort <port> -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`.
- Heredocs with backslashes or quotes get mangled in the Bash tool; write edit scripts with the Write tool.
- Model requests sometimes stall for minutes. `@s2d/llm` now times out (detective 60 s, others 4 min) and
  retries once; `LLM_DEBUG=1` prints one timing line per request. Healthy detective steps take 2–12 s.
- `API_FAKE=all API_FAKE_DELAY_MS=5000` makes fake steps slow enough to test reloads mid-run.
- Untracked `services/frontend/public/yoyo-spinner-*.svg` and modified `yoyo-trick-*.svg` belong to another
  session: never commit them.

## Open items

### 1. Record Podpora and the v1 eval (finish run 6)

**Evidence:** run-6 harness (`out/live6-v1.log`): Podpora draft recorded (A4 needed 3 tries on the
entity/scope checks), approve failed in A5 attempt 2 on the credit error; Elektro Novák and the v1 eval
input never ran. Offline today: `CI=1 LLM_OFFLINE=1 pnpm evals` → v1 cache miss at `04_story`; the
"Podpora" landing example misses at A5. Dodavatel, Marketing and causal replay fully offline.

**Plan to confirm with me (cost ~25–35 calls, more if A5 needs repairs):**
```
. scripts/live-env.sh
API_PORT=4402 RUNS_DIR=runs-live6b pnpm --filter @s2d/api start
node scripts/live-e2e.mjs --api http://localhost:4402 --runs runs-live6b --out out/live-e2e-6b --only podpora,supplier_delay_causal
```
Optional: `elektro_novak` (another ~15 calls) to complete the run-6 table.

**Done when:** `CI=1 LLM_OFFLINE=1 pnpm evals` is 2/2; the three landing examples replay offline in the
browser (`cd services/frontend; E2E_REAL=1 LLM_OFFLINE=1 E2E_CASE=<id> E2E_COMPANY="…" E2E_STORY="…" npx playwright test real`,
texts in `services/frontend/lib/prompt.ts`); the offline harness replays podpora with 0 new calls; only the
cache files a replay reads are committed (`LLM_CACHE_TRACE=<file>`); the run-6 report table is completed.

### 2. A5 still has to satisfy hypotheses the user switched off

**Evidence:** the story editor's "Ověřované hypotézy" toggles travel as `approve.settings.expectations`
(kept ids). `applySettings` applies them to the dataset copy of `05_scenario` **after** the cascade, so the
A5 story gate (`storyGate` via `seedRobust`) still checks every expectation of `04_story`. A user who turns
off a hypothesis because their curve edit contradicts it still pays for 5 A5 attempts (since run 6 they
end in `acceptGateMisses` instead of a failure, but the attempts are wasted).

**Ideas to weigh:**
- Pass the kept ids into the cascade run (orchestrator → `ports.cascade.run` → `runCascade` options) and
  filter only inside the gate (`verify`). The A5 prompt stays the same, so cache keys do not change for
  the default (all kept); a toggled run's repair attempts get different feedback.
- Also filter the expectations shown to A5 in its prompt: the agent stops tuning for a dropped hypothesis,
  but every toggled run has new A5 keys.
- At least one expectation must stay (empty gate = no story check): reject or warn in the UI.
- Check the what-if path and the fake ports (`services/api/src/adapters/fake.ts`) for the same option.

**Done when:** an API integration test shows a disabled expectation does not fail the gate (fake ports or a
`verify` spy); a cascade unit test shows the gate receives only kept ids; default approve keeps its cache
keys (offline evals and replays green without re-recording); decision entry in `docs/decisions.md`.

### 3. Noticed in run 6, not done (bring each to me as a one-liner first)

- **Detective misses phases of edited stories:** on the rerun of "obchod s obovi" it found the supplier
  returns (SUP-002) but none of the three store demand points (recall 25 %, precision 100 %).
- **Causal recall stays 33 % on the run-5 db:** the first phase (+12 pp on ~35 orders/week) is buried in
  noise (diagnosis in the run-6 report). A detectability check on phase steps vs. weekly volume would be
  the honest fix; scoring stays as it is.
- **Entity names read oddly for stores:** stores get faker `companyName` ("Patočková v.o.s. (STO-001)");
  A2 could give stores a city/branch name field, or `entityLabels` could prefer `city` for stores.
- **Editable story-point titles still show raw ids** (graph tooltip, advanced settings), by design.
- **Fake data shows an id as an actor** ("SUP-002" in the Firma card of `API_FAKE`).

## Finish

- Complete `docs/runs/2026-11-28-live-e2e-6.md` (or a short run-7 report if item 2 needs live runs),
  `docs/decisions.md` entries for contract or behaviour decisions, and the handoffs you touched.
- Report in the terminal: what works now (concrete), what is still open, the cost of the live runs.
