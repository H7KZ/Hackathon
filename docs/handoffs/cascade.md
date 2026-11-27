# Handoff: agent cascade (`services/cascade`)

Shared rules and the API overview: [README.md](README.md). Contract: SPEC §3.A, AGENTS.md "Verification for LLM agents".

## Goal

From `{story, company}`, produce artifacts `01–05` in `runs/<sessionId>/`. **You own all LLM loops**: the A5 repair loop, and the `whatIf` loop for counterfactuals. Report progress through events so the UI can show the agent fixing itself.

## What the API calls (`services/api/src/ports.ts` → `Ports["cascade"]`)

```ts
run(input: SessionInput, opts: { dir; until: ArtifactName; onEvent(e: CascadeEvent); signal: AbortSignal }): Promise<void>
whatIf(question: string, base: Scenario, opts: { onEvent; signal }): Promise<Scenario>
```

- `run` is called **twice**:
  1. `until: "04_story"` right after `POST /sessions`.
  2. `until: "05_scenario"` after `approve`.
  Artifacts already on disk must be reused (that's how `runCascade` works today). The user can edit any artifact; the API then deletes the later ones and calls `run` again.
- `whatIf` must return a scenario that passes `compileScenario`. The API checks it again and rejects it with an `error` event if it doesn't.
- The adapter is [`services/api/src/adapters/cascade.ts`](../../services/api/src/adapters/cascade.ts). It currently maps `onStep` to `step.done`, stops after A4, and rejects `whatIf`.

## Events (`CascadeEvent` in `services/api/src/contract.draft.ts`)

```ts
| { type: "step.started";  step }                  // before an agent starts
| { type: "step.done";     step; cached: boolean }
| { type: "loop.iteration"; step; n; ok; feedback: CompileError[] | string[] }  // every A5/whatIf iteration
| { type: "log";           message }               // free text for the UI timeline (Czech)
```

## Tasks (in order)

1. **`runCascade` options:** add `onEvent` (replaces `onStep`), `signal` and `until: "05_scenario"`. Call `signal.throwIfAborted()` between steps. For cancelling a running LLM call, `@s2d/llm` needs an optional `abortSignal` in `ObjectRequest`; that's a change to `packages/llm`, so **ask its owner**.
2. **A5 `detail` + loop** (SPEC §3.A), max 3 iterations:
   1. `compileScenario`,
   2. `runScenario(..., { scale: 1 })`,
   3. `writeRun` to a temp DB → `exportSandbox`/`openSandbox` → `runExpectations`,
   4. feed the failures back to the agent.

   Emit `loop.iteration` after every iteration. If it still fails after 3, write the last valid scenario and emit a `log` saying it is degraded. The API does not want an exception in that case.
3. **`whatIf(question, base)`:** one agent that edits **parameters only** (curves, `Param`) and keeps the seed and structure, with the same compile/expectations loop as A5.
4. **Adapter:** switch `adapters/cascade.ts` to the new options. Delete the "Krok A5 … chybí" branch.
5. **Evals:** `pnpm evals` offline. Recording with `EVAL_LIVE=1` costs money, so ask first and announce it in the team chat.

## Done = these pass

- `services/cascade/tests/unit/*` with `fakeGenerate`: the events come in the right order; `signal` stops the run between steps; A5 stops after 3 iterations.
- `pnpm vitest run services/api` (goal loops L1–L4) still green.
- The eval gates in AGENTS.md (artifacts validate, `05` compiles, expectations ≥ 4/5 seeds, detective recall ≥ 0.6).

## How to check through the API

```
pnpm dev
POST :4000/sessions {"story":"…","company":"…"}           → watch GET /sessions/:id/events
POST :4000/sessions/:id/commands {"type":"approve"}        → loop.iteration events, then dataset.ready
POST :4000/sessions/:id/commands {"type":"what_if","question":"Co kdyby od května?","from":"d1"}
```

## Watch out for

- The LLM never produces data or code, only config (AGENTS.md rule 1).
- The cache key changes whenever a prompt changes. The demo must run with `LLM_OFFLINE=1`.
- `00_input.json` blocks reusing a run directory with a different story; the API creates a new UUID per session.
