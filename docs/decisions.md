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


## 2026-11-28 — Run-6 follow-up: group story points, resumable A1–A4, kept hypotheses gate A5

- **Decision:** (1) A story point that drives an **unscoped** curve and names neither entity nor segment gets feedback offering both forms, with the model's categorical fields and values (`product.category: ["sportovní","ostatní"]`); a point that names every row of an entity and also a segment is told to drop the entity; a point naming every row no longer also gets a "scope the curve to all of them" error (the two contradicted each other). (2) A1–A4 retries resume: `withSchemaRetry` writes the last rejected answer to `NN_name.rejected-last.json` (keyed by the step's first prompt), and a new run of that step continues at attempt N+1 from it instead of replaying the cached failures. (3) `approve.settings.expectations` (kept hypothesis ids) travel orchestrator → `ports.cascade.run({ expectations })` → `runCascade({ keepExpectations })`; `onlyExpectations` filters the story gate (v1 A5 and causal 4b repairs) and maps error paths back to the full list. The A5 prompt is unchanged, so the default approve keeps its cache keys. An approve with every hypothesis switched off is rejected (422, `settings.expectations`). (4) Store-like entities (`store|shop|branch|prodejna|pobočka|sklad|…`) with a `city` field are labelled by city. (5) Detective scoring: a segment on an entity attribute also accepts the ids of the ≤ 10 entity rows it denotes (never all rows); a broad category stays a group. (6) Detective steps get 3 tries on a timeout (others 2). (7) UI: a rejected approve unlocks the story editor; every hypothesis switched off is caught before sending.
- **Why:** user session 76384e44 ("nový trend v prodeji sportovních bot"): the trend point drove category-share curves; A4 alternated between no entity and all five suppliers for 3 attempts, and "Zkusit znovu" replayed the same three cached answers in milliseconds. Run 6: a switched-off hypothesis still cost 5 A5 attempts. Stores read "Patočková v.o.s. (STO-001)". Run 7: the v1 eval's detective named SUP-001 (the "problémový" supplier) and scored 0; a detective job failed on two 60 s stalls in a row.
- **Who:** integration (agent), run-6 follow-up.
- **Affects:** `services/noiser` (compiler/story `categoryFields`, labels), `services/cascade` (checks, loop, cascade, gate), `services/api` (ports, orchestrator, adapters cascade/fake), `services/dataer/src/store/truth.ts`, `packages/llm` (tries), `services/frontend/lib/chat/liveSource.ts`, `.cache/llm/`. No contract change (`packages/schema` untouched).

## 2026-11-28 — Run-5 follow-up: edited stories, resumable failures, gate misses, detective v2, plausibility

- **Decision:** (1) A story point added in the curve editor names the curve's entity/segment: the frontend copies it from a sibling point, `fillStoryEntities` (noiser) fills it from the curve scope in `edit_artifact` and again before A5, and an edited 04_story whose story refs still fail is rejected with 422 / fails before any A5 call. (2) A failed job keeps `job.json`; `resume` retries it while `state.error` is set (a legacy session without a job retries approve). (3) A5 `acceptGateMisses`: out of attempts but some attempt compiled, passed the checks and ran, it generates from the best such attempt, logs it, and the UI says how many hypotheses fail (evidence shows which). (4) Detective v2: tables overview computed by code in the first prompt, up to 4 queries per step, 8 steps (was 15), "first week of a sustained shift" dating, one finding per cause phase, consequences in the narrative. Scoring unchanged. (5) The compiler rejects a `dateOffset` whose days can exceed min(60, period/3); the gate feedback asks for more records or higher probability over extreme magnitudes. (6) A4/what-if prompts explain the four segment kinds. (7) `@s2d/llm`: per-request timeout (detective 60 s, others 4 min, `LLM_TIMEOUT_MS`) with one retry.
- **Why:** user run "obchod s obovi": two editor-added points had no entity, A5 could not change them and burnt 5 attempts; the same run's edit also moved demand back to normal before a hypothesis window, which no parameter can satisfy. User session 5c1019ac: deliveries 90–150 days late passed every check; the detective took minutes (15 sequential calls with a growing transcript) and scored 50 %/25 % on a re-run. Live: several detective steps stalled for 4–15+ minutes with no timeout.
- **Who:** integration (agent), run-5 follow-up.
- **Affects:** `packages/schema/src/api.ts` (`SessionEvent.at`), `packages/llm`, `services/noiser` (compiler/story, compiler/plausibility, labels), `services/cascade` (cascade, loop, a5_detail, gate, prompts), `services/dataer/src/detective/loop.ts`, `services/api` (orchestrator, `GET /sessions/:id/labels`, `API_FAKE_DELAY_MS`), `services/frontend`, `.cache/llm/`.

## 2026-11-28 — Run-5 follow-up: UI reload keeps the timeline; entity names instead of ids

- **Decision:** every `SessionEvent` carries the server time `at` (optional, epoch ms); the live source handles events strictly in order (a card that needs a fetch is emitted before the next event), resets its state on every start, and starts step timers at the event's `at`. Job errors become a "Zkusit znovu" card in their place in the timeline (plain Czech), not raw text. Read-only texts (curve help, hypotheses, evidence, detective) show entity ids as "Name (STO-001)", with names from `GET /sessions/:id/labels` (engine-generated from seed + entity definition, same names as the data). Editable story point titles stay as written.
- **Why:** user feedback: after a reload the running card and its timer scrolled out of view (fetched cards landed after all progress cards), the generation error sat above the timeline, and users do not know what STO-001 or SUP-001 mean without opening the tables.
- **Who:** integration (agent), run-5 follow-up.
- **Affects:** `packages/schema/src/api.ts`, `services/api`, `services/noiser/src/labels.ts`, `services/frontend/lib/chat/{liveSource,labels}.ts`.

## 2026-11-28 — Run-4 follow-up: lever scope from story entities, curve-shape checks, v1 seed-robust gate

- **Decision:** (1) Causal design: `buildCurves` scopes a lever to the entity ids its story points name (`self.<entity>_id in ids`) when the overlay left it unscoped and every record using the lever has that field before the lever field; otherwise the overlay check (`checkCurveScopes`) asks the agent for a scope. (2) `checkCurveShapes` (noiser, exported; used by the compiler and by A4's `checkStoryPlan`) rejects a `decay` segment whose `to` is the curve baseline while the level before it is not: decay jumps to `to` and returns to the previous level, so it climbs back up. The compiler also rejects a probability param that can exceed 1 (curve max × scale) and one curve as the `p` of several bernoulli fields of one record. (3) The v1 A5 story gate is `seedRobust` (≥ 4/5 of seeds 1..5), like causal.
- **Why:** run 4: the causal lever was unscoped, every supplier got late, the overlay's answer key named SUP-001 and the detective (who saw the data) scored 0. Marketing's "decay to 1" made order volume climb back to campaign level after the campaign (the "second wave"), and `is_active_1..3` multiplied the same curve (p³). Measured without LLM calls: all four run-4 v1 scenarios already pass ≥ 4/5 seeds, so the stricter gate cost them no extra attempt.
- **Who:** integration (agent), run-4 follow-up items 1–3.
- **Affects:** `services/cascade` (causal/curves, causal/overlay, causal/sql, checks, cascade), `services/noiser/src/compiler/validate.ts`, `.cache/llm/` (re-recorded marketing and causal trajectories).

## 2026-11-28 — Run-4 follow-up: period and exports in the API, dataset ids `dat1`…, Anthropic JSON in text

- **Decision:** (1) `GenerationSettings.period {start, end}` (optional) replaces `meta.start/end` of the dataset scenario; the API rejects an approve whose period does not contain every story point and curve segment of `04_story`, before any cascade call. The live editor shows the period picker (agent picks by default; "dnech s časem" = noise `hourJitter`). (2) `GET /sessions/:id/datasets/:d/export?format=xlsx|csv|parquet|duckdb`: observed tables only (never `truth`), written once per dataset and streamed; xlsx and zip are written without dependencies (`services/dataer/src/export`). (3) New datasets are `dat1`, `dat2`, … (`DatasetInfo.id` accepts `d<n>` of older sessions). (4) `@s2d/llm` asks Anthropic models for JSON in text (schema in the system prompt) instead of a forced tool, which Sonnet 5.5 rejects; cache keys are unchanged. (5) The UI shows a what-if comparison as a tab of the new dataset, not as its own panel.
- **Why:** user feedback on run 4: no way to set the dataset length or time granularity after the prompt, no download, "d1" did not read as a dataset, a warning on every LLM call, and a separate compare card for each what-if.
- **Who:** integration (agent), user feedback on the run-4 UI.
- **Affects:** `packages/schema/src/api.ts` (`GenerationSettings.period`, `DatasetInfo.id`), `services/api` (settings, orchestrator, ports, routes, session store), `services/dataer` (export), `packages/llm`, `services/frontend`.

## 2026-11-28 — Run-3 follow-up: A5 repair strategy, causal gate, worker, replayable detective

- **Decision:** (1) A5 edits its **best** rejected attempt (stage reached: schema < compile < check < story gate, then fewest errors), sees the history of all attempts with recurring errors marked, and each failed expectation gets a "lever reach" line (where the levers sit, the process chain to the measured table or its absence). Resume starts from the best attempt. (2) `compileScenario` checks curve scopes on arrival `rate` and derive `p` (a `self.*` scope there never matches). (3) Causal design: hypotheses reached through a branch's success outcome need 5 % (`MIN_CHANGE_DILUTED`), others 10 %; its story gate also demands ≥ 4/5 of seeds 1..5 (`seedRobust`) and 4b gets 3 rounds. v1 keeps the single-seed gate. (4) `Ports.noiser.run` is async; the engine runs in a `worker_threads` worker (same output). (5) The DuckDB sandbox is single-threaded so detective SQL results, and thus the replay, are deterministic. (6) `LLM_CACHE_TRACE` lists the recordings a replay reads.
- **Why:** live run 3: marketing and podpora failed 5 A5 attempts (a silent no-op scope, regressions between attempts); causal fell short by 1.4 points at seed 42 and on seeds 1..5 its sale effect was −1..−5 %; ECONNRESET during engine runs; a podpora replay missed the cache because of row order. Live run 4 ([report](runs/2026-11-28-live-e2e-4.md)): all 4 v1 cases ready on the first approve.
- **Who:** integration (agent), items 1, 3, 4, 5 of the run-3 follow-up.
- **Affects:** `services/cascade` (loop, a5_detail, reach, gate, causal/hypotheses, cascade), `services/noiser` (compiler, worker), `services/api` (ports, adapters), `services/dataer` (sandbox), `packages/llm` (cache trace), `.cache/llm/`.

## 2026-11-28 — Segment story points; detective scores category values

- **Decision:** `StoryPoint.segment = {field, values}` (optional) names a group of records by category values (e.g. customer segment "kampaň"). The compiler (`checkStoryRefs`) demands it on a story point whose curve is scoped by non-id values, instead of an entity (A4 invented CUS-001..005 in live run 3). `writeRun` stores `segment_field` and `segment_values` (JSON) in `truth.story_points`; `TruthPoint.segmentValues`; a point is findable with phase ≥ 1 and an entity id **or** a segment value. `scoreFindings` matches a finding's `entities` against ids (exact) or segment values (case, spacing and quotes ignored); the date window and nearest-point rule stay. The detective prompt says `entities` may hold the category values of a group. Precision stays one match per point: true downstream findings count as unmatched (precision is a lower bound), so the honest-scoring rules of run 2 hold.
- **Why:** marketing ("campaign customers") scored recall 0 although the detective named "kampaň" and the exact date.
- **Who:** integration (agent), item 2 of the run-3 follow-up.
- **Affects:** `packages/schema` (`scenario.ts`, `detective.ts`), `services/noiser/src/compiler/story.ts`, `services/dataer` (store, truth, score, detective prompt), `services/cascade/src/prompts` (A4, causal overlay). Prompt changes change the cache keys of A4, overlay and the detective.

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
