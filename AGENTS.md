# AGENTS.md — Story2Data

Hackathon project (deadline Sat 12:00, freeze 09:00). **Working beats perfect.** Full spec: `SPEC.md` — read sections 2 (rules) and 4 (contract) before touching code.

## What this is

Generator of linked relational datasets in which a given business story is causally encoded in the records.
Pipeline: LLM agent cascade → `scenario.json` → deterministic engine → DuckDB → evidence / blind detective / compare → Next.js UI.

## Monorepo map (pnpm + Turborepo)

One backend service. `services/api` imports the other services as **plain function calls** — no microservices.

| Workspace             | What                                                                                                      | May import                          |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `packages/schema`     | zod contract, **single source of truth** (`scenario`, `evidence`, `run`, `artifacts`, `detective`, `api`) | nothing internal                    |
| `packages/llm`        | the only LLM entry point: AI SDK + disk cache + offline mode                                              | —                                   |
| `packages/test-utils` | fixtures, temp dirs, `fakeGenerate` (tests only)                                                          | —                                   |
| `services/noiser`     | compiler (`src/compiler`) + pure deterministic engine (`src/engine`), docs: `services/noiser/README.md`   | `schema`                            |
| `services/dataer`     | DuckDB store, evidence, detective, compare                                                                | `schema`, `llm`                     |
| `services/cascade`    | agents A1–A5 + orchestrator, evals                                                                        | `schema`, `llm`, `noiser`, `dataer` |
| `services/api`        | Hono REST app + CLI (`src/cli`)                                                                           | everything                          |
| `services/frontend`   | Next.js UI, talks to the API over REST (`lib/api.ts`, plain `fetch`)                                      | **type-only** from `api`            |

Boundaries are enforced by `eslint.config.js` and `.dependency-cruiser.cjs` — if they fire, fix the design, don't silence the rule.

## Team, ownership and git workflow

Four people work on this repo, humans and agents alike.

- **Owners** (who reviews PRs in an area): see `.github/CODEOWNERS`. Changes to `packages/schema` are announced in the PR and approved by the owner before the compiler/engine change lands.
- **One person, one workspace at a time** when possible. Shared files are conflict hotspots: `packages/schema/src/*`, `services/api/src/app.ts`, `pnpm-lock.yaml`, `scenarios/*.json`, `.cache/llm/`.
- **Trunk:** `origin/main`. Never push to `main` directly; every change goes through a PR, and the pre-commit hook plus `pnpm verify` must be green first.
- **Branches:** one branch per feature (a larger unit of work, not per file or per commit), e.g. `feat/<area>-<name>`. Each person works on their own branch(es).
- **Agents work in git worktrees**, one per branch, so parallel agents never share a checkout.
- **Pushes:** push in larger, meaningful batches, not after every small commit. Keep the local history readable before pushing.
- **Before pushing:** `git fetch origin && git rebase origin/main` from the feature branch, then resolve conflicts there. Do not force push to shared branches. A rebased feature branch that was already pushed needs `git push --force-with-lease` on your own branch; humans run that themselves, agents ask first (`.claude/settings.json` denies force pushes).
- **Lockfile conflicts:** do not merge by hand. Take `main`'s `pnpm-lock.yaml`, run `pnpm install`, commit the result.
- **LLM cache conflicts:** `.cache/llm/` is regenerated, not hand-merged. Only one person records (`EVAL_LIVE=1 pnpm evals`) at a time; announce it in the team chat.
- **PR:** fill in the template (`.github/pull_request_template.md`); squash merge.
- **Decisions** that affect the whole team go to `docs/decisions.md` (one short entry each), not only into personal notes.

## Agent autonomy

Agents may, without asking:

- edit code and tests in their own branch, run `pnpm verify:fast` / targeted tests,
- commit to their own feature branch.

Agents must ask first before:

- changing `packages/schema` (the contract) or adding a dependency,
- pushing, opening or merging a PR, or touching `main`,
- running `EVAL_LIVE=1 pnpm evals` or anything that calls a paid API,
- deleting or rewriting entries in `.cache/llm/`, `scenarios/`, or `runs/`,
- anything that needs secrets. Agents must not read `.env` files: `.claude/settings.json` denies them for Read/Grep/Glob, and the `scripts/block-env.mjs` hook blocks Bash commands that mention them. This stops accidental reads, not a determined script (there is no sandbox). Run anything that needs real keys yourself; agents use `LLM_OFFLINE=1`.

## Commands

```
pnpm install
pnpm dev                     # api :4000 + UI :3000
pnpm test:watch              # TDD loop across all workspaces
pnpm verify:fast             # boundaries + typecheck + lint + unit tests (~30 s) — run after every change
pnpm verify                  # format + boundaries + root lint + typecheck + lint + all tests + build — before commit / freeze
pnpm test:e2e                # Playwright smoke (needs `pnpm --filter @s2d/frontend exec playwright install chromium`)
pnpm evals                   # LLM agent evals (offline from .cache/llm; EVAL_LIVE=1 records)
pnpm gen scenarios/supplier_delay.json --seed 42
pnpm cascade "<story>" "<company>"
pnpm evidence <db> | pnpm detective <db> | pnpm compare <dbA> <dbB>
```

## Hard rules (never violate)

1. **LLM never produces data rows or code.** Only scenario config / artifacts validated by zod.
2. **Engine (`services/noiser/src/engine/`) is pure and deterministic.** No `Math.random`, `Date.now`, `new Date()` without explicit arguments, fs, network, or LLM imports (eslint-enforced). Randomness only via `rng.ts` streams derived from `hash(seed, processId)`.
3. **Story only through curves on parameters.** Never write outcome metrics directly; they must emerge from the process chain.
4. **Every derived record carries FKs to its source.** Referential integrity is tested after every run.
5. **`dataer/src/evidence` and `dataer/src/detective` read only DuckDB.** Never import the scenario there (only `@s2d/schema/evidence|detective|run`, never the `@s2d/schema` barrel). LLM-written SQL (expectations, detective) runs ONLY on a sandbox DB: `exportSandbox()` + `openSandbox()` (main tables only, read-only, no external access, config locked). SQL keyword filters are not a security boundary.
6. **`packages/schema` is the single source of truth.** Change the contract there first, then compiler, then engine. Never define parallel types elsewhere; use `z.infer`.
7. **All LLM calls go through `@s2d/llm`** (disk cache keyed by model+instructions+prompt+schema). Demo must run offline from cache (`LLM_OFFLINE=1`).
8. **Never commit** `.env`, `out/`. Do commit `.cache/llm/` entries used for the demo.
9. **Engine faker:** never the global `faker`; use `new Faker({ locale })` seeded from the process RNG stream (eslint-enforced).

## Conventions

- TypeScript strict (+ `noUncheckedIndexedAccess`), no `any`, ESM, named exports, `import type` for types.
- Validate at boundaries (`Schema.parse`) — file load, LLM output, API input, env.
- Compiler errors are `{ path, message }[]` — they are fed back to agent A5, so messages must say what is wrong AND what is valid.
- Identifiers and code in English; user-facing UI text and generated data in Czech (`cs-CZ`).
- Dates are ISO `YYYY-MM-DD` in the contract; the engine works with integer day indices (`engine/days.ts`). Curve segments: `start` inclusive, `end` exclusive.
- Process ids and table names are snake_case (`Ident`); record ids are `<process_id>-000001`, entity ids `<idPrefix>-001`.
- Several processes may write the same table (same visibility); `writeRun` concatenates them, missing columns become NULL.
- Keep files small; one process type per file in `services/noiser/src/engine/processes/`.
- No new dependencies without a clear reason.

## TDD workflow

1. Pick the next `it.todo` (engine backlog: `services/noiser/tests/unit/engine.test.ts`, golden: `tests/golden/`).
2. Turn it into a failing test → minimal code → green → refactor. Keep `pnpm test:watch` running.
3. Test folders per workspace:
   - `tests/unit/` — pure, no I/O, fast (part of `verify:fast` and the agent hook)
   - `tests/integration/` — real DuckDB / filesystem / in-process HTTP
   - `tests/property/` — fast-check invariants (determinism, isolation, integrity)
   - `tests/golden/` — pinned table hashes for reference scenarios
   - `tests/evals/` — LLM agent evals (cascade only, `pnpm evals`)
   - `services/frontend/tests/e2e/` — Playwright smoke
4. Never use the network in unit tests: inject `fakeGenerate` from `@s2d/test-utils` into `createLlm`.

## Definition of done (for coding agents)

- [ ] A test proves the change (new or updated), and it failed before the change.
- [ ] `pnpm verify:fast` is green. The pre-commit hook (`.husky/pre-commit`) runs it on every commit, and the Claude Code Stop hook in `.claude/settings.json` blocks finishing otherwise. Agents must not use `--no-verify`.
- [ ] Contract changes started in `packages/schema` and the compiler validates them.
- [ ] Before opening or updating the PR: `pnpm verify` is green.
- [ ] If you touched prompts: `pnpm evals` (offline) still passes; re-record with `EVAL_LIVE=1` if the cache key changed.

## Verification for LLM agents (cascade)

Gates per eval case (`services/cascade/tests/evals/`):

1. every artifact 01–05 validates (zod, enforced by `@s2d/llm`),
2. `05_scenario.json` compiles,
3. expectations pass at `--seed 42` and ≥ 4/5 seeds of 1..5,
4. detective recall ≥ 0.6 vs `truth.story_points`.

## How to add things

**New FieldGen / Cond / process type:** add to the zod union in `packages/schema/src/scenario.ts` → handle in `services/noiser/src/compiler/validate.ts` (reference checks) → implement in `services/noiser/src/engine/` → unit test with a fixed seed.

**New scenario:** add `scenarios/<id>.json`; it must compile, pass `pnpm gen` and all its `expectations`. Add it to the golden tests.

**New agent step:** artifact schema in `packages/schema/src/artifacts.ts`, function in `services/cascade/src/steps.ts` (or `aN_*.ts`) returning the parsed object, register in `cascade.ts` (writes `runs/<runId>/NN_name.json`), unit test with `fakeGenerate`.

**New API route:** `services/api/src/routes/<name>.ts` returning a chained `Hono` (keeps the client typed), mount in `app.ts`, integration test with `testClient`.

## Required tests

- **Determinism:** same scenario + seed → identical table hashes.
- **Stream isolation:** changing one curve's parameter leaves tables of unrelated processes identical.
- **Integrity:** every FK resolves; no negative flow if `min: 0`.
- **Story:** all `expectations` of `supplier_delay` pass at `--seed 42` and at least 4/5 seeds of 1..5.

## Known gotchas

Short list of mistakes that already happened or are easy to make. Full list: `docs/gotchas.md`. Add an entry there when something bites twice.

- Importing the `@s2d/schema` barrel from `dataer/src/evidence` or `dataer/src/detective` breaks the isolation rule; import the subpath instead.
- `pnpm test:watch` runs all workspaces; for a single file use `pnpm vitest run <path>`.
- The Stop hook runs `pnpm verify:fast` after code changes; a red run blocks the agent from finishing.

## Priorities when time is short

Must: schema → compiler → engine → `supplier_delay` → evidence → compare → minimal UI.
Then: cascade A1–A5, detective. Only then: noise, second domain, polish.
If a feature is not working by 06:00 Saturday, cut it.
