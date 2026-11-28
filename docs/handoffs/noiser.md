# Handoff: noiser (`services/noiser`: compiler + engine)

Shared rules and the API overview: [README.md](README.md). Package docs (engine semantics, layout, tests): [`services/noiser/README.md`](../../services/noiser/README.md). Contract: SPEC §3.B–C, §4.

## Status

The compiler and engine are implemented and wired into the API, the CLI (`pnpm gen`) and the cascade. This document says how the rest of the system plugs into them and what breaks if they change.

Run-5 follow-up (run 6): `fillStoryEntities` (compiler/story) completes a curve-driving story point without entity/segment from its curve's scope; `checkMagnitudes` (compiler/plausibility) rejects a `dateOffset` whose days can exceed min(60, period/3); `entityLabels` (labels.ts) returns entity id → name exactly as the engine generates them for a seed (display only).

Open:

- The "expectations pass at ≥ 4/5 of seeds 1..5" check on `supplier_delay` has no automated test. Only seed 42 is covered.

## Where it sits

```
cascade ──scenario──► compileScenario ──► runScenario ──RunResult──► dataer.storeRun ──► DuckDB ──► evidence / compare / detective
```

Noiser imports only `@s2d/schema`. It never touches DuckDB, the file system, the network or an LLM. The hand-off in is `Scenario` (`@s2d/schema/scenario`), the hand-off out is `RunResult` (`@s2d/schema/run`).

## How to plug in

Add `"@s2d/noiser": "workspace:*"` to your `package.json`. Only `api` and `cascade` may import it (`dataer` may not, the frontend goes over REST).

You have **untrusted JSON** (LLM output, a file, a request body): use `generate`. It compiles, runs, and returns errors instead of throwing for bad input.

```ts
import { generate } from "@s2d/noiser";

const result = generate(raw, { seed: 42 });
if (!result.ok) return result.errors; // CompileError[]: { path, message }
await storeRun(dbPath, result.run); // from @s2d/dataer
```

You already have a **compiled** scenario: use `runScenario`. It does not validate, and throws `EngineError` (`{ path, message }`) on a runtime problem.

```ts
import { compileScenario, runScenario } from "@s2d/noiser";

const compiled = compileScenario(raw);
if (!compiled.ok) return compiled.errors;
const run = runScenario(compiled.scenario, { seed: compiled.scenario.meta.seed });
```

### Options

| Option | Default | Note |
|---|---|---|
| `seed` | `meta.seed` | Same scenario + seed ⇒ identical tables. |
| `scale` | `meta.scale ?? 1` | Keep 1 for anything checked by expectations: flow levels don't scale, so small scales distort the story ([decisions](../decisions.md)). |

## Who calls what

| Caller | Uses | Purpose |
|---|---|---|
| `api/src/adapters/noiser.ts` | `runScenarioInWorker` | every dataset (`Ports["noiser"]`, async) |
| `api/src/orchestrator.ts` | `compileScenario` | before each run, and to validate `05_scenario` edits and `edit_scenario` |
| `api/src/routes/scenarios.ts` | `compileScenario` | `POST /scenarios/validate` → 200 `{ok:true}` or 422 `{ok:false, errors}` |
| `api/src/cli/gen.ts` | `compileScenario`, `runScenario` | `pnpm gen` |
| `cascade/src/gate.ts` | `generateInWorker` | story gate in the A5 loop (worker thread) |
| `cascade/src/loop.ts` | `compileScenario` | repair-loop feedback |
| `cascade/src/cascade.ts` | `checkStoryRefs` | checks the story before A5 exists |

The orchestrator and the routes call `compileScenario` **directly**, not through the port. `API_FAKE=noiser` fakes only the run; compilation stays real.

## Inside the API

```ts
Ports["noiser"] = { run(scenario: Scenario, seed: number): Promise<RunResult> } // engine in a worker thread
```

- `approve`: the seed is `scenario.meta.seed`.
- `what_if` / `edit_scenario`: the new dataset reuses the **parent's** seed, so the comparison shows only the effect of the change.
- The API passes no `scale`, so `meta.scale ?? 1` applies.
- The result goes straight to `dataer.store`. The scenario is saved as `runs/<sessionId>/datasets/dN/scenario.json`.
- The run happens in a `worker_threads` worker (`runScenarioInWorker`, `services/noiser/src/worker/`): one lazily started, unref'd worker that registers the tsx hook and runs `generate` from source. Same tables as the in-process call (`tests/integration/worker.test.ts` checks the golden hashes). Measured on supplier_delay at scale 3 (90 820 rows): engine 1.3 s with at most 15 ms event-loop lag, `storeRun` 1.0 s with at most 69 ms. The story gate (`cascade/src/gate.ts`) uses `generateInWorker` too.
- An `EngineError` during a job reaches the UI as an `error` event with `message` only (no `errors[]`, so the `path` is lost). The session returns to its last stable state.

## What downstream relies on

Changing any of these is a cross-service change, even if all noiser tests pass.

| Output | Who depends on it |
|---|---|
| Table and column names | `expectations[].sql` in scenarios and LLM output |
| `id` on referenced tables; a column ends in `_id` **only** if it is a foreign key | `storeRun` infers and checks FKs by value and rejects the run otherwise; series and compare never sum `id` / `*_id` |
| Dates as ISO `YYYY-MM-DD` strings, `ts` from `hourJitter` | DuckDB types them DATE / TIMESTAMP; daily series are built only from those |
| `visibility: "observed"` / `"ground_truth"` | `main` vs `truth` schema; the detective and expectations see only `main`. One table name cannot be both |
| `columns` on a table with no rows | DuckDB needs it to create the empty table |
| `storyPoints` with `phase >= 1` and `entity.ids` or `segment.values` | the detective's answer key (`truth.story_points.entity_ids`, `segment_values` as JSON); other points are not scored |
| `meta` (`scenarioId`, `seed`, `scenarioHash`, `engineVersion`) | stored in `truth.run_meta` |

Several processes may write the same table; `writeRun` concatenates them.

## When you change the engine

1. Contract changes start in `packages/schema` (owner's approval), then compiler, then engine.
2. If output changes on purpose: bump `ENGINE_VERSION`, regenerate golden hashes (`UPDATE_GOLDEN=1 pnpm vitest run services/noiser/tests/golden`) and say why in the commit.
3. If FK columns change, update the list in `services/api/tests/integration/dataer.real.test.ts` too.
4. Changed data can invalidate the recorded LLM cache: the detective's prompts contain query results, and A5 retry prompts contain gate measurements. Check the offline demo; re-recording costs money, so ask first.
5. New compiler errors must say what is wrong **and** what is valid: agent A5 reads them.

## How to check

```
pnpm vitest run services/noiser services/api
pnpm gen scenarios/supplier_delay.json --seed 42      # writes out/supplier_delay_seed42.duckdb, prints expectations
```

Through the API without an LLM (PowerShell: `$env:API_FAKE="cascade"; pnpm dev`; bash: `API_FAKE=cascade pnpm dev`):

```
POST :4000/sessions {"story":"…","company":"…"}       → 201 {sessionId}; wait for awaiting_refinement
POST :4000/sessions/:id/commands {"type":"approve"}   → dataset d1; GET :4000/sessions/:id/datasets/d1/evidence
POST :4000/sessions/:id/commands {"type":"edit_scenario","from":"d1","scenario":{…changed…}}  → d2, same seed
```

## Rules

- `src/engine/` stays pure: no `Math.random`, wall clock, `fs`, network, LLM or global faker (lint-enforced).
- Randomness only through `rng.ts` streams, one per entity, flow and process, so editing one never reshuffles another.
