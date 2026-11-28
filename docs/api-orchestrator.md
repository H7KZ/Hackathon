# API orchestrator: design (variant A approved and implemented)

**Status (2026-11-28):** fully integrated. Real adapters for every port (cascade incl. A5 + whatIf, noiser, dataer incl. compare, detective, tables/preview); the UI drives the whole flow over REST + SSE. Verified end to end with real LLM calls on five prompts: [`docs/runs/2026-11-28-live-e2e-3.md`](runs/2026-11-28-live-e2e-3.md). `API_FAKE=all` still runs the flow without LLM or DuckDB (Playwright `tests/e2e/flow.spec.ts`).

Owner: `services/api`. Research: [`docs/research/api-orchestration.md`](research/api-orchestration.md).

## Decisions (grilling, 2026-11-27)

| # | Decision |
|---|---|
| D1 | `Scenario` stays the only hand-off from the cascade to the noiser (SPEC rule 11). The user edits a timeline (`04_story`). After "Odeslat", the cascade turns it into `05_scenario`. |
| D2 | Any artifact `01–05` can be edited through the API (zod-validated). An edit deletes the later artifacts and re-runs the cascade from there. The flow pauses only after `04_story` (`awaiting_refinement`). |
| D3 | **Atomic principle:** each service owns its own loops (cascade: A5 repair, `whatIf`; dataer: detective tool loop). The API only starts them, forwards their events, persists results, and cancels them. |
| D4 | Cascade port = existing `runCascade` plus `{ until, onEvent, signal }`. Pausing means returning at `until`. Events are a `CascadeEvent` zod union. |
| D5 | State lives on disk in `runs/<sessionId>/` (`session.json`, `events.jsonl`, artifacts, `datasets/dN/{scenario.json, db.duckdb}`). Memory holds only the emitter and the `AbortController`. On startup, busy sessions become `interrupted`. `resume` is manual. DuckDB holds generated data only. |
| D6 | A counterfactual is either a text question (`cascade.whatIf`) or a direct scenario edit (no LLM). Either creates a new dataset `dN` with a `parent` and the same seed. Compare against the parent runs automatically. |
| D7 | After generation, store + integrity + evidence run automatically. The detective runs only on demand (`detect`). Events carry IDs only; data is fetched with GET as plain zod JSON. No A2UI. |
| D8 | One active job per session. A new command gets `409` while a job is running, except `cancel`, which aborts the job and returns the session to its last stable state. No queue, no auth. |
| D9 | Transport: commands go as POST through the typed `hc` client. Events stream over SSE (`EventSource`, `Last-Event-ID` replay from `events.jsonl`). The browser talks to `:4000` directly (CORS). No WebSocket. |

## Session state machine

```
            create(prompt)
                 │
                 ▼
            ┌─ drafting ──────────────┐ cascade until 04_story
            │                         ▼
            │   ┌──────────► awaiting_refinement ◄──┐
            │   │ edit_artifact       │ approve       │ cancel
            │   └──── refining ◄──────┤               │
            │                         ▼               │
            │                     generating ─────────┘ cascade until 05 → noiser → store → evidence
            │                         │
            │                         ▼
            │   what_if / edit ┌──► ready ◄──┐ detect
            │   scenario       │      │      │
            │                  └─ generating detecting
            ▼
  failed | interrupted ── resume ──► (re-runs the last job)
```

Stable states (`cancel` returns to them): `awaiting_refinement`, `ready`. Busy states: `drafting`, `refining`, `generating`, `detecting`.

## Ports (implemented by teammates; the API runs on fakes until then)

```ts
interface Ports {
  cascade: {
    run(input: CascadeInput, o: { dir: string; until: ArtifactName; onEvent; signal }): Promise<void>;
    whatIf(question: string, base: Scenario, o: { onEvent; signal }): Promise<Scenario>;
  };
  noiser: { run(scenario: Scenario, seed: number): RunResult };            // pure
  dataer: {
    store(run: RunResult, dbPath: string): Promise<void>;                   // + FK integrity
    evidence(dbPath: string): Promise<DatasetEvidence>;                     // expectations + series
    compare(a: string, b: string): Promise<MetricDiff[]>;
    detective(dbPath: string, o: { onEvent; signal }): Promise<DetectiveResult>;
  };
}
```

## Goal loops (each is an acceptance test in `services/api/tests/integration/orchestrator.acceptance.test.ts`)

| Loop | Goal (measurable) | Stops when | Feedback |
|---|---|---|---|
| L1 draft | `04_story.json` exists, status `awaiting_refinement` | the cascade returns at `until: 04_story` / error → `failed` / `cancel` | `CascadeEvent`s forwarded |
| L2 refinement ⟲ (user) | after `edit_artifact(N)`, artifacts `< N` are unchanged and `> N` are recomputed | the user sends `approve` | the new artifacts |
| L3 generation | dataset `d1` with `db`, evidence; status `ready` | evidence stored / error → `failed` | `dataset.ready` |
| L4 counterfactual ⟲ (user) | new `dN`, `parent` set, same seed, compare stored | `dataset.ready` | compare diff |
| L5 detective | detective result stored for `dN` | the detective returns | its events |
| L6 control | `409` when busy; `cancel` returns to the stable state; restart → `interrupted`; `resume` finishes without recomputing done steps | — | — |
| L7 events | `seq` strictly increasing; replay after `seq` returns exactly the later events | — | — |

## REST variants

All three use the same orchestrator core (`createOrchestrator(ports, runsDir)`). They differ only in how HTTP maps onto it.

**A. Session plus one command endpoint (recommended)**
```
POST /sessions                         { prompt }             → 201 { sessionId }
GET  /sessions/:id                                            → SessionState
GET  /sessions/:id/events              (SSE, Last-Event-ID)
POST /sessions/:id/commands            SessionCommand union    → 202 { seq } | 409
PUT  /sessions/:id/artifacts/:name     artifact JSON           → 202 | 409 | 422
GET  /sessions/:id/datasets/:d/evidence | /tables | /tables/:t?limit= | /compare/:other | /detective
```
- Pros: one zod union in `@s2d/schema/api` is shared by the core, the route and the UI. 409 is handled in one place. A new command doesn't touch `app.ts` (a conflict hotspot).
- Cons: a discriminated-union body is less self-documenting than separate routes.

**B. One route per action**: `POST /sessions/:id/approve | what-if | detect | cancel | resume`, otherwise the same as A.
- Pros: the URL says what happens, and each route has its own validator.
- Cons: more routes; every new action touches the router.

**C. Chat style** (`POST /sessions/:id/messages` returns an AI SDK UI message stream for each message, `useChat` on the frontend).
- Pros: a ready-made chat UI.
- Cons: `ai` and `@ai-sdk/react` move into the frontend; jobs outlive their request; reconnect is weaker; the timeline editor is not a chat anyway.

**Recommendation: A.**

## Contract changes (need the `packages/schema` owner's approval)

Done 2026-11-28: moved unchanged from `services/api/src/contract.draft.ts` (deleted) to the places below; `CompileError` moved to `packages/schema/src/errors.ts` (re-exported by `/api`) so `api.ts` and `artifacts.ts` do not import each other.


- `@s2d/schema/api`: `SessionStatus`, `SessionState`, `SessionCommand`, `SessionEvent`, `DatasetEvidence`, `DetectiveResult`.
- `@s2d/schema/artifacts`: `CascadeEvent`.
- `@s2d/llm`: optional `abortSignal` in the request (cascade cancel).

## Port changes

One line per change to `services/api/src/ports.ts` (date, team, what changed, why).

- 2026-11-27, API: `dataer.evidence(dbPath, expectations)`. Expectations come from the scenario (SPEC rule 7) and run on the sandbox.
- 2026-11-27, API: adapters split into `src/adapters/{cascade,noiser,dataer}.ts` (one file per team). Fakes in `src/adapters/fake.ts`, enabled with `API_FAKE`.
- 2026-11-28, API (integration): `dataer.tables(db)` and `dataer.preview(db, table, limit)` (schema `main` only, read-only; `TableInfo`/`TablePreview` in `@s2d/schema/evidence`). Routes `GET …/datasets/:d/tables` → `{tables}` and `GET …/datasets/:d/tables/:t?limit=` → `TablePreview` (404 for unknown or ground-truth tables).
- 2026-11-28, API (integration): `approve` takes optional `settings` (`GenerationSettings`: seed, scale, noise %, kept expectation ids), applied by `src/settings.ts` to the dataset copy of `05_scenario` (curves never change). `resume` also works after a draft that `failed` or was `cancelled` (its `job.json` is kept).
- 2026-11-28, API (integration): `noiser.run` returns `Promise<RunResult>`; the adapter runs the engine in a `worker_threads` worker (`runScenarioInWorker` from `@s2d/noiser`), so `GET /health` and SSE answer during large generations (live run 3 saw ECONNRESET). Fakes are async; the orchestrator awaits.
