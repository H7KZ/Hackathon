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


## 2026-11-28 — Session contract moved to `@s2d/schema/api`

- **Decision:** `SessionStatus`, `SessionInput`, `DatasetInfo`, `SessionState`, `GenerationSettings`, `SessionCommand`, `SessionEvent`, `DatasetEvidence`, `DetectiveResult` moved unchanged from `services/api/src/contract.draft.ts` (deleted) to `packages/schema/src/api.ts`; `CascadeEvent` to `artifacts.ts` (cascade imports it instead of its mirror type). `CompileError` lives in `errors.ts` and `/api` re-exports it, so `api.ts` ↔ `artifacts.ts` has no import cycle. The frontend imports the types from `@s2d/schema/api`.
- **Why:** one source of truth (hard rule 6); the draft was waiting only for this move.
- **Who:** integration (agent), item 6 of the run-3 follow-up.
- **Affects:** `packages/schema`, `services/api`, `services/cascade/src/events.ts`, `services/frontend/lib`.

## 2026-11-28 — Integration: UI settings travel with approve; e2e on own ports; live harness and offline demo

- **Decision:** (1) The story editor sends `approve.settings` (seed, scale, noise %, kept hypotheses); the API applies them to the dataset copy of `05_scenario` (`services/api/src/settings.ts`), never to curves. In live mode the editor hides what the API cannot apply (period, company size, ramp length). (2) Only story points that drive the edited curve are draggable; outcome points stay untouched on edit. (3) New port `dataer.tables/preview` + routes for the Data tab and totals. (4) `resume` also re-runs a failed or cancelled draft. (5) Playwright uses its own ports (API 4310, UI 3310) and never reuses a running server; `E2E_REAL=1` runs the real stack. (6) `pnpm e2e:live` (`scripts/live-e2e.mjs`) drives real sessions and writes a report; `pnpm demo` replays the committed cache with every LLM step pinned to one model.
- **Why:** before this, editor settings were silently ignored in live mode, editing one knot could add segments for outcome points and break the story, and the e2e config could attach to a dev server already running on :4000.
- **Who:** integration agent (asked by the frontend owner to integrate everything end to end).
- **Affects:** `services/api` (contract.draft `GenerationSettings`, orchestrator, routes, CLI), `services/dataer` (`src/preview`), `packages/schema/src/evidence.ts` (`TableInfo`, `TablePreview`), `services/frontend` (live source, story surface, e2e), `scripts/`, `.cache/llm/` (recordings of the live run).

## 2026-11-27 — Causal cascade (D1–D4) built behind `design: "causal"`, v1 stays default

- **Decision:** the typed causal map design is implemented next to the A1–A5 cascade, not instead of it. `CascadeOptions.design` (`CASCADE_DESIGN` in the API, `--design` in the CLI) picks `"v1"` (default) or `"causal"`: 4a `03a_causal_map`, 4b `03b_processes` with `trace`, `04a_overlay` (lever × story point matrix, curves built by code), `04b_expectations` (hypotheses derived by code, LLM writes only SQL), `04_story` and `05_scenario` assembled by code. v1 also gets two code checks: `03_influences` endpoints must name parts of `02_model`, and A5 curves may drive only map roots. `ArtifactName` gains `03a_causal_map`, `03b_processes`, `04a_overlay`, `04b_expectations`; `ArtifactSchemas` in `@s2d/schema/artifacts` is the one artifact → schema map.
- **Why:** the demo must keep working from the recorded v1 cache until the causal path is recorded and proven; the causal path keeps curve placement, test directions and the rule "curves only on levers" in deterministic code.
- **Who:** `packages/schema` owner (approved the schema change), cascade agent.
- **Affects:** `packages/schema/src/artifacts.ts`, `services/cascade`, `services/api` (`config.ts`, `adapters/`, `orchestrator.ts`, CLI). Details and what is not built: `docs/cascade-design.md`. The causal path has no LLM cache yet (`EVAL_LIVE=1 pnpm evals` records it).

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

> **Superseded** by PR #14 (`dfc0e79`): the A5 loop also runs story checks and the injected story gate (`CascadeOptions.verify` = `storyGate`: engine at the scenario seed, FK integrity, expectations, baseline drift). whatIf keeps no gate. Current state: `docs/cascade-design.md` D5, D8.

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

> Valid again since PR #14: the engine runs inside the A5 loop through `verify` (`storyGate` calls `generate` on the scenario as is, so its `scale` applies and the cascade leaves it unset = 1). It no longer contradicts the entry above, which #14 superseded.

- **Decision:** the A5 agentic loop (compile → engine → expectations) runs `runScenario` at `scale: 1`, not 0.2.
- **Why:** `scale` shrinks large entities and arrival volume, but flow levels and `topUp` targets are absolute. In `supplier_delay` at 0.2 the demand per [store, product] drops to 20 %, stockouts almost vanish and e3/e5 fail although they pass at 1. A full run takes ~150 ms, so shrinking saves nothing.
- **Who:** Amelie (with an agent), noiser review.
- **Affects:** `services/cascade` (A5), `SPEC.md`, `docs/handoffs/{cascade,noiser}.md`.

## 2026-11-27 — A2UI as the chat rendering layer (frontend presenter)

- **Decision:** the chat UI renders agent output as A2UI v1.0 messages with our own small React renderer and a JOJO catalog (charts, tables, KPIs, steps). A presenter in the frontend (`services/frontend/lib/chat/surfaces.ts`) turns SessionEvents + GET data into A2UI; the API stays plain zod JSON + SSE (D7 unchanged). Data-bearing props must be `{"@path"}` bindings, so numbers always come from DuckDB-backed endpoints (hard rule 1). Demo mode (`?demo=1`) plays the whole workflow on mock data.
- **Why:** declarative, safe agent-driven UI; the presenter can move to the API later without touching the renderer. `@a2ui/react` needs zod 3 and has none of our components.
- **Who:** frontend (with an agent).
- **Affects:** `services/frontend`, `docs/design/`. Later, optional: `@s2d/schema/a2ui` + an `a2ui` SessionEvent (needs schema owner approval).
