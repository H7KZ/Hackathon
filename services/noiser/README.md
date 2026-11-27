# @s2d/noiser

Compiler and deterministic engine. Takes a `scenario.json` and a seed and returns in-memory tables in which the story is causally encoded. Persisting them to DuckDB is `@s2d/dataer`'s job (`writeRun`).

```
scenario.json + seed ──► compileScenario (zod, references, DAG) ──► runScenario (day loop) ──► RunResult
```

## Public API

API and CLI need one call:

```ts
import { generate } from "@s2d/noiser";

const result = generate(rawJson, { seed: 42, scale: 1 });
if (result.ok) {
  result.run; // RunResult: { tables, meta, storyPoints } (@s2d/schema/run)
  result.order; // process ids in topological order
} else {
  result.errors; // CompileError[]: { path: "processes[2].source", message: "... what is valid" }
}
```

`generate` does not throw for bad input. Compiler errors, invalid options (`options.seed`, `options.scale`) and engine runtime errors (`EngineError`, e.g. a `self.*` path pointing at a later field) all come back as `{ path, message }`. They are written to be fed back to agent A5. Anything else that throws is a bug.

Lower-level exports: `compileScenario`, `runScenario`, `topoSort`, `evaluateCurve`, `createStream`, `toDay` / `fromDay`, `ENGINE_VERSION`.

| Option  | Default           | Meaning                                                                                                                                                                                                                                                                                                                                                                |
| ------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seed`  | `meta.seed`       | Integer. Same scenario + seed ⇒ identical tables.                                                                                                                                                                                                                                                                                                                      |
| `scale` | `meta.scale ?? 1` | Shrinks entities with `count >= 50` and the total volume of every arrival to ~`scale`. A per-stream rate is divided by how much its `per` entities already shrank, so `per: [customer]` is not scaled twice. Small entity sets (suppliers, stores) are never scaled, so ids like `SUP-002` keep existing. Flow levels and `topUp` targets are absolute and not scaled. |

## Engine semantics

```
generate entities in declaration order          (stream "entity:<name>")
init flow levels for every key combination      (stream "flow:<id>")
for day in [meta.start .. meta.end]:
    apply flow effects scheduled for today      (e.g. late deliveries)
    for process in topological order:           (stream "<processId>")
        arrival: emit records per stream, shuffled within the day
        branch / derive: consume source records due today (record day + lag)
    snapshot flows (end of day)
```

- **Streams.** Every entity, flow and process has its own RNG stream `hash(seed, id)`. Lags (`.fork("lag")`), schedule phases (`.fork("phase")`) and Faker (`.fork("faker")`) use child streams. Editing one process never changes another process's tables (golden test "stream isolation").
- **Fields** are generated in declaration order; `self.<field>` sees only earlier fields. Paths: `day` (ISO date), `self.*`, `source.*` (branch/derive), `key.<entity>` (arrival).
- **Ids.** Entities `<idPrefix>-001`. Process records `<processId>-000001`, one counter per process, so ids are unique per table even when several processes write the same table. Both outcomes of a branch share the branch counter.
- **Params.** A number, or `{ curve, scale? }`: the curve is evaluated at the record's day. If the curve has a `scope`, the scope field is read from the current record; records outside the scope, or without the field yet, get the baseline.
- **Arrival.** One stream per combination of `per` entities, optionally filtered by `where: { "<entity>.<field>": Path }`. With `rate` a stream emits `Poisson(rate × scale)` records per day. With `schedule` it emits on every `everyDays`-th day from its phase (random per stream if `phase: "random"`), one record each, or `Poisson(rate × scale)` if `rate` is also set. Records of one day are emitted in random order, so no entity is always served first from a limited flow.
- **Flows.** `initial` is generated per key combination. Effects resolve `keys`, `delta × sign` and `on` (default: the record's day). Effects with `on` in the future wait until the start of that day, and effects after `meta.end` never apply. `min` is enforced after every change. `snapshot` writes `date, <key>_id…, value` once per key combination per day.
- **Branch.** Each due source record evaluates `cond`, generates the `then` or `else` record (if that outcome is defined), applies its effects immediately and emits it as `<branchId>:then|else`.
- **Derive.** Each due source record yields a child with probability `p`.
- **Faker.** `new Faker({ locale: [cs_CZ, en, base] })` with the stream as randomizer. Names, companies and cities are Czech. Product names fall back to English because cs_CZ has none.
- **Output order.** Entity tables, then process tables in declaration order, then snapshot tables. `meta.scenarioHash` is 16 hex chars over the scenario and effective seed/scale. Use the first 8 in file names.

- **Noise** (optional `noise` block). Applied after the simulation, only to observed tables, so the story is encoded in clean records and noise only degrades what analysts and the detective see. ground_truth tables stay clean. Each table/column has its own stream (`noise:<kind>:<table>#<n>[.<field>]`).
  - `hourJitter: true` adds a `ts` column (`YYYY-MM-DD HH:MM:SS`, record day 08:00–19:59) to observed process tables. DuckDB reads it as TIMESTAMP.
  - `missing: { "<table>.<field>": p }` sets the field to null with probability p. Not allowed on `id` columns.
  - `duplicates: { "<table>": p }` inserts an exact copy (same id) right after the row with probability p.
  - Order per table: `ts`, then `missing`, then `duplicates` (a duplicate copies the nulls and the `ts`). The compiler rejects unknown or ground_truth tables, unknown columns, and an existing `ts` column when `hourJitter` is on.

Purity is lint-enforced in `src/engine/**`: no `Math.random`, wall clock, `process.env`, Node I/O, LLM or DB imports, and no global faker.

## Layout

```
src/
  index.ts              public exports
  generate.ts           compile + run, errors as { path, message }
  compiler/             zod parse, reference checks, DAG (topo order)
  engine/
    run.ts              options, runtime wiring, day loop, RunResult
    types.ts            shared interfaces (Ctx, Runtime, Gen) — keeps imports acyclic
    context.ts          Path resolution, number/date coercion
    params.ts curves.ts Param -> number
    fields.ts           FieldGen + Cond
    entities.ts         EntityStore (generate, lookup, pick)
    flows.ts            FlowStore (levels, scheduled effects, snapshots)
    processes/          arrival.ts, branch.ts, derive.ts, common.ts (Bus, DueQueue, effects, ids)
    noise.ts            data-quality noise on observed output tables
    rng.ts random.ts    streams and distributions
    faker.ts days.ts util.ts errors.ts
```

## Tests

```
pnpm --filter @s2d/noiser test               # all
pnpm vitest run services/noiser/tests/unit   # fast loop
UPDATE_GOLDEN=1 pnpm vitest run services/noiser/tests/golden   # after an intentional engine change
```

- `tests/unit/` — compiler, curves, rng, params, field generators, every process type (mini scenarios in `tests/support/scenarios.ts`).
- `tests/property/` — determinism and `min` over random seeds (fast-check).
- `tests/golden/` — `supplier_delay@42`: determinism, stream isolation, FK integrity, pinned table hashes (`supplier_delay.hashes.json`). Regenerate the hashes only for an intentional change and say why in the commit.

The story check (all `expectations` pass at seed 42 and at ≥ 4/5 seeds of 1..5) needs DuckDB, so it lives in `services/api/tests/integration`.

## Adding a field generator / condition / process type

1. Add it to the zod union in `packages/schema/src/scenario.ts` (contract change: ask the owner first).
2. Add reference checks in `src/compiler/validate.ts`.
3. Implement it in `src/engine/fields.ts` or as `src/engine/processes/<type>.ts` and register it in `run.ts` (`runner()`).
4. Add a unit test with a fixed seed. If `supplier_delay` output changes, update the golden hashes.
