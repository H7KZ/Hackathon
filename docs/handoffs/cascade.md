# Handoff: agent cascade (`services/cascade`)

Shared rules and the API overview: [README.md](README.md). Design and what is built: [`docs/cascade-design.md`](../cascade-design.md) (D1–D8). Contract: SPEC §3.A, AGENTS.md "Verification for LLM agents".

## Status (2026-11-28)

The cascade is implemented and wired into the API, the CLI (`pnpm cascade`) and the evals. It has two designs behind one switch:

| Design | Steps | Who writes curves / expectations |
|---|---|---|
| `"v1"` (default) | A1 company → A2 model → A3 influences → A4 story → A5 detail | LLM (A4), checked by code |
| `"causal"` | A1 → A2 → 4a causal map → 4b processes → overlay → expectations → story → scenario | code, from the map and the lever matrix; the LLM writes only SQL |

Both live evals pass on `anthropic:claude-sonnet-5-5` (seed 42, ≥ 4/5 seeds, story gate). Their recordings (16 files in `.cache/llm/`) replay offline in about 11 s:

```bash
LLM_OFFLINE=1 LLM_MODEL_01_COMPANY=anthropic:claude-haiku-5-5 LLM_MODEL_03_INFLUENCES=anthropic:claude-haiku-5-5 pnpm evals
```

Steps 01 and 03 were recorded on Haiku. The cache key includes the model, so the replay needs the same per-step models.

Changed by live run 3 ([report](../runs/2026-11-28-live-e2e-3.md)):

- Flat 04_story curves (no segments) are constants: not demanded by coverage, not checked as levers.
- An unused bending curve is accepted when the story points it bends are already bent by a used curve, or follow one (outcomes emerge through the chain); the story gate still checks the effect.
- The root-rule message names the upstream roots a curve can move to.
- Causal map: a branch needs one positive (success) and one negative (failure) outcome edge.
- **A5 resumes:** running the cascade again after A5 gave up continues at attempt 6, 7, … from the last rejected attempt for the same story (`05_scenario.rejected-N.feedback.json` holds the feedback and a story key). Without this, "Generovat data" again replayed the cached failures.
- The what-if prompt leaves out `meta.id` (the session id), so a recorded what-if replays in any session.

Changed by the run-3 follow-up (run 4):

- A5 edits its **best** rejected attempt (stage reached, then fewest errors), sees the history of all attempts with recurring errors marked, and a failed expectation comes with the lever reach (`reach.ts`). Resume starts from the best attempt.
- The compiler checks curve scopes on arrival `rate` and derive `p` (a `self.*` scope there never matched; marketing's campaign curve stayed at baseline).
- Segment story points (`segment: {field, values}`) replace invented entity ids for group stories.
- Causal: hypotheses on a branch's success outcome (sales) need 5 % (`MIN_CHANGE_DILUTED`), others 10 %.

Open:

- Elektro Novák was re-recorded through the API in run 3 (pinned Sonnet 5.5).
- Podpora (ISP) needs the second "Generovat data" on Sonnet (A5 succeeds at attempt 9); causal design fails its story gate on effect strength. Details in the run 3 report.
- The detective (eval gate 4) is not part of the cascade evals.

## Where it sits

```
{story, company} ──► runCascade ──► runs/<id>/01…05_*.json ──► 05_scenario ──► noiser ──► dataer
                         │  verify = storyGate (noiser generate + dataer evidence on a temp DB)
                         └─ every step and repair iteration ──► CascadeEvent ──► API SSE
```

The cascade imports `@s2d/schema`, `@s2d/llm`, `@s2d/noiser` and `@s2d/dataer`. Every LLM call goes through `@s2d/llm` (disk cache, `LLM_OFFLINE=1`).

## How to plug in

```ts
import { runCascade, storyGate, whatIf } from "@s2d/cascade";

await runCascade(
  { story, company },
  {
    llm,                    // createLlm() from @s2d/llm
    runsDir, runId,         // artifacts go to runsDir/runId/NN_name.json
    until: "04_story",      // optional; must be a step of the design (DESIGN_STEPS)
    design: "v1",           // or "causal"
    verify: storyGate,      // optional story gate; without it a scenario only has to compile
    onEvent, signal,        // progress events; abort is checked between steps and iterations
  },
);
```

- Existing artifact files are **reused**: editing one (`saveArtifact`, `PUT /artifacts/:name`) and running again recomputes only the later steps. `00_input.json` blocks reusing a run dir for another story.
- Failures throw `CascadeStepError` (`step`, readable message) or `CascadeRunMismatch`. `cascade()` in `access.ts` wraps both into `{ ok: false, errors }`.
- `whatIf(llm, question, base, { onEvent, signal })` edits only curves and existing `Param`s, keeps the seed and structure, and returns a compiled scenario or throws `WhatIfFailed`. It has no story gate (a counterfactual need not keep the base story).

### Choosing the design

| Where | How |
|---|---|
| API | `CASCADE_DESIGN=v1\|causal` (`services/api/src/config.ts`), default `v1` |
| CLI | `pnpm cascade "<story>" "<company>" --design causal` (or the same env) |
| Code | `CascadeOptions.design` |

The API calls `run` with `until: "04_story"` (draft) and then `"05_scenario"` (approve). Both names exist in both designs; in `causal`, `04_story` and `05_scenario` are built by code.

## Artifacts

| Name | v1 | causal | Schema (`@s2d/schema/artifacts`) |
|---|---|---|---|
| `01_company` | A1 | A1 | `CompanySpec` |
| `02_model` | A2 | A2 (skeleton for 4b) | `DataModel` |
| `03_influences` | A3 | – | `Influences` |
| `03a_causal_map` | – | 4a | `CausalMap` |
| `03b_processes` | – | 4b (repair loop) | `ProcessesPlan` |
| `04a_overlay` | – | LLM | `StoryOverlay` |
| `04b_expectations` | – | code + LLM (SQL) | `ExpectationsPlan` |
| `04_story` | A4 | code | `StoryPlan` |
| `05_scenario` | A5 (repair loop) | code | `Scenario` |

`ArtifactSchemas` maps every name to its schema. `ArtifactName` order decides which later files a save invalidates.

## Events (`CascadeEvent`, `services/cascade/src/events.ts`)

```ts
| { type: "step.started";  step }
| { type: "step.done";     step; cached: boolean }
| { type: "loop.iteration"; step; n; ok; feedback: CompileError[] | string[] }  // every repair attempt
| { type: "log";           message }                                         // Czech, for the timeline
```

## Repair loops

| Loop | Attempts | Feedback |
|---|---|---|
| A1–A4, 4a, overlay, SQL (`withSchemaRetry`) | 3 | zod issues + step checks (`checks.ts`, `causal/*.ts`) |
| A5 (`repairLoop`, `keepBest`) | 5 | `compileScenario` → story checks → `verify` (+ lever reach); the agent edits its best attempt and sees the history |
| 4b (`repairLoop`) | 3 | `compileScenario` on flat lever curves + `checkTrace` |
| causal 05 → 4b | 2 rounds | `verify` failures go back to 4b; map, overlay, curves and SQL stay |
| whatIf | 3 | `compileScenario` + `checkCurveCoverage` |

## What downstream relies on

- `05_scenario` always passes `compileScenario`; with `verify: storyGate` its expectations also pass at the scenario seed.
- `meta.seed = 42`, `meta.id` derived from the run id, `locale: "cs-CZ"`, no `scale`.
- Expectation SQL reads only observed tables (`checkExpectationTables`); story points about an entity carry `entity.ids`, story points about a group defined by category values (curve scope like `self.customer_segment = ["kampaň"]`) carry `segment: {field, values}` (the detective's answer key; `checkStoryRefs` demands it).

## When you change the cascade

1. A prompt change changes the cache key of that step and of every step whose prompt includes its output. Re-record with `EVAL_LIVE=1 pnpm evals` (paid; ask first, announce it), then commit only the cache files the offline replay reads.
2. Contract changes start in `packages/schema` (owner's approval).
3. Unit tests use `fakeGenerate` from `@s2d/test-utils`; `pnpm verify:fast` must be green.
