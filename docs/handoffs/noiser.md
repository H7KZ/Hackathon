# Handoff: noiser (`services/noiser`: compiler + engine)

Shared rules and the API overview: [README.md](README.md). Contract: SPEC §3.B–C, §4. The TDD backlog is in `services/noiser/tests/unit/engine.test.ts` (`it.todo`).

## Goal

`runScenario(scenario, { seed, scale? }) → RunResult`: pure and deterministic. It is the **only** place where data comes from. The API calls it for every dataset (the original and every counterfactual) with the **same seed** as the parent, so the diff of two runs shows only the effect of the change.

## What the API calls (`Ports["noiser"]`)

```ts
run(scenario: Scenario, seed: number): RunResult     // synchronous, pure
```

- The adapter [`services/api/src/adapters/noiser.ts`](../../services/api/src/adapters/noiser.ts) just calls `runScenario(scenario, { seed })`. If you need `scale`, or an async signature (a worker, for example), change the port per the README rule.
- The input has already passed `compileScenario` in the API: the orchestrator calls it before every `run`.
- The output goes straight to `dataer.store(run, dbPath)` (`writeRun`).
- The cascade (A5) calls it too, directly, with `scale: 1` (see docs/decisions.md).

## Tasks

1. Turn the `it.todo` items in `engine.test.ts` into tests and implement `engine/run.ts` (arrival → branch/derive → flows → tables). Use the `rng.ts` streams `hash(seed, processId)`; never `Math.random` or `Date.now` (eslint enforces this).
2. Golden test for `scenarios/supplier_delay.json` at seed 42 (`tests/golden/`), plus the required tests from AGENTS.md: determinism, stream isolation, integrity.
3. The `supplier_delay` expectations must pass at seed 42 and at ≥ 4/5 of seeds 1..5.
4. Optional: if the meeting's "curve per attribute + noise level" survives, it belongs in the **scenario contract** (`packages/schema/src/scenario.ts`, owner's approval), not in the API.

## Done = these pass

- `pnpm vitest run services/noiser` (unit + property + golden).
- `pnpm vitest run services/api` green (it uses fake ports, so you can't break it as long as the port signature stays the same).
- End to end through the API (below): `approve` ends in `ready` and `dataset.ready`.

## How to check

First without the API: `pnpm gen scenarios/supplier_delay.json --seed 42`.

Then through the API: a fake cascade (no LLM) with the real noiser and dataer:

```powershell
$env:API_FAKE="cascade"; pnpm dev
```
```
POST :4000/sessions {"story":"…","company":"…"}       → awaiting_refinement (the fake cascade writes artifacts from supplier_delay)
POST :4000/sessions/:id/commands {"type":"approve"}   → your runScenario → GET /sessions/:id/datasets/d1/evidence
POST :4000/sessions/:id/commands {"type":"edit_scenario","from":"d1","scenario":{…changed…}}  → d2, same seed
```

## Watch out for

- The engine must not import `fs`, the network, or the LLM.
- `RunResult.storyPoints` goes to `truth.story_points`, which the detective is scored against.
- Several processes may write to the same table; `writeRun` concatenates them.
