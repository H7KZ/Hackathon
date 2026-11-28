# Handoff: frontend (`services/frontend`: Next.js + React)

Shared rules and the API overview: [README.md](README.md). Pages: SPEC §3.G. UI text in Czech.

## Status (2026-11-28): integrated

The chat workspace (`/` → `/chat?s=<id>`) drives a real session end to end: agents' progress (v1 and causal steps), the story editor (only curve-driving points are draggable; "Generovat data" sends `approve.settings`), the dataset canvas (KPIs from `/tables`, overview chart of what moved, evidence, table previews), detective, "Co kdyby" with a comparison whose markers follow the what-if's curves, "Zrušit" while busy and a "Pokračovat" / "Zkusit znovu" card after an interruption or failure. Pure mappings: `lib/chat/liveMapping.ts`; effects: `lib/chat/liveSource.ts`.

Run-4 follow-up ([run 5](../runs/2026-11-28-live-e2e-5.md)): the progress card shows elapsed time, a plain-words hint and the repair attempt n/5 with the failed hypothesis in Czech (`attemptDetail`); the curve editor names the curve in Czech (`curveLabel`) with one sentence of help; the live period picker sends `settings.period` only when the user sets one ("dnech s časem" = `hourJitter`); the dataset panel has downloads (`GET …/export?format=`) and, for a what-if, a "Porovnání s dat1" tab instead of a separate compare panel; chart series are clipped to the scenario period; quick replies sit at the end of the thread.

Tests: unit (`live-mapping`, `live-source` with a fake EventSource), Playwright on fake services (`flow.spec.ts`, ports 4310/3310), real stack in the browser (`E2E_REAL=1 … real.spec.ts`, live or `LLM_OFFLINE=1`), screenshot review of finished sessions (`E2E_REVIEW=<api>|<ids> … review.spec.ts`). Live results: [`docs/runs/2026-11-28-live-e2e-3.md`](../runs/2026-11-28-live-e2e-3.md).

## Goal

A conversational UI over a single session:
1. The user enters a story and a company.
2. They watch the agents work.
3. They edit the timeline (story points, segments) and press "Odeslat".
4. They see the data and the proof.
5. They ask "Co kdyby…?" or move a slider and compare the two runs.

## Start without LLM and without the engine

```powershell
$env:API_FAKE="all"; pnpm dev
```

Or put `API_FAKE=all` in `.env`. The API then serves fake services (400 ms per step), seeded from `scenarios/supplier_delay.json`. The whole flow works: draft → timeline → approve → evidence (`series` with 120 days) → what-if → compare → detective. It was verified end to end over HTTP.

## Connection (D9): commands over `hc`, events over SSE

```ts
// lib/api.ts (already exists): typed client, type-only import from @s2d/api
await api.sessions.$post({ json: { story, company } });                                  // 201 { sessionId } | 400 { errors }
await api.sessions[":id"].commands.$post({ param: { id }, json: { type: "approve" } });   // 202 | 409 busy | 422 { errors }
await api.sessions[":id"].artifacts[":name"].$get({ param: { id, name: "04_story" } });   // the timeline
// PUT /sessions/:id/artifacts/:name with the artifact JSON → 202 | 422 { errors: {path,message}[] }

// lib/useSession.ts (to write): one EventSource per tab
const es = new EventSource(`${API_URL}/sessions/${id}/events`);  // reconnects itself, sends Last-Event-ID
es.onmessage = (m) => dispatch(JSON.parse(m.data) as SessionEvent); // unnamed events → onmessage gets everything
```

- **Types:** `import type { SessionEvent, SessionState, SessionCommand, DatasetEvidence, … } from "@s2d/api"`. A runtime zod `SessionEvent.parse` only becomes available once the contract moves to `@s2d/schema/api` (waiting on the schema owner). Until then, use a cast.
- **Talk to `:4000` directly.** Not through a Next rewrite: rewrites time out after 30 s and may buffer SSE. CORS for `:3000` is already set up.
- **Keep the state in a pure reducer** `sessionReducer(state, event)`, so it can be unit tested without a browser.

## Events → UI

| Event | UI |
|---|---|
| `status` (`drafting`, `refining`, `awaiting_refinement`, `generating`, `detecting`, `ready`, `failed`, `cancelled`, `interrupted`) | Disable buttons while busy. Show "Zrušit" (`cancel`) while busy and "Pokračovat" (`resume`) when `interrupted`. |
| `cascade` `step.started` / `step.done` | Progress of A1–A5 (cached = "z cache") |
| `cascade` `loop.iteration` | "Agent opravuje scénář (pokus n): …feedback" |
| `cascade` `log` | Free-text log (also the detective's SQL queries) |
| `dataset.ready` `{datasetId}` | Fetch `GET …/datasets/:d/evidence` |
| `detective.done` | Fetch `GET …/datasets/:d/detective` |
| `error` `{message, errors?}` | Toast, plus highlight the field for `errors[].path` |

## Pages (existing folders in `app/`) → API

| Page | API |
|---|---|
| `pribeh` (Příběh) | `POST /sessions`, step timeline from SSE |
| `scenar` (Scénář) | `GET/PUT …/artifacts/04_story` (timeline editor: move or add points, segment text), "Odeslat" = `approve`. Other artifacts as raw JSON (`PUT …/artifacts/01_company`, …) |
| `dukaz` (Důkaz) | `GET …/datasets/:d/evidence`: expectations pass/fail table + Recharts of `series` |
| `detektiv` (Detektiv) | `detect` command, SQL log from SSE, `GET …/datasets/:d/detective` (narrative, `score.recall`) |
| `porovnani` (Porovnání) | `what_if {question, from}` or `edit_scenario {from, scenario}` (slider on a curve), then `GET …/datasets/:new/compare/:parent` |
| `data` (Data) | Table preview: the route doesn't exist yet, dataer task 5 (agree the shape with them) |

## You may edit the API

Missing a route or a field? Add it (README rule): `services/api/src/routes/sessions.ts`, plus a test in `services/api/tests/integration/sessions.test.ts`, plus a line in `docs/api-orchestrator.md`.

## Done = these pass

- Unit test of `sessionReducer` (vitest, no browser).
- Playwright smoke (`pnpm test:e2e`) against `API_FAKE=all`: story → timeline → Odeslat → proof chart → "Co kdyby" → comparison.
- `pnpm verify:fast` green, and the dependency boundary holds: only `import type` from `@s2d/api`.
