You continue the work on **Story2Data (JOJO)**. The run-4 follow-up lives on branch
`feat/run4-followup` (not pushed, no PR yet; it also carries `060a3d8`, a yoyo spinner committed by another
session). Continue on that branch, or cut `feat/run5-followup` from it. Ask me which one first.

## Read first (in this order)

1. `AGENTS.md`: rules, hard rules 1–9, autonomy, Definition of done.
2. `docs/runs/2026-11-28-live-e2e-5.md`: run-5 results, what was fixed, what is open.
3. `docs/decisions.md` (the two "Run-4 follow-up" entries) and `docs/handoffs/cascade.md` (section
   "Changed by the run-4 follow-up").
4. `docs/cascade-design.md` (D1–D8) and `docs/handoffs/dataer.md` (sections "Scoring" and "Export").

## How we work in this session

- **Discuss before you build.** For each item below: read the code and the evidence, then come back to me
  with the root cause, 2–3 options ranked (recommendation first), the cost in time and money (LLM calls),
  and what it changes in the contract or the cache. Start coding only after I pick an option.
- **Anything else you find** along the way (a bug, a weak check, a UX problem): describe it in one line,
  propose what to do, and ask whether we take it on. Don't fix it silently, and don't drop it either.
- TDD: a test that fails first, then the fix. `pnpm verify:fast` after each change, `pnpm verify` before
  every commit batch.
- Contract changes start in `packages/schema` (ask me first). No new dependencies without asking.
- Live LLM calls are allowed for verification (I have credits). Always pin the model
  (`. scripts/live-env.sh`), run each API process with its own `RUNS_DIR`, and say up front roughly how
  many calls a run will make. Never run two API processes on the same `RUNS_DIR`.
- **Cache keys:** a prompt, schema or feedback-message change changes the cache key of that step and every
  later one. After each such change: `. scripts/live-env.sh; CI=1 LLM_OFFLINE=1 pnpm evals` must stay green
  (CI=1 turns a cache miss into a failure instead of a skip), and the three landing examples must replay
  offline in the browser:
  `cd services/frontend; E2E_REAL=1 LLM_OFFLINE=1 E2E_CASE=<id> E2E_COMPANY="…" E2E_STORY="…" npx playwright test real`
  (texts in `services/frontend/lib/prompt.ts`). If they break, re-record live and commit only the cache
  files a replay reads (`LLM_CACHE_TRACE=<file>` on the replays and on an offline API running the harness).
- GitHub over SSH fails on this machine; push over HTTPS with `gh`:
  `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push https://github.com/H7KZ/Hackathon.git HEAD:refs/heads/<branch>`.
  Ask before pushing, opening a PR or touching `main`.

## Gotchas from run 5 (save yourself the time)

- Hooks block `curl` and inline `node -e "fetch(…)"` in Bash; put HTTP calls in a script file
  (e.g. a `wait-health.mjs` in the scratchpad) and run that.
- Stopping a background `pnpm --filter @s2d/api start` leaves its node child holding the port. Free it with
  PowerShell: `Get-NetTCPConnection -LocalPort 4400 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`.
- Other sessions may edit this checkout at the same time. Run `pnpm verify` and e2e in a clean worktree at
  your HEAD (`git worktree add --detach ../hk-verify HEAD; pnpm install --frozen-lockfile --prefer-offline`),
  and commit only your own files.
- `pnpm verify` can time out two API integration tests under turbo's parallel load; rerun once, or run
  `pnpm --filter @s2d/api test` alone, before treating it as a failure.
- The live harness now reads dataset ids (`dat1`, …) from the session; `--out` per run keeps reports apart.

## Open items

### 1. Causal detective recall is 33 %

**Evidence (run 5, live session `runs-live5c/af97fece-…`, offline replay `runs-off5c/3d705ee7-…`):**
story points `sp_zpozdeni_zacina` 2024-03-01 (phase 1), `sp_zpozdeni_roste` 2024-03-25,
`sp_zpozdeni_vrchol` 2024-04-22, all SUP-001; the lever `late_prob_problem` is now scoped to SUP-001.
The detective names SUP-001 correctly ("SUP-002 a SUP-003 … stabilní"), but:
- finding 1 "SUP-001 dodává s rostoucím zpožděním" is dated **2024-02-12**, 17 days before the first point
  (window ±14) → unmatched. Its own numbers: late share ~3 % in January, ~8 % in February, ~29 % in March,
  44–54 % in April–May.
- findings 2 and 3 (lost sales, complaints for SUP-001) are both dated 2024-03-01; only one can match the
  first point (nearest-point rule, one finding per point); the 03-25 and 04-22 points stay unfound.

**Ideas to weigh:**
- Diagnose first: is January's 3 % a warm-up artifact (the lever baseline is 0.08, so February's 8 % may
  just be the baseline, and January the anomaly)? The baseline-drift check looks at row counts, not rates.
  Run the scenario and compute SUP-001's late share per week; compare with the curve.
- If January is the artifact: a warm-up fix (start the period earlier and cut it, or a drift check on
  rates/shares too).
- The overlay puts three points 3–4 weeks apart on one lever; the detective reports the onset and the
  consequences, not three phases. Options: fewer, more distinct story points (overlay check), or score phase
  points of one lever as a group.
- Do **not** loosen the honest-scoring rules (nearest point, ±14 days, phase ≥ 1) without discussing it.

**Done when:** we agreed on the cause with numbers; the chosen fix is live on a causal run; recall goes up
for a reason we can explain (or we decided and documented why 33 % is the honest score); the causal eval
stays green offline.

### 2. The prompts don't explain what each curve segment kind does

**Evidence:** run 4's marketing "second wave" came from `decay` (jump to `to`, exponential return to the
previous level; half-life = end − start), which A4 used as "decay down to 1". The engine semantics are in
`services/noiser/src/engine/curves.ts`. The only curve syntax the agents see is one line at the end of
`A4_STORY` in `services/cascade/src/prompts/index.ts`
(`segments: [{kind: step|ramp|spike|decay, start, end?, to, storyPointId}]`), with no meaning. Run 5
added `checkCurveShapes` (compiler + A4 checks), which rejects decay-to-baseline and explains it, so the
misuse is caught but costs a retry.

Correction to the run-5 report: the syntax line is in `A4_STORY` (check `WHAT_IF` too), not in
`SHARED_RULES`. A fix there changes the A4 cache keys (and A5's where A4's answer changes), not every v1 key.

**Ideas to weigh:**
- One line per kind in the A4 (and what-if) prompt: step = hold `to` from start (until end, then back);
  ramp = linear to `to` by end, then hold; spike = jump, linear back by end; decay = jump, exponential back
  to the previous level. Cost: re-record the 4 v1 prompts + eval + landing replays (estimate calls first).
- Leave the prompts alone and rely on `checkCurveShapes` (zero cost, one retry when it fires).
- Other misleading shapes to check for at the same time (e.g. a `spike` used as a lasting change).

**Done when:** we decided with the call cost in hand; if adopted, all 4 v1 prompts still reach `ready` on
the first approve live, evals offline green, the three examples replay offline.

### 3. Nothing checks whether magnitudes are realistic

**Evidence:** my own session `runs/5c1019ac-…` ("Síť prodejen", supplier delays): A5 set `delay_days` to
**90–150 days** when late (0–1 otherwise) to make complaints pass the story gate's +30 %. All checks
passed. A delivery 5 months late reads as nonsense to a user, and it pushed delivered dates past the period
end (the chart bug fixed in run 5). Live run 4 marketing had a 20× campaign effect (p³), now rejected by the
compiler, but large-but-legal magnitudes still pass.

**Ideas to weigh:**
- A plausibility check in the compiler or the A5 story checks, domain-agnostic and cheap: a `dateOffset`
  longer than a fraction of the period (e.g. > 25 % or > 60 days), derived dates that land after
  `meta.end` for most records, a lever effect above N× baseline on a volume metric.
- Steer A5's repair: the gate feedback could say "prefer more affected records or a higher probability over
  extreme magnitudes" (changes the A5 feedback text → cache keys of repair attempts).
- An LLM plausibility critic per scenario (most flexible, costs a call per approve; must not write data).
- Show the key magnitudes to the user in the story editor so they can catch them (UI only).

**Done when:** we picked an approach; a test shows run-5's 90–150-day scenario is flagged with a message
that says what is wrong and what is valid; the 4 v1 prompts still reach `ready` on the first approve live;
evals and the three replays stay green.

## Finish

- A short run-6 report in `docs/runs/` (same table as run 5), `docs/decisions.md` entries for contract or
  behaviour decisions, and the handoffs you touched.
- Report in the terminal: what works now (concrete), what is still open, the cost of the live runs.
