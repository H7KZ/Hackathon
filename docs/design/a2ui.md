# A2UI in JOJO: how it works

Protocol facts and sources: [`docs/research/a2ui.md`](../research/a2ui.md). This file is how **we** use it.

## One-paragraph answer

A2UI is a declarative JSON format: an agent sends a flat list of components (`Card`, `Kpi`, `LineChart`…) plus a separate data model, and the client renders them with its own trusted components. Nothing executable crosses the wire. In JOJO the **layout** is A2UI; the **numbers** always come from DuckDB-backed endpoints and are placed only in the data model, bound with `{"@path": "/…"}`. The renderer cannot tell (and does not care) whether a surface was built by a deterministic presenter, an LLM agent, or the demo script.

## Who emits A2UI

```
             ┌──────────── today ────────────┐            ┌──── later (optional) ────┐
SessionEvent │  liveSource.ts                │            │  services/api emits the   │
 (SSE, zod)  │   fetch evidence / artifacts  │            │  same messages over SSE   │
   ─────────►│   presenter: surfaces.ts      ├─ A2UI ───► │  (event type "a2ui")      │
             │  mockSource.ts (demo script)  │  messages  └───────────────────────────┘
             └───────────────────────────────┘      │
                                                    ▼
                                createSurfaceStore() → <A2uiSurface> → JOJO catalog
                                                    │
                     user action (Button) ◄─────────┘ A2uiAction → POST /sessions/:id/commands
```

1. **Presenter (now):** `services/frontend/lib/chat/surfaces.ts` — pure functions `data → A2UI messages`. Used by both sources. It respects team decision D7 (API sends plain zod JSON + SSE, no A2UI): the translation happens in the frontend.
2. **API presenter (later, no renderer change):** move `surfaces.ts` into `services/api`, emit messages as a `SessionEvent` of type `a2ui`. Needs a contract change in `@s2d/schema/api` (owner approval) and the A2UI zod schemas in `@s2d/schema/a2ui`.
3. **Agent-authored layout (stretch):** an agent (e.g. the detective or a "reporter" step) outputs `updateComponents` only. The API validates it with `validateComponents` (unknown component → error; literal number in a data prop → error, so hard rule 1 holds) and fills the data model from SQL it runs on the sandbox DB. Validation errors use the A2UI `{code, path, message}` format, which maps 1:1 onto our compiler-error feedback loop.

## Message subset (v1.0)

| Message | We use it for |
| --- | --- |
| `createSurface` | new card / canvas tab. `metadata.placement`: `"chat"` (inline) or `"canvas"` (tab); `metadata.title`; `metadata.demo` |
| `updateComponents` | progressive layout, replacing nodes by id |
| `updateDataModel` | progress steps, live numbers, locking a form (`/locked`) |
| `deleteSurface` | closing a tab (not used in the demo yet) |
| `action` (renderer → agent) | `approve` (context: points, config, expectations), `detect`, `open_canvas` (handled locally) |

Not implemented (not needed for the demo): functions (`@call`), `callRendererFunction`, catalog negotiation, `sendDataModel`. Our catalog id: `https://jojo.vse.cz/a2ui/catalogs/jojo/v1/catalog.json`.

## Why our own renderer, not `@a2ui/react`

`@a2ui/react@0.16.1` exists but needs zod 3 (repo: zod 4), is 0.x with breaking minors, styles via Web Components, and has none of the components we need (charts, tables, KPIs, steps). Our renderer is ~400 lines, follows the v1.0 wire format exactly, so swapping later is cheap. Details: research §8.

## Data flow per surface (live mode)

| Session event | Fetch | Surface |
| --- | --- | --- |
| `status: drafting/generating/detecting` | — | progress card (chat), `Steps` |
| `cascade step.started/done/loop.iteration` | — | `updateDataModel /steps` |
| `status: awaiting_refinement` | `GET artifacts/04_story` | `story` (canvas): timeline, curve preview, editable points, approve |
| `dataset.ready` | `GET datasets/:d/evidence` (+ `compare/:parent`) | `dataset-dN` (canvas), `ready-dN` (chat), `compare-…` |
| `detective.done` | `GET datasets/:d/detective` | `detective-dN` (canvas) |

API gaps (owner: `services/api`): no table-rows endpoint (Tabulky tab empty in live mode), no dataset totals, story-point `strength` not in `04_story`.

## Files

| Path | Role |
| --- | --- |
| `lib/a2ui/protocol.ts` | wire types, constructors (`a2ui.create/components/data/remove`), `isA2uiMessage` |
| `lib/a2ui/pointer.ts` | JSON Pointer get/set, relative paths in templates |
| `lib/a2ui/store.ts` | pure reducer `applyMessage` + external store (two-way binding `write`) |
| `lib/a2ui/catalog.ts` | component list, `DATA_PROPS`, `validateComponents` |
| `components/a2ui/*` | renderer (`Surface.tsx`, `tree.tsx`, `context.tsx`) and catalog components |
| `lib/chat/{surfaces,mockSource,liveSource,mockData,phrases,types}.ts` | presenter, sources, demo data, copy |
| `components/chat/*` | workspace, composer, thinking, history drawer |

## Adding a component

1. Name in `COMPONENTS` (+ `DATA_PROPS` if it shows numbers) in `lib/a2ui/catalog.ts`.
2. Implementation in `components/a2ui/<group>.tsx`, register in `REGISTRY` (`Surface.tsx`).
3. Styles in `app/a2ui.css` (`.a2-` prefix, tokens only).
4. Props table in [components.md](components.md); example on `/design`; unit test in `tests/unit/a2ui-render.test.tsx`.
