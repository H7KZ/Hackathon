# Gotchas

Mistakes that happened or are easy to repeat. Add an entry when something bites twice; if it can be checked by a tool, also add a lint rule or test and reference it here.

Format: **symptom** → **rule** (guard, if any).

## Isolation and contracts

- **Scenario leaks into evidence/detective.** Importing the `@s2d/schema` barrel in `services/dataer/src/evidence` or `src/detective` pulls scenario types in. → Import `@s2d/schema/evidence`, `/detective` or `/run` only (AGENTS.md rule 5).
- **LLM SQL touches the real DB.** Running expectations or detective SQL against the main DuckDB. → Always go through `exportSandbox()` + `openSandbox()`. Keyword filters are not a security boundary.
- **New types defined twice.** A hand-written interface in `api` or `frontend` drifts from zod. → Use `z.infer` from `packages/schema`.

## Engine determinism

- **Flaky golden tests.** `Date.now()`, `new Date()` without arguments or `Math.random()` in `services/noiser/src/engine/`. → Lint blocks it; pass dates as arguments and draw randomness from `rng.ts` streams.
- **Changing one process changes unrelated tables.** A shared RNG instance instead of per-process streams. → Derive streams from `hash(seed, processId)`; the stream-isolation test catches it.
- **Global faker output differs between runs.** → Use `new Faker({ locale })` seeded from the process RNG (lint enforced).
- **Off-by-one in curves.** `end` is exclusive, `start` inclusive. → Check `engine/days.ts` before writing a segment.

## LLM and cache

- **Demo fails without internet.** Cache entry missing for the current prompt, model or schema. → Run `pnpm evals` with `LLM_OFFLINE=1`; re-record with `EVAL_LIVE=1` only by the agreed person.
- **Cache merge conflicts.** Two people recorded the cache on different branches. → Regenerate, do not hand-merge (AGENTS.md, Team section).
- **Compiler errors unusable for the agent.** Messages say what is wrong but not what is valid. → Compiler errors must say both; they are fed back to agent A5.

## Tooling

- **`pnpm test:watch` runs everything.** → For one file: `pnpm vitest run <path>`.
- **Stop hook blocks finishing.** `pnpm verify:fast` is red. → Read the printed output; the hook lets you stop on the second failure, so do not ignore it.
- **Lockfile conflict after rebase.** → Take `main`'s `pnpm-lock.yaml`, run `pnpm install`, commit.
- **Agent command blocked with "agents must not touch env files".** Intentional: `scripts/block-env.mjs` blocks Bash commands that mention an env file (`.env.example` and `process.env` are fine). → Run commands that need real keys yourself; agents use `LLM_OFFLINE=1`.
- **Playwright missing browser.** → `pnpm --filter @s2d/frontend exec playwright install chromium`.
