# Handoff: dataer (`services/dataer`: DuckDB, evidence, compare, detective)

Shared rules and the API overview: [README.md](README.md). Contract: SPEC §3.D–F. Isolation: AGENTS.md rule 5.

## Goal

Everything that happens **after** the engine: storage, proof in the data, comparing two runs, and the blind detective. You own the detective's tool loop (D3). The API only starts it and forwards its events.

## What the API calls (`Ports["dataer"]`)

```ts
store(run: RunResult, dbPath: string): Promise<void>                              // + FK integrity
evidence(dbPath: string, expectations: Expectation[]): Promise<DatasetEvidence>    // automatically after store
compare(dbPathA: string, dbPathB: string): Promise<MetricDiff[]>                   // automatically for a counterfactual (parent vs. new)
detective(dbPath: string, opts: { onEvent; signal }): Promise<DetectiveResult>     // only on demand (`detect` command)
```

The adapter is [`services/api/src/adapters/dataer.ts`](../../services/api/src/adapters/dataer.ts). All four ports are real:
- `store` → `storeRun` = `writeRun` + FK integrity check (see "FK inference" below).
- `evidence` → `withSandbox` + `runExpectations` + `dailySeries`.
- `compare` → `compareRuns` (both DBs opened read-only).
- `detective` → `detective()` (tool loop on a sandbox, scored against `truth.story_points` of the full DB).

Types `DatasetEvidence` and `DetectiveResult` are in `services/api/src/contract.draft.ts`:

```ts
DatasetEvidence = { expectations: ExpectationResult[]; series: { table; dateColumn; metric: "rows" | "<col>.sum"; points: { day: "YYYY-MM-DD"; value: number }[] }[] }
DetectiveResult = { report: DetectiveReport; score: DetectiveScore }
```

## Tasks

1. ~~Integrity check in `store`~~ — done (`src/store/integrity.ts`).
2. ~~`series`~~ — done (`src/evidence/series.ts`).
3. ~~`compare(dbA, dbB)`~~ — done (`src/compare/metrics.ts`).
4. ~~`detective(db, { onEvent, signal })`~~ — done (`src/detective/loop.ts`, `src/detective/index.ts`).
5. **(Frontend "Data" page) table preview:** add the port `preview(dbPath, table, limit)` and the route `GET /sessions/:id/datasets/:d/tables/:t?limit=` in `services/api/src/routes/sessions.ts`. Agree the shape with the frontend team. Still open.

## How it works

**FK inference (value-based).** `RunResult` has no FK metadata and FK names don't map to tables (`home_store_id` → `store`, `attempt_id` → `purchase_attempt`). So every `*_id` column of `main` and `truth` (except `truth.run_meta` / `truth.story_points`) must point at a table with an `id` column. Values are compared as text; the target is the table holding most of the column's values, values outside it are dangling. NULLs are allowed (noise `missing`). Consequence: a non-FK column must not end in `_id`. `inferForeignKeys(store)` returns every inferred FK; the real `supplier_delay` run is checked against the golden FK list in `services/api/tests/integration/dataer.real.test.ts`.

**Series.** For every `main` table and every DATE/TIMESTAMP column: `metric: "rows"` (row count per day) and `"<col>.sum"` for every numeric column that is not `id`/`*_id`. Snapshot tables like `stock_daily` have flat row counts; the story is in `value.sum`. Days between first and last date are zero-filled; NULL dates are skipped.

**Compare.** `<table>.rows` and `<table>.<col>.sum` (same column rule as series) for every `main` table → `diffMetrics`.

**Sandbox.** `withSandbox(dbPath, fn)` exports `main` into a unique temp dir, opens it read-only, runs `fn` and removes the copy (and its `.wal`) even when `fn` throws. Use it for every piece of LLM-written SQL; concurrent evidence and detective runs on one DB don't collide.

**Detective action protocol (dataer-internal, not a contract type).** `@s2d/llm` has no tool calling, so each turn is one `llm.object()` with schema `DetectiveStep` = `{ action: { tool: "list_tables" } | { tool: "describe_table", table } | { tool: "run_sql", sql } | { tool: "report", report: DetectiveReport } }` (schemaName `detective_step`). The transcript of earlier actions and results (each capped at 4000 chars) is in the prompt, so the disk cache replays the whole investigation offline. Tool errors (SQL errors, guard rejections, unknown tables) go back to the model as data. One `log` event `SQL: …` per `run_sql`. `signal.throwIfAborted()` before every LLM call. After `maxSteps` (15) actions without a report, one more call with schema `DetectiveReport` (schemaName `detective_report`) forces the report. Scoring reads `truth.story_points` from the full DB via `readTruthPoints` (in `src/store/`), never through the sandbox.

## Done = these pass

- Unit and integration tests in `services/dataer/tests` (real DuckDB in a temp dir).
- `pnpm vitest run services/api` green.
- Through the API: `approve` → `GET …/datasets/d1/evidence` has non-empty `series`. `edit_scenario` → `GET …/datasets/d2/compare/d1` returns metrics. `detect` → `GET …/datasets/d1/detective` returns `score.recall`.

## Watch out for

- `dataer/src/evidence` and `dataer/src/detective` must never import the `@s2d/schema` barrel or the scenario (eslint + dependency-cruiser).
- LLM-written SQL runs **only** on the sandbox. A keyword filter is not a security boundary.
- `compare` gets two paths of **finished** DBs. Don't write to them.
