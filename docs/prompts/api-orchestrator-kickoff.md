# Kickoff prompt: Story2Data API orchestrator

Paste everything below the line into a new Claude Code session opened in this repo.

---

We're building **Story2Data** for the 4FIS hackathon (FIS VŠE challenge). Deadline is Saturday 28. 11. 2026 12:00, feature freeze 09:00. Working beats perfect.

**First read:** `AGENTS.md` (rules, monorepo map, Definition of done), `SPEC.md` §2–§5 (invariants, pipeline, contract, reference scenario), and `git log`. The scaffold is on branch `scaffold/monorepo`. `pnpm verify` is green. The engine (`services/noiser/src/engine/run.ts`) is not implemented yet; there is a TDD backlog of `it.todo` tests.

## My task in this session

I'm building **`services/api`**, the single backend service that **orchestrates the whole pipeline and every loop between the agents**. It's not microservices. The API calls `@s2d/cascade`, `@s2d/noiser` and `@s2d/dataer` as plain functions. The frontend (`services/frontend`) talks to it over REST through a typed hono client.

## Whiteboard architecture (transcription of our sketch)

```
user ──► prompt ──► system prompt ──► output type ──┐
 ▲  ▲                                                ▼
 │  │                                 agent cascade ⟲ ──config (+ probabilities,──► noiser
 │  │                                   │             relations between attributes)  │
 │  │                                   ▼                                            ▼
 │  │                              research agents                              "Real curve"
 │  │                                   ▼                                            ▼
 │  │                              curve by points                          agent loop for
 │  │                                   ▼                                    causalities ⟲
 │  │                                 a2ui ───────────┐                             │
 │  └──────────────────────────────────────────────── ┘ (user feedback loop)      ▼
 │                                                                            dataer ⟲ ──► visualise ──► a2ui
 └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

How I read it (confirm or correct it while grilling me):

1. **Prompt layer:** the user prompt passes through a system prompt and a defined output type (structured output) and goes into the cascade.
2. **Agent cascade (has its own loop):**
   - research agents (domain, company, realistic distributions)
   - **curve by points:** the story is set as points on a time axis, and the curve is interpolated between them (the sketch at the bottom of the board)
   - **a2ui:** the agent returns UI for the user (show the curve and points, let them edit), and the user sends feedback back into the cascade
   - output: **config** = scenario.json including probabilities and relations between attributes
3. **Noiser:** turns the config into a "real curve" (noise and realistic shape over the points). Then an **agent loop for causalities** checks that the causal chain holds (SPEC A5: compile → engine on a sample → expectations → feedback, max 3 iterations).
4. **Dataer (has its own loop):** DuckDB, evidence, blind detective, compare. Its loop = detective/evidence → feedback.
5. **Visualise → a2ui:** results as agent-generated UI; then back to the user (the outer loop: "change a parameter, regenerate, compare").

## What I want from you (in this order, no code until we agree)

1. **Research** (`/research` skill or a subagent, primary sources):
   - **A2UI**: what it is (Google's agent-to-UI protocol?), the current spec, whether it has a TypeScript/React renderer, and how it would fit with Next.js + Hono. Alternatives if it doesn't fit (AI SDK generative UI / `streamText` + tool → component, JSON-render components).
   - Orchestrating long agent runs over REST: SSE vs WebSocket vs polling in Hono, run state (in-memory vs DuckDB/JSON in `runs/<runId>/`), resume after a crash, cancellation.
   - AI SDK 7 (installed `ai@7`): `ToolLoopAgent` / `WorkflowAgent`, `stopWhen`, streaming structured output. Check the docs in `node_modules/ai/docs` and the migration guide 7.0.
2. **Grill me** (`/grilling` skill) on the decisions until we agree on:
   - which loops exist (cascade ⟲, causality ⟲, dataer ⟲, user ⟲), what ends each one (max iterations, success criterion), and what the feedback is (compiler errors `{path,message}`, failed expectations, detective recall)
   - where the user steps in (human-in-the-loop points), and what the API returns for the UI then (a2ui payload vs plain JSON)
   - the run model: `Run` state machine (states, transitions, events), where it persists, how the frontend follows progress
   - "curve by points": the contract (does it extend `CurveDef` in `packages/schema`, or is it a new artifact?)
   - "probabilities + relations between attributes" in the config: does `scenario.ts` cover it, or does the contract need extending?
3. **Goal loops:** for each loop, define a measurable goal and a stop condition. Write them as acceptance tests (vitest) **before** implementation.
4. **Design the API** (REST routes, SSE events, zod schemas in `packages/schema/src/api.ts`, a `Run` state machine). Present 2–3 variants with a recommendation, and **stop for my approval**.
5. Only then implement it with TDD, small commits, `pnpm verify:fast` after every step.

## Constraints (from AGENTS.md, don't break them)

- The LLM never generates data rows or code, only zod-validated config.
- Engine is pure and deterministic.
- Evidence and detective query only the sandbox DB (`exportSandbox` + `openSandbox`).
- All LLM calls go through `@s2d/llm`, with a cache so the demo runs offline.
- The contract lives only in `packages/schema`.
- Boundaries are enforced by eslint + dependency-cruiser. If they fire, change the design.
- UI text and data in Czech, code in English.

## How we communicate

Be concise. One question at a time while grilling, each with your recommendation. Time estimates in concrete units. At the end of each step: what now works, plus the next step.
