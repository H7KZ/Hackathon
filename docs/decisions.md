# Decisions

Short log of team decisions that affect more than one workspace. One entry each, newest on top. Do not rewrite old entries; add a new one that supersedes them.

Template:

```
## YYYY-MM-DD — <short title>
- **Decision:** …
- **Why:** …
- **Who:** …
- **Affects:** <workspaces / files>
```

## 2026-11-27 — Landing screen is the prompt box; frontend uses plain fetch

- **Decision:** `/` is a landing screen (FIS logo + JOJO, company + story, text-file attachments) that calls `POST /sessions`. The global navigation and API status are not shown for now. The frontend uses plain `fetch` with `import type` from `@s2d/api` instead of the `hc` client (supersedes the `hc` part of the entry below and of D9; SSE is unchanged).
- **Why:** the frontend owner asked for a focused first screen and no Hono code in the frontend.
- **Who:** frontend owner.
- **Affects:** `services/frontend`. Not built yet: loading state and everything after the session is created. The API has no upload route, so only text files are appended to `story`.

## 2026-11-27 — API = session orchestrator over ports, SSE + POST

- **Decision:** `services/api` orchestrates sessions (prompt → timeline → refine ⟲ → dataset → what-if ⟲) through injected ports (`services/api/src/ports.ts`). Each service owns its own loops (cascade A5/whatIf, dataer detective). REST: `POST /sessions/:id/commands` (zod union) + SSE `GET /sessions/:id/events`. State on disk in `runs/<sessionId>/`. No A2UI, no WebSocket. Details: `docs/api-orchestrator.md`.
- **Why:** atomic services, the demo runs offline, and every loop is observable in the UI.
- **Who:** API owner (grilling session).
- **Affects:** `services/api`, `services/frontend` (hc + EventSource), cascade (`onEvent`, `signal`), dataer (`evidence(db, expectations)`). Contract in `services/api/src/contract.draft.ts` waits for the `packages/schema` owner's approval, then moves there.

## 2026-11-27 — Cascade design: agents emit JSON parts, code assembles the scenario

- **Decision:** the cascade is a chain of agents (company → objects → attributes → typed causal map → story overlay → per-period subagents), each returning a part of the JSON. Code assembles `scenario.json`: it builds curves from the agents' time × value matrix and derives expectation hypotheses from the overlay + causal map (LLM writes only their SQL). Causal edges are typed (probabilistic / mechanical / attribute). Details: `docs/cascade-design.md`.
- **Why:** the LLM only decides values and structure, while dates, curve segments and test directions come from deterministic code, so fewer invalid scenarios and the story is traceable.
- **Who:** cascade owner (design session).
- **Affects:** `services/cascade`, `packages/schema/src/artifacts.ts` (future change, will be announced).

## 2026-11-27 — Cascade repair loop runs compileScenario only

- **Decision:** the A5 and whatIf loops feed back only `compileScenario` (and zod) errors, max 3 iterations. They do not run the engine at `scale: 0.2` or the expectations, which differs from SPEC §3.A and `docs/handoffs/cascade.md`. Details: `docs/cascade-design.md` D8.
- **Why:** design D5: the cascade ends with a composed scenario, and evidence shows weak effects.
- **Who:** cascade owner.
- **Affects:** `services/cascade`, `services/api/src/adapters/cascade.ts`. The API team should confirm that "expectations ≥ 4/5 seeds" is checked outside the cascade.

## 2026-11-27 — Team workflow (by convention, no branch protection)

- **Decision:** changes reach `main` through PRs after local verification (`pnpm verify`), by team convention. No CI workflow. Branch protection is not enabled. Agents work in worktrees on feature branches and ask before contract, push or paid-API actions (see AGENTS.md).
- **Why:** four people and agents commit to the same repo; the team chose to rely on the workflow rather than GitHub enforcement.
- **Who:** team (proposed in PR `chore/team-workflow`).
- **Affects:** `AGENTS.md`, `.github/`, `.claude/settings.json`.

## 2026-11-27 — pnpm `minimumReleaseAge` lowered to 60 minutes

- **Decision:** `pnpm-workspace.yaml` sets `minimumReleaseAge: 60` (minutes) instead of pnpm 12's default of 1 day.
- **Why:** the lockfile contains 11 packages released within the last day (eslint, hono, postcss, …). With the default, every pnpm command, including the pre-commit hook, fails until after the hackathon deadline. 60 minutes keeps a short supply-chain guard.
- **Who:** Amelie (with an agent), while merging `feat/noiser-engine`.
- **Affects:** `pnpm-workspace.yaml`, every `pnpm` command.

## 2026-11-27 — A5 loop runs the engine at `scale: 1`

- **Decision:** the A5 agentic loop (compile → engine → expectations) runs `runScenario` at `scale: 1`, not 0.2.
- **Why:** `scale` shrinks large entities and arrival volume, but flow levels and `topUp` targets are absolute. In `supplier_delay` at 0.2 the demand per [store, product] drops to 20 %, stockouts almost vanish and e3/e5 fail although they pass at 1. A full run takes ~150 ms, so shrinking saves nothing.
- **Who:** Amelie (with an agent), noiser review.
- **Affects:** `services/cascade` (A5), `SPEC.md`, `docs/handoffs/{cascade,noiser}.md`.
