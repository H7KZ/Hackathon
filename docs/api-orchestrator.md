# API orchestrator: design (variant A approved and implemented)

**Status:** core + routes + SSE implemented in `services/api/src/{orchestrator,sessionStore,routes/sessions,adapters}.ts`, tested against fake ports. The real adapters (`adapters.ts`) still return "zatím není implementováno" for `cascade.whatIf`, `dataer.compare` and `dataer.detective`. Cascade A5 is missing too: for now, upload `05_scenario` with `PUT /sessions/:id/artifacts/05_scenario` and then `approve`.

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
GET  /sessions/:id/datasets/:d/evidence | /tables/:t | /compare/:other | /detective
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

- `@s2d/schema/api`: `SessionStatus`, `SessionState`, `SessionCommand`, `SessionEvent`, `DatasetEvidence`, `DetectiveResult`.
- `@s2d/schema/artifacts`: `CascadeEvent`.
- `@s2d/llm`: optional `abortSignal` in the request (cascade cancel).
