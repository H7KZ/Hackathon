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

The adapter is [`services/api/src/adapters/dataer.ts`](../../services/api/src/adapters/dataer.ts):
- `store` → `writeRun`. Done.
- `evidence` → sandbox + `runExpectations`. Done, but `series: []`.
- `compare` and `detective` reject with "zatím není implementováno".

Types `DatasetEvidence` and `DetectiveResult` are in `services/api/src/contract.draft.ts`:

```ts
DatasetEvidence = { expectations: ExpectationResult[]; series: { table; points: { day: "YYYY-MM-DD"; value: number }[] }[] }
DetectiveResult = { report: DetectiveReport; score: DetectiveScore }
```

## Tasks (in order)

1. **Integrity check in `store`:** after `writeRun`, verify that every FK resolves. If one doesn't, throw a readable error; the API turns it into an `error` event.
2. **`series`:** a daily time series (row count per day) for every observed table, read only from DuckDB. The UI draws it with Recharts. The shape is the draft above; change it to fit you.
3. **`compare(dbA, dbB)`:** metrics from both DBs (row counts per table, sums of numeric columns, maybe before/after story periods) → `diffMetrics`. The API stores the result in `datasets/dN/compare_<parent>.json`.
4. **`detective(db, { onEvent, signal })`:**
   - LLM through `@s2d/llm` with `list_tables`, `describe_table` and `run_sql` (`guardSql`, `runDetectiveSql`), on `exportSandbox` + `openSandbox` only.
   - Max ~15 calls. Call `signal.throwIfAborted()` between calls.
   - Send `onEvent({ type: "log", message: "SQL: …" })` for every query; the UI shows the query log. If you want your own event type, extend `CascadeEvent`/`SessionEvent` in the draft.
   - `score` = `scoreFindings` against `truth.story_points`. Read those from the **full** DB, not the sandbox.
5. **(Frontend "Data" page) table preview:** add the port `preview(dbPath, table, limit)` and the route `GET /sessions/:id/datasets/:d/tables/:t?limit=` in `services/api/src/routes/sessions.ts`. Agree the shape with the frontend team.

## Done = these pass

- Unit and integration tests in `services/dataer/tests` (real DuckDB in a temp dir).
- `pnpm vitest run services/api` green.
- Through the API: `approve` → `GET …/datasets/d1/evidence` has non-empty `series`. `edit_scenario` → `GET …/datasets/d2/compare/d1` returns metrics. `detect` → `GET …/datasets/d1/detective` returns `score.recall`.

## Watch out for

- `dataer/src/evidence` and `dataer/src/detective` must never import the `@s2d/schema` barrel or the scenario (eslint + dependency-cruiser).
- LLM-written SQL runs **only** on the sandbox. A keyword filter is not a security boundary.
- `compare` gets two paths of **finished** DBs. Don't write to them.
