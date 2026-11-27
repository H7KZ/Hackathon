# Handoffs: from the API orchestrator to each service

The API (`services/api`) orchestrates the whole flow and runs today on **fake ports**. Each team now plugs in its real implementation. Each handoff is self-contained and can be handed to a coding agent as is.

| Handoff | Team | What you deliver for the API |
|---|---|---|
| [cascade.md](cascade.md) | agent cascade | `cascade.run` incl. the A5 loop, `cascade.whatIf`, events, cancel |
| [noiser.md](noiser.md) | noiser (compiler + engine) | `runScenario(scenario, { seed })` |
| [dataer.md](dataer.md) | dataer | `store`, `evidence` (series), `compare`, `detective` |
| [frontend.md](frontend.md) | frontend | Next.js UI over REST + SSE |

Read first: `AGENTS.md`, [`docs/api-orchestrator.md`](../api-orchestrator.md) (decisions D1–D9, state machine, routes).

## How the API works (30 s)

```
POST /sessions {story, company}
  └─ cascade.run(until "04_story") ─► awaiting_refinement ◄─ PUT /artifacts/:name (edit → only later steps recompute)
                                            │ POST /commands {type:"approve"}
                                            ▼
  cascade.run(until "05_scenario") → noiser.run(scenario, seed) → dataer.store → dataer.evidence ─► ready (dataset d1)
                                            │ {type:"what_if"} | {type:"edit_scenario"} → new dN (parent, same seed) + dataer.compare
                                            │ {type:"detect"} → dataer.detective
  every step ─► events.jsonl ─► SSE GET /sessions/:id/events
```

- **Atomic principle (D3):** each service owns its own loops (A5 repair, detective tool loop). The API only calls a port, forwards its events, persists the result, and cancels through `AbortSignal`.
- **State lives on disk:** `runs/<sessionId>/{session.json, events.jsonl, job.json, 00–05_*.json, datasets/dN/{scenario.json, db.duckdb, evidence.json, compare_dX.json, detective.json}}`.

## Rule: you may edit the API to suit your service

You own your part of the API. Change it as your implementation needs, under these conditions:

1. **Your adapter is yours:** `services/api/src/adapters/<service>.ts`. One file per team, so you don't conflict with each other.
2. **Changing the port signature** (`services/api/src/ports.ts`, your section only):
   - update `services/api/tests/support/fakePorts.ts` to match,
   - adjust the call site in `services/api/src/orchestrator.ts`,
   - add one line to "Port changes" at the bottom of [`docs/api-orchestrator.md`](../api-orchestrator.md).
3. **These must stay green:** `pnpm vitest run services/api` (32 tests: goal loops L1–L7, routes/SSE, config). If you deliberately change a loop's behavior, change its test in the same commit and say why in the PR.
4. **Shared hotspots** (`orchestrator.ts`, `contract.draft.ts`, `routes/sessions.ts`, `app.ts`): keep changes small and announce them in the team chat before you push.
5. **Contract:** session types live in `services/api/src/contract.draft.ts` until the `packages/schema` owner approves them. Then they move unchanged to `@s2d/schema/api` (and `CascadeEvent` to `/artifacts`) and the draft file is deleted. Until then, extend the draft and **never** define types in parallel elsewhere.

## Definition of done (every team)

- [ ] The real adapter replaces the `zatím není implementováno` rejection, and the port is covered by a test in your workspace.
- [ ] `pnpm vitest run services/api` green, `pnpm verify:fast` green; `pnpm verify` before the PR.
- [ ] End to end through the API: `pnpm dev`, then the flow from your handoff's "How to check" section.
- [ ] The PR follows the template, from branch `feat/<area>-<name>`.

## Development without the others: `API_FAKE`

`API_FAKE=all` or a comma list (`cascade,noiser,dataer`) swaps those services for deterministic fakes (no LLM, no DuckDB, 400 ms per step). Examples:
- Frontend: `API_FAKE=all`.
- Noiser: `API_FAKE=cascade` (fake agents, real engine and dataer).
- Dataer: `API_FAKE=cascade` once the noiser works.

PowerShell: `$env:API_FAKE="cascade"; pnpm dev`, or a line in `.env`.

## Known state (2026-11-27)

- Real adapters: `cascade.run` works up to `04_story` (A1–A4); everything else is waiting for you.
- **Demo path without A5:** `PUT /sessions/:id/artifacts/05_scenario` with `scenarios/supplier_delay.json`, then `approve`. That still needs `runScenario` (noiser).
- With `LLM_OFFLINE=1` and no cache, a session ends `failed` with a readable error (verified against the real server).
