# Handoff: dataer (`services/dataer`: DuckDB, evidence, compare, detective)

Shared rules and the API overview: [README.md](README.md). Contract: SPEC §3.D–F. Isolation: AGENTS.md rule 5.

## Status

Everything that happens **after** the engine (storage, proof in the data, comparing two runs, the blind detective) is implemented and wired into the API and the cascade.

Done since the first handoff (2026-11-28):

- **Export:** `exportDataset(db, format, outDir)` (`src/export/`): `xlsx` (one sheet per table, own writer, ≤ 1 048 575 rows per sheet), `csv` / `parquet` (DuckDB `COPY`, zipped by `zip.ts`), `duckdb` (the sandbox copy). Observed tables only, never `truth`; an export written once is reused. Port `export`, route `GET …/datasets/:d/export?format=`.
- **Table preview:** `listTables(db)` / `previewTable(db, table, limit)` (`src/preview/tables.ts`), port `tables` / `preview`, routes `GET …/datasets/:d/tables` and `…/tables/:t?limit=` (1–200 rows, ordered by `id`, BIGINT as number). The UI uses them for the dataset totals and the Tabulky tab.
- **CLI:** `pnpm evidence <db> [--scenario f]`, `pnpm compare <a> <b>`, `pnpm detective <db>` work (`services/api/src/cli/inspect.ts`).

## Where it sits

```
noiser ──RunResult──► storeRun ──► db.duckdb ─┬─► withSandbox → runExpectations + dailySeries ──► evidence
                                              ├─► compareRuns (with the parent's db) ──► metric diffs
                                              └─► detective (LLM on a sandbox) ──► report + score
```

Dataer imports only `@s2d/schema` and `@s2d/llm`. It never imports noiser or reads the scenario: the only things it receives are a `RunResult`, a database path and the `Expectation[]`.

## How to plug in

Add `"@s2d/dataer": "workspace:*"` to your `package.json`. Only `api` and `cascade` may import it; the frontend goes over REST.

```ts
import { compareRuns, dailySeries, detective, runExpectations, storeRun, withSandbox } from "@s2d/dataer";
import { createLlm } from "@s2d/llm";

await storeRun(dbPath, run); // replaces an existing file; throws on a dangling FK

const evidence = await withSandbox(dbPath, async (sandbox) => ({
  expectations: await runExpectations(sandbox, expectations),
  series: await dailySeries(sandbox),
}));

const diff = await compareRuns(parentDbPath, newDbPath); // a = parent, b = new; both read-only

const { report, score } = await detective(dbPath, { llm: createLlm(), onEvent, signal });
```

- `runExpectations` never throws for a bad query: that result has `pass: false` and `error`. Its SQL must return rows `period` = `'before'` / `'after'` with a numeric `value`.
- Expectation and detective SQL is LLM-written. Run it **only** on the sandbox from `withSandbox`, never on the full database, which holds the `truth` schema.
- `detective` scores against `truth.story_points` read from the full database, outside the LLM's reach. Only points with `phase >= 1` and an entity count; a finding matches the nearest point for a shared entity, within ±14 days.

## Who calls what

| Caller | Uses | Purpose |
|---|---|---|
| `api/src/adapters/dataer.ts` | `storeRun`, `withSandbox`, `runExpectations`, `dailySeries`, `compareRuns`, `detective` | `Ports["dataer"]` |
| `api/src/cli/gen.ts` | the same adapter | `pnpm gen` |
| `cascade/src/gate.ts` | `storeRun`, `withSandbox`, `runExpectations`, `dailySeries` | story gate in the A5 loop |
| `cascade/tests/evals/gates.ts` | `writeRun`, `exportSandbox`, `openSandbox`, `runExpectations` | evals |

Changing one of these signatures affects the cascade as well as the API.

## What it expects from the input

- Observed tables go to schema `main`, ground truth to `truth`. A table name cannot be both.
- Every `*_id` column must be a real foreign key (see "FK inference").
- Dates must be ISO strings so DuckDB types them DATE / TIMESTAMP; otherwise there is no series for them.
- An empty table needs `columns`.

## Inside the API

```ts
Ports["dataer"] = {
  store(run: RunResult, dbPath: string): Promise<void>;
  evidence(dbPath: string, expectations: Expectation[]): Promise<DatasetEvidence>;
  compare(dbPathA: string, dbPathB: string): Promise<MetricDiff[]>;
  detective(dbPath: string, opts: { onEvent; signal }): Promise<DetectiveResult>;
}
```

Files per dataset, in `runs/<sessionId>/datasets/dN/`:

| File | Written by | When |
|---|---|---|
| `db.duckdb` | `store` | `approve`, `what_if`, `edit_scenario` |
| `evidence.json` | `evidence` | right after `store` |
| `compare_<parent>.json` | `compare(parent, new)` | counterfactuals only |
| `detective.json` | `detective` | only on `{"type":"detect","datasetId":"dN"}` |

The API validates `evidence` and `detective` results with zod before saving them.

### What a client (frontend) reads

| Request | Response |
|---|---|
| `GET /sessions/:id/datasets/:d/evidence` | `DatasetEvidence` = `{ expectations: ExpectationResult[], series: [{ table, dateColumn, metric, points: [{ day, value }] }] }` |
| `GET /sessions/:id/datasets/:d/compare/:other` | `{ diff: MetricDiff[] }`, each `{ metric, a, b, delta, relChange }`; `a` is `:other` (the baseline), `b` is `:d` |
| `GET /sessions/:id/datasets/:d/export?format=xlsx|csv|parquet|duckdb` | the dataset as one file (`Content-Disposition: attachment; filename="jojo-<session8>-<dat1>.<ext>"`) |
| `GET /sessions/:id/datasets/:d/detective` | `{ result: null }` until a `detect` has finished, then `{ result: { report, score } }` |

`DatasetEvidence` and `DetectiveResult` live in `@s2d/schema/api`; `ExpectationResult` and `MetricDiff` are in `@s2d/schema/evidence`.

Events on `GET /sessions/:id/events`:

- After generation: `dataset.ready { datasetId }`. Evidence is stored by then.
- During `detect`: status `detecting`, then `cascade` events with `event: { type: "log", message: "SQL: …" }`, then `detective.done { datasetId }` and status `ready`. Fetch the result with GET; events carry no data.

Failures and cancel:

- A throw from any port becomes an `error` event and the session returns to its last stable state. If `store`, `evidence` or `compare` throws, the dataset is not added to the session.
- Only `detective` receives the `AbortSignal`. A cancel during `store`, `evidence` or `compare` lets them finish, and the dataset can still appear.

### Detective and the LLM

- Needs `ANTHROPIC_API_KEY` (or the key for the provider in `LLM_MODEL`). Per-call overrides: `LLM_MODEL_DETECTIVE_STEP`, `LLM_MODEL_DETECTIVE_REPORT`.
- Up to 8 steps (`DETECTIVE_MAX_STEPS`), plus one forced report. The first prompt already holds every main table (columns, row count, date ranges, 2 sample rows; `overviewOf`), and one `run_sql` step may carry up to 4 `queries`. Live (run 6): 4–6 calls and 31–71 s per investigation, was 12 calls and up to 6 minutes.
- `@s2d/llm` cuts a detective request after 60 s and retries it once (stalled connections happened live); `LLM_DEBUG=1` prints one timing line per request.
- `LLM_OFFLINE=1` works only if the cache holds this exact investigation. The prompts contain query results, so different data or a different model is a cache miss (`LlmCacheMiss`). The recorded demo is described in [run #2](../runs/2026-11-27-live-e2e-2.md).
- The adapter creates the LLM client on first use; pass your own with `dataerPort({ llm })` in tests.

## How it works

**FK inference (value-based).** `RunResult` has no FK metadata and FK names don't map to tables (`home_store_id` → `store`, `attempt_id` → `purchase_attempt`). So every `*_id` column of `main` and `truth` (except `truth.run_meta` / `truth.story_points`) must point at a table with an `id` column. Values are compared as text; the target is the table holding most of the column's values, values outside it are dangling. NULLs are allowed (noise `missing`). Consequence: a non-FK column must not end in `_id`. `inferForeignKeys(store)` returns every inferred FK; the real `supplier_delay` run is checked against the golden FK list in `services/api/tests/integration/dataer.real.test.ts`.

**Series.** For every `main` table and every DATE/TIMESTAMP column: `metric: "rows"` (row count per day) and `"<col>.sum"` for every numeric column that is not `id`/`*_id`. Snapshot tables like `stock_daily` have flat row counts; the story is in `value.sum`. Days between first and last date are zero-filled; NULL dates are skipped.

**Compare.** `<table>.rows` and `<table>.<col>.sum` (same column rule as series) for every `main` table → `diffMetrics`.

**Sandbox.** `withSandbox(dbPath, fn)` exports `main` into a unique temp dir, opens it read-only, runs `fn` and removes the copy (and its `.wal`) even when `fn` throws. Concurrent evidence and detective runs on one DB don't collide. The sandbox runs DuckDB with `threads = 1`: the detective's SQL often has `GROUP BY` / `string_agg` without `ORDER BY`, and a thread-dependent row order changed the next prompt and broke the offline replay (run 4).

**Scoring.** `truth.story_points` has `entity_ids` (comma list) and `segment_values` (JSON array, for group stories like customer segment "kampaň"). A finding matches a point when its `entities` contain one of the ids (exact) or one of the segment values (case, spacing and quotes ignored), it starts within ±14 days, and the point is the nearest in time among those it shares an entity with. Only points with phase ≥ 1 and an id or segment value are scored. A segment on an entity attribute (e.g. `self.supplier_profile = ["problémový"]`) also accepts the ids of the entity rows it denotes — the entity table's own `id`, or `<e>_id` next to a `<e>_<attr>` column — when they are at most 10 and not all of them (run 7); a broad category stays a group the detective must name. Precision counts one finding per point, so true downstream findings lower it (a lower bound).

**Detective action protocol (dataer-internal, not a contract type).** `@s2d/llm` has no tool calling, so each turn is one `llm.object()` with schema `DetectiveStep` = `{ action: { tool: "list_tables" } | { tool: "describe_table", table } | { tool: "run_sql", sql } | { tool: "report", report: DetectiveReport } }` (schemaName `detective_step`). The transcript of earlier actions and results (each capped at 4000 chars) is in the prompt, so the disk cache replays the whole investigation offline. Tool errors (SQL errors, guard rejections, unknown tables) go back to the model as data. One `log` event `SQL: …` per `run_sql`. `signal.throwIfAborted()` before every LLM call. After 15 actions without a report, one more call with schema `DetectiveReport` (schemaName `detective_report`) forces the report.

## How to check

```
pnpm vitest run services/dataer services/api
```

Through the API without agent calls (PowerShell: `$env:API_FAKE="cascade"; pnpm dev`; bash: `API_FAKE=cascade pnpm dev`):

```
POST :4000/sessions {"story":"…","company":"…"}       → 201 {sessionId}; wait for awaiting_refinement
POST :4000/sessions/:id/commands {"type":"approve"}   → GET …/datasets/d1/evidence has non-empty series
POST :4000/sessions/:id/commands {"type":"edit_scenario","from":"d1","scenario":{…changed…}}  → GET …/datasets/d2/compare/d1 returns diff
POST :4000/sessions/:id/commands {"type":"detect","datasetId":"d1"}  → GET …/datasets/d1/detective returns score.recall
```

`API_FAKE=cascade` does not fake the detective: `detect` still calls the LLM (paid) or needs a cache hit.

## Rules

- `dataer/src/evidence` and `dataer/src/detective` must never import the `@s2d/schema` barrel or the scenario (eslint + dependency-cruiser).
- LLM-written SQL runs **only** on the sandbox. A keyword filter is not a security boundary.
- `compare` gets two paths of **finished** DBs. Don't write to them.
