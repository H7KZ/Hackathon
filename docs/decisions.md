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

## 2026-11-27 — API = session orchestrator over ports, SSE + POST

- **Decision:** `services/api` orchestrates sessions (prompt → timeline → refine ⟲ → dataset → what-if ⟲) through injected ports (`services/api/src/ports.ts`). Each service owns its own loops (cascade A5/whatIf, dataer detective). REST: `POST /sessions/:id/commands` (zod union) + SSE `GET /sessions/:id/events`. State on disk in `runs/<sessionId>/`. No A2UI, no WebSocket. Details: `docs/api-orchestrator.md`.
- **Why:** atomic services, the demo runs offline, and every loop is observable in the UI.
- **Who:** API owner (grilling session).
- **Affects:** `services/api`, `services/frontend` (hc + EventSource), cascade (`onEvent`, `signal`), dataer (`evidence(db, expectations)`). Contract in `services/api/src/contract.draft.ts` waits for the `packages/schema` owner's approval, then moves there.

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
