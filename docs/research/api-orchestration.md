# Research: agent UI, long runs over REST, AI SDK 7

Date: 2026-11-27. Scope: A2UI vs alternatives, Hono streaming for long agent runs, AI SDK 7 agent/stream APIs.
Local AI SDK docs root (abbrev. `AIDOCS`): `node_modules/.pnpm/ai@7.0.183_zod@4.6.7/node_modules/ai/docs/`.

## TL;DR recommendations

1. **Skip A2UI for the hackathon.** It is real and current (spec v1.0, `@a2ui/react` 0.16.x), but it targets LLM-composed UIs from a component catalog; our UI is fixed (curve editor, error list, evidence/compare charts). Cost > value in 1 day.
2. **Skip AI SDK generative UI / json-render too.** Plain Next.js pages + Recharts (already a dep) rendering zod-typed artifacts (`scenario`, compiler errors, evidence) = "agent UI" for free. LLM never picks components; it only emits validated config (hard rule 1).
3. **Long runs: `POST /runs` (returns `runId`) + `GET /runs/:id/events` via Hono `streamSSE`.** Poll-free, one-way, auto-reconnect in `EventSource`. No WebSocket.
4. **Persist every event to `runs/<runId>/events.jsonl` with monotonically increasing `id`.** On reconnect read `Last-Event-ID`, replay lines after it, then tail live. Same file = crash resume + demo replay offline.
5. **Run state on disk, in-memory only as a pub/sub fan-out.** Step artifacts already land in `runs/<runId>/NN_name.json` (SPEC.md:61); resume = skip steps whose artifact exists and validates.
6. **Cancel: explicit `POST /runs/:id/cancel` → `AbortController` per run.** Do not tie run lifetime to SSE connection (closing a tab must not kill the cascade). Use `stream.onAbort` only to unsubscribe the listener.
7. **Typed `hc` client cannot type SSE bodies** (`streamSSE` returns bare `Response`). Use `hc` for `POST /runs` + `GET /runs/:id` (JSON), plain `EventSource` for events, parse each `data` with a zod schema from `@s2d/schema`.
8. **AI SDK 7: keep the current `generateText + Output.object` cascade** (`packages/llm/src/client.ts`). Do not adopt `ToolLoopAgent` / `WorkflowAgent` for A1–A5; A5 repair loop = our own `for` loop over compiler errors (deterministic, cache-friendly).
9. **Do NOT add `ai`/`@ai-sdk/react`/`useChat` to the frontend** unless a chat UI is actually needed; UI message stream protocol is SSE anyway and can be served from Hono later if wanted.
10. **Caching stays at the `@s2d/llm` boundary** (key = model+instructions+prompt+schema). `wrapLanguageModel` cache middleware only becomes relevant if we ever run multi-step tool loops.
11. **Conversational HITL: still SSE + POST, not WebSocket** (section 4). One `GET /sessions/:id/events` SSE stream (resumable via `Last-Event-ID`) + typed `hc` `POST /sessions/:id/commands` (`edit|approve|whatif`, zod union). Browser hits `:4000` directly (CORS already on). `@hono/node-ws` is deprecated; WS would also need the new `ws` dep, own reconnect, and fights the CORS middleware.

---

## 1. A2UI

### What it is

- "A2UI (Agent-to-User Interface) is an open-source generative UI framework, complete with a protocol optimized for streaming dynamic user interfaces at low latency, native renderers for web and mobile frameworks, and agent SDKs" — https://raw.githubusercontent.com/google/A2UI/main/README.md (repo now lives at `a2ui-project/a2ui`, see https://raw.githubusercontent.com/a2ui-project/a2ui/main/specification/versions.json).
- Core idea: agent streams **declarative JSON** referencing components from a client-registered **catalog**; "never executable code"; "Agents place only components you registered" — https://a2ui.org/.
- Agent side: catalog → prompt/skill → model output → compiler & validator → wire messages — https://a2ui.org/concepts/overview/.

### Spec version

- `specification/versions.json`: **v1.0 = current**, v0.9.1 / v0.9 = previous, v0.8 deprecated — https://raw.githubusercontent.com/a2ui-project/a2ui/main/specification/versions.json, https://raw.githubusercontent.com/a2ui-project/a2ui/main/typescript/renderers/react/README.md.
- Each wire message: JSON object with `"version"` (`"1.0"`, or `"v0.9"`/`"v0.9.1"`) and exactly one message key — https://a2ui.org/concepts/messages/.

### Message format

Agent → renderer (https://a2ui.org/concepts/messages/):

| Message | Purpose |
|---|---|
| `createSurface` | allocate surface (`surfaceId`, optional `catalogId`, `sendDataModel`, inline initial `components`/`dataModel` in v1.0) |
| `updateComponents` | flat component list with ids, `child`/`children` refs; `root` is the entry |
| `updateDataModel` | data at JSON Pointer paths; components bind via `{"@path": "/title"}` |
| `deleteSurface` | unmount + free state |

Renderer → agent: `action` (user triggered `action.event`; bindings in `context` resolved against local data model before sending) — https://a2ui.org/concepts/messages/. Data model = per-surface JSON, RFC 6901 pointers — https://a2ui.org/concepts/data-binding/.

Example (v1.0) from https://a2ui.org/concepts/overview/:
```json
{"version":"1.0","createSurface":{"surfaceId":"flight-booking-surface","catalogId":"https://example.com/catalogs/travel/v1/catalog.json"}}
{"version":"1.0","updateComponents":{"surfaceId":"flight-booking-surface","components":[{"id":"root","component":"Card","child":"layout_col"}, ...]}}
```

### Transport

- Transport-agnostic: "can be sent over a variety of transports, including A2A and MCP" — https://a2ui.org/concepts/messages/. Architecture diagram lists **AG-UI · A2A · MCP · WebSockets** — https://a2ui.org/concepts/overview/. Nothing forces A2A; a stream of JSON messages over SSE from Hono would work.
- Python agent SDK packages: `a2ui-core`, `a2ui-agent-sdk`, `a2ui-a2a`, `a2ui-adk` — README above. No TS agent SDK equivalent of the Python compiler listed besides `@a2ui/web_core` ("Protocol messages, state management, expressions, and basic catalog shared by renderers and `@a2ui/agent`").

### Renderers (npm)

| Package | Latest (npm registry, checked 2026-11-27) |
|---|---|
| `@a2ui/react` | 0.16.1 (2026-11-23), 19 versions |
| `@a2ui/web_core` | 0.16.1 |
| `@a2ui/lit` | 0.16.0 |
| `@a2ui/angular` | listed — https://a2ui.org/ |

Also Flutter, SwiftUI, Compose — https://a2ui.org/. `@a2ui/react` renders v0.9, v0.9.1, v1.0; usage `MessageProcessor` (from `@a2ui/web_core`) + `<A2uiSurface>` + `basicCatalog` — https://raw.githubusercontent.com/a2ui-project/a2ui/main/typescript/renderers/react/README.md.
**Maturity:** pre-1.0 package versions (0.x), frequent releases; protocol v1.0 current. Usable, but API churn likely.

### Fit with Next.js 16 + Hono

- Technically fine: `@a2ui/react` is a client component; Hono route could stream A2UI JSON messages over SSE; LLM would emit catalog-constrained JSON (zod-validatable).
- Mismatch with our needs: our screens are known up front. A2UI's value is the model *composing* layouts. We'd still have to write custom catalog components for the curve editor and charts (basic catalog has no chart/editable curve), plus learn binder/catalog APIs. ~half a day for zero demo-visible gain.

### Alternatives

- **AI SDK generative UI**: tool call → tool part `tool-<name>` with states `input-available` / `output-available` / `output-error` → render React component with `part.output` (`AIDOCS/04-ai-sdk-ui/04-generative-user-interfaces.mdx`). Needs `useChat` + chat-shaped API; good if we want a chat box, overkill otherwise.
- **Custom data parts** (`data-<name>`, reconcilable by `id`, `transient` option) via `createUIMessageStream` / `writer.write` — `AIDOCS/04-ai-sdk-ui/20-streaming-data.mdx`. Nice for progress ("A3 running…") inside a chat.
- **json-render** (Vercel Labs): `defineCatalog` with zod component definitions + `defineRegistry` + `Renderer`; React/Vue/Svelte/RN renderers, AI SDK integration — https://raw.githubusercontent.com/vercel-labs/json-render/main/README.md. `@json-render/core` 0.23.2 (npm). Same mismatch as A2UI: LLM-composed layouts.

### Recommendation (1-day hackathon)

Fixed React components fed by zod-typed artifacts:
- **Curve editor**: Recharts `LineChart` over `Param` curve segments from `scenario.json`; drag/edit points → local state → `POST /scenarios/:id/compile` → show `{path,message}[]`.
- **Validation errors**: list of compiler errors (already `{ path, message }[]`, AGENTS.md conventions), highlight curve by path.
- **Evidence / compare**: Recharts bars/lines from `evidence` / `compare` JSON.
- "Agent-ness" = live run timeline over SSE (section 2) showing each A1–A5 artifact as it lands. That's the demo.
Revisit A2UI only if a "the agent decides what dashboard to show" feature is wanted post-hackathon.

---

## 2. Long agent runs over REST in Hono

### Options

| | SSE (`streamSSE`) | WebSocket | Polling |
|---|---|---|---|
| Direction | server→client | both | client pull |
| Reconnect | built into `EventSource` + `Last-Event-ID` | manual | trivial |
| Hono support | `hono/streaming` | `@hono/node-ws` (extra dep) | plain JSON route |
| Fit | **best** (run progress is one-way; commands go via POST) | overkill | OK fallback |

### Hono SSE API (hono 4.13.23, local)

- `streamSSE(c, cb, onError?) => Response` — `node_modules/.pnpm/hono@4.13.23/node_modules/hono/dist/types/helper/streaming/sse.d.ts:14`.
- `stream.writeSSE({ data, event, id })`, `stream.aborted`, `stream.sleep(ms)`, `stream.onAbort(cb)` — https://hono.dev/docs/helpers/streaming.
- Errors thrown inside the callback do **not** reach `app.onError` (stream already started); use the 3rd arg — https://hono.dev/docs/helpers/streaming. Our `app.onError` in `services/api/src/app.ts` won't cover SSE routes.

### Reconnect with Last-Event-ID

- On reconnect, `EventSource` sends `Last-Event-ID` header with the last `id` seen — https://html.spec.whatwg.org/multipage/server-sent-events.html (§9.2.4). Empty `id:` resets it (§9.2.6).
- Send a comment line every ~15 s against proxies dropping idle connections (§9.2.7).
- Pattern:

```ts
// services/api/src/routes/runs.ts (sketch)
app.get("/:id/events", (c) => streamSSE(c, async (s) => {
  const after = Number(c.req.header("Last-Event-ID") ?? -1);
  for (const ev of readEvents(runId)) if (ev.seq > after) await s.writeSSE({ id: String(ev.seq), event: ev.type, data: JSON.stringify(ev) });
  const off = bus.subscribe(runId, (ev) => s.writeSSE({ id: String(ev.seq), event: ev.type, data: JSON.stringify(ev) }));
  s.onAbort(off);                       // only unsubscribe; run keeps going
  while (!s.aborted && !isDone(runId)) await s.sleep(15_000).then(() => s.write(": ping\n\n"));
}));
```

### Abort / cancellation

- `stream.onAbort` fires on client disconnect — https://hono.dev/docs/helpers/streaming. `c.req.raw` is a standard `Request`; its `.signal` likewise reflects disconnect.
- AI SDK pattern forwards request signal as `abortSignal` to cancel the model call — `AIDOCS/06-advanced/02-stopping-streams.mdx`. **But** AI SDK itself warns: with resumable streams, client aborts = disconnects and should not cancel generation; use a dedicated stop endpoint — `AIDOCS/04-ai-sdk-ui/03-chatbot-resume-streams.mdx`.
- So: `const runs = new Map<string, AbortController>()`; `POST /runs/:id/cancel` → `abort()`; cascade checks `signal.aborted` between steps and passes `abortSignal` into `generateText` (needs a small `@s2d/llm` option; ask owner).

### Run state: memory vs runs/<runId>/

- In-memory only = lost on crash/`tsx watch` reload (dev server restarts on every save!). Bad.
- Disk (recommended): `runs/<runId>/status.json` (`queued|running|done|failed|cancelled`, current step), `events.jsonl` (append-only, `seq`), `NN_name.json` artifacts (already planned, SPEC.md:61).
- Resume after crash: on boot, runs with `status=running` → mark `failed` (or re-run from first missing artifact; each step is cached by `@s2d/llm`, so re-running completed steps is free and offline-safe).
- In-memory `EventEmitter` only to push live events to open SSE listeners.
- Comparable upstream approaches: AI SDK resumable streams need `resumable-stream` + Redis (`AIDOCS/04-ai-sdk-ui/03-chatbot-resume-streams.mdx`); `WorkflowAgent` needs the Workflow runtime (`AIDOCS/03-agents/07-workflow-agent.mdx`). Both too heavy; JSONL file gives the same property for one process.

### Typed hono client (hc) and SSE

- `hc` infers types from `c.json(...)` responses (https://hono.dev/docs/guides/rpc); `streamSSE` returns plain `Response` (d.ts above) → no event typing.
- Use: `api.runs.$post()` (typed) → `new EventSource(\`${API_URL}/runs/${id}/events\`)` → `RunEvent.parse(JSON.parse(e.data))` with `RunEvent` zod union in `@s2d/schema` (`run.ts`; schema change → ask owner).
- CORS: `services/api/src/app.ts` already sets `cors({ origin })`; `EventSource` cross-origin works with that (no credentials).

---

## 3. AI SDK 7 (local docs, ai@7.0.183)

### Breaking changes relevant to us (`AIDOCS/08-migration-guides/23-migration-guide-7-0.mdx`)

- Node ≥ 22, ESM only.
- `system` → `instructions` (our client already uses `instructions`, `packages/llm/src/client.ts`).
- `experimental_output` removed → `output: Output.object({ schema })`, read `result.output` (we already do).
- `stepCountIs` → `isStepCount`.
- `onFinish` → `onEnd`, `onStepFinish` → `onStepEnd`; `experimental_telemetry` → `telemetry`.
- `StreamTextResult.fullStream` → `stream`; `result.toUIMessageStreamResponse()` etc. deprecated → stateless `toUIMessageStream({ stream: result.stream })` + `createUIMessageStreamResponse({ stream })`.
- Multi-step result props now cover all steps; final-step props moved to `finalStep`.
- `needsApproval` on `tool()` deprecated (for `generateText`/`streamText`/`ToolLoopAgent`) → `toolApproval: { tool: 'user-approval' }`.
- `experimental_context` → tool `context` + `runtimeContext`.

### ToolLoopAgent (`AIDOCS/03-agents/02-building-agents.mdx`, `07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx`)

- `new ToolLoopAgent({ model, instructions, tools, stopWhen, output, prepareStep, toolApproval })`; `.generate()`, `.stream()`.
- Default `stopWhen: isStepCount(20)`. Loop ends on: non-tool-call finish, tool without `execute`, approval needed, or stop condition.
- In-memory; "Lost on crash" (`AIDOCS/03-agents/07-workflow-agent.mdx` comparison table).

### WorkflowAgent — exists

- Package `@ai-sdk/workflow` (+ `workflow@5` runtime); replaces `DurableAgent` from `workflow/ai` — `AIDOCS/03-agents/07-workflow-agent.mdx`, `AIDOCS/07-reference/04-ai-sdk-workflow/01-workflow-agent.mdx`.
- Durable: tools marked `'use step'` become retried/persisted workflow steps; approvals survive suspension; `stream({ messages, writable: getWritable<ModelCallStreamPart>() })`; route uses `start(chat, [messages])` + `createModelCallToUIChunkTransform()`; client `WorkflowChatTransport` auto-reconnects via `GET {api}/{runId}/stream` (`AIDOCS/04-ai-sdk-ui/21-transport.mdx`).
- Verdict: needs the Workflow runtime/directives (Next/Vercel-oriented); new deps; not worth it for a 1-day build.

### Stop conditions (`AIDOCS/03-agents/04-loop-control.mdx`)

- Built-ins: `isStepCount(n)`, `hasToolCall('a','b')`, `loopFinished` (ref files `70-is-step-count.mdx`, `71-has-tool-call.mdx`, `72-loop-finished.mdx`). Array = stop when any matches.
- Custom: `const c: StopCondition<typeof tools> = ({ steps }) => boolean` (e.g. token budget).
- Also `prepareStep` (per-step model/tools/messages), steering messages, manual loop.

### Structured output

- `generateText({ output: Output.object({ schema }) })` → `result.output` (current `@s2d/llm`). Also `Output.array`, `Output.choice`, `Output.text` — `AIDOCS/03-ai-sdk-core/10-generating-structured-data.mdx`, `AIDOCS/04-ai-sdk-ui/08-object-generation.mdx`.
- Streaming partials: `streamText({ output: Output.object(...) }).partialOutputStream` (async iterable of partial objects); `elementStream` for `Output.array` (each element complete + validated) — `AIDOCS/03-ai-sdk-core/10-generating-structured-data.mdx`.
- Client: `useObject({ api, schema })` from `@ai-sdk/react`; server returns `createTextStreamResponse({ stream: toTextStream({ stream: result.stream }) })` — `AIDOCS/04-ai-sdk-ui/08-object-generation.mdx`.
- For us: partial streaming conflicts with the disk cache (cache stores final raw output). If we want "typing" effect in demo, replay cached output via `simulateReadableStream` — not worth it.

### Human-in-the-loop (`AIDOCS/03-agents/06-tool-approvals.mdx`)

- `toolApproval: { toolName: 'user-approval' | fn }` on call/agent; loop pauses; UI part `state: 'approval-requested'`; client `addToolApprovalResponse({ id, approved })` with `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`. Optional signed approvals (`experimental_toolApprovalSecret`).
- For us: HITL = "user edits curve, clicks Recompile/Continue" → a plain REST call. No SDK approval machinery needed.

### UI message streams and Hono

- Protocol = **SSE**, header `x-vercel-ai-ui-message-stream: v1`, events like `data: {"type":"text-delta",...}`, custom `data-<name>` parts — `AIDOCS/04-ai-sdk-ui/50-stream-protocol.mdx`.
- `createUIMessageStream({ execute: ({ writer }) => { writer.write({ type: 'data-x', id, data }); writer.merge(toUIMessageStream({ stream: result.stream })) } })` + `createUIMessageStreamResponse({ stream })` returns a Web `Response` — `AIDOCS/04-ai-sdk-ui/20-streaming-data.mdx`. Hono handlers can return any `Response`, so `return createUIMessageStreamResponse(...)` works as-is.
- `createAgentUIStreamResponse({ agent, uiMessages, abortSignal })` "for ... Next.js, Express, **Hono**" — `AIDOCS/07-reference/01-ai-sdk-core/18-create-agent-ui-stream-response.mdx`; `pipeAgentUIStreamToResponse` for Node `ServerResponse` (Hono node adapter) — `18-pipe-agent-ui-stream-to-response.mdx`.
- Transports: `DefaultChatTransport` (HTTP), `WebSocketChatTransport`, `DirectChatTransport`, `WorkflowChatTransport` — `AIDOCS/04-ai-sdk-ui/21-transport.mdx`.
- Resume: `useChat({ resume: true })` + GET `/api/chat/[id]/stream` + `resumable-stream` + Redis — `AIDOCS/04-ai-sdk-ui/03-chatbot-resume-streams.mdx`.
- Option if team wants it later: emit our run events as `data-run-step` parts over this protocol and use `useChat`'s `onData`. Costs: adds `ai` + `@ai-sdk/react` to frontend (dep approval), chat-shaped state. Plain SSE is simpler.

### Disk caching (`AIDOCS/06-advanced/04-caching.mdx`, `AIDOCS/07-reference/01-ai-sdk-core/60-wrap-language-model.mdx`)

- `wrapLanguageModel({ model, middleware })`; `LanguageModelV4Middleware` with `specificationVersion: 'v4'`, `wrapGenerate({ doGenerate, params, model })` and `wrapStream` (cache stream parts, replay with `simulateReadableStream`). Key should include `model.provider`, `model.modelId`, `params`. Rehydrate `response.timestamp` as `Date`.
- Current `@s2d/llm` (`packages/llm/src/client.ts`, `cache.ts`): caches at request level (model+instructions+prompt+JSON schema), stores raw output, re-parses with zod, `LlmCacheMiss` in offline mode, injectable `Generate` for tests. This is simpler and already deterministic → **keep**.
- Middleware becomes the right tool only if we adopt tool loops (each step = separate model call, params include prior tool results). Then: a file-backed `wrapGenerate` middleware in `@s2d/llm`, honoring `LLM_OFFLINE`.

### Fit with packages/llm

- `createLlm().object({ schemaName, schema, instructions, prompt, model })` → `generateText` + `Output.object` (`packages/llm/src/client.ts`). Models via `@ai-sdk/anthropic` / `@ai-sdk/openai`, `LLM_MODEL` = `anthropic:<id>|openai:<id>` (`packages/llm/src/env.ts`).
- Small additive changes worth asking for: optional `abortSignal` in `ObjectRequest` (cancellation), optional `onEvent` hook in cascade for SSE progress. No new deps.

---

## 4. Conversational transport (WebSocket vs SSE+POST)

Context: first request = prompt only; then one long-lived session: server streams agent progress + proposals (story-point timeline), client sends edits / "approve" / "what-if"; server re-runs pipeline parts and streams results. Local versions: `hono@4.13.23`, `@hono/node-server@2.1.11`, `next@16.4.6`.

### 4.1 WebSocket in Hono on Node

- **`@hono/node-ws` is deprecated.** Latest `1.3.2` (npm, published 2026-11-21); its README: "This package is deprecated. Node.js Adapter v2 (`@hono/node-server`) now provides built-in WebSocket support via its own `upgradeWebSocket`" — https://registry.npmjs.org/@hono/node-ws (tarball README). Hono docs: "`@hono/node-ws` is deprecated" — https://hono.dev/docs/helpers/websocket.
- Old API (reference only): `const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })`; `const server = serve(app); injectWebSocket(server)` — same README.
- Current API: `import { serve, upgradeWebSocket } from '@hono/node-server'` + `new WebSocketServer({ noServer: true })` from `ws`, passed as `serve({ fetch: app.fetch, websocket: { server: wss } })` — https://raw.githubusercontent.com/honojs/node-server/main/README.md (§ WebSocket). Installed `@hono/node-server@2.1.11` already exports `upgradeWebSocket` and the `websocket?` serve option (`dist/index.d.mts`).
- **Needs a new dep:** "install `ws` (and `@types/ws`) in your project" — node-server README. `ws` is not in our `node_modules/.pnpm` (only a devDependency of node-server) → dependency approval (AGENTS.md).
- Handler: `upgradeWebSocket((c) => ({ onOpen, onMessage(evt, ws), onClose, onError }))`; `ws: WSContext` with `send(string|ArrayBuffer|Uint8Array)`, `close(code?, reason?)`, `readyState`; `evt.data: string | Blob | ArrayBufferLike` (untyped) — `hono/dist/types/helper/websocket/index.d.ts`.
- **Gotcha (CORS):** "If you use middleware that modifies headers (e.g., applying CORS) on a route that uses WebSocket Helper, you may encounter an error saying you can't modify immutable headers" — https://hono.dev/docs/helpers/websocket. Our `app.use("*", cors(...))` (`services/api/src/app.ts:16`) covers every route → would need path scoping.
- **`hc` `$ws()`:** supported ("Handlers defined with WebSocket Helper support RPC mode", `client.ws.$ws()`) — https://hono.dev/docs/helpers/websocket. Type: `$ws: (args?: I) => WebSocket`, only for routes with `outputFormat: 'ws'` — `hono/dist/types/client/types.d.ts:95`. Only `param`/`query` typed; returns a **plain DOM `WebSocket`**, message payloads untyped (client rewrites protocol to `ws`, calls `new WebSocket(url)` — `hono/dist/client/client.js:115-126`). Zod-parse every message yourself.
- **No reconnect/resume built in.** DOM `WebSocket` has only `send/close` + `open/message/error/close` events — https://developer.mozilla.org/en-US/docs/Web/API/WebSocket. No `Last-Event-ID` equivalent → own seq + "resume from N" message. MDN also: no backpressure (same page).

### 4.2 SSE + POST vs WebSocket for chat-like HITL

| | SSE stream + POST commands | WebSocket |
|---|---|---|
| Reconnect | automatic; `retry:` sets delay; `Last-Event-ID` carries last `id` — [MDN SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events), WHATWG §9.2.4 | manual (4.1) |
| Ordering | one ordered stream, `id` = seq, replay from `events.jsonl` (section 2); each POST returns an ack, results arrive on the stream | one ordered socket; still needs own seq for resume |
| Typing | commands fully typed via `hc` (`zValidator` + `c.json`); events = zod union over untyped `EventSource` | `$ws()` untyped both ways |
| Deps | none (`hono/streaming` is in `hono`) | `ws` + `@types/ws` |
| Testing | `app.request('/sessions/x/events')` gives a `Response`, read `res.body` in vitest; commands via `testClient` (needs chained routes — https://hono.dev/docs/helpers/testing) | `app.request`/`testClient` can't upgrade (`$ws` calls `new WebSocket`, client.js:122-126) → real listening server + WS client in tests |
| Conn. limit | HTTP/1.1: 6 per browser+domain across all tabs, "Won't fix" in Chrome/Firefox — MDN SSE page. One stream per tab = fine; never one per panel | 1 socket, outside that pool |

- HITL here = "command → server recomputes → push result": request/response + one-way push, i.e. SSE + POST. WS wins for high-rate duplex (typing, cursors); we have none.
- Section-2 rules still hold: session lifetime independent of connection; `stream.onAbort` only unsubscribes; heartbeat comment ~15 s.

### 4.3 Proxy via Next.js vs browser → :4000

- **Rewrites to an external URL proxy HTTP and WS upgrades.** Router-server `upgradeHandler` resolves rewrites for upgrade requests and calls `proxyRequest(req, socket, parsedUrl, head)`; `proxyRequest` uses `httpxy` `ProxyServer({ ws: true, changeOrigin: true, proxyTimeout })` — `next/dist/server/lib/router-server.js:730-800`, `next/dist/server/lib/router-utils/proxy-request.js`. Upgrades to app/pages paths unsupported ("TODO: allow upgrade requests to pages/app paths? this was not previously supported", router-server.js) → **route handlers cannot terminate a WebSocket**.
- **Timeout risk:** rewrite proxy uses `proxyTimeout || 30000` ms (`experimental.proxyTimeout`) — proxy-request.js. Long SSE/WS through a rewrite may be cut unless heartbeats < 30 s or the option is raised.
- **Compression risk:** "Next.js uses `gzip` to compress rendered content and static files when using `next start`" — https://nextjs.org/docs/app/api-reference/config/next-config-js/compress. Gzip can buffer `text/event-stream`; not verified for proxied rewrites → if proxying, set `compress: false` and test.
- Route handler as manual proxy can return a streamed `Response` (§ Streaming, `ReadableStream`) — https://nextjs.org/docs/app/api-reference/file-conventions/route. OK for SSE passthrough, not WS. Extra hop + abort plumbing, no gain.
- **Direct `:4000` with CORS (recommended):** `cors({ origin })` already set (`services/api/src/app.ts:16`); `EventSource` cross-origin without credentials works with it (section 2). No proxy, no buffering surprises. One `NEXT_PUBLIC_API_URL` for `hc` + `EventSource`.

### 4.4 Recommendation (1 day, ~4 devs)

1. **SSE + POST, no WebSocket.** No new dep, resume for free (`Last-Event-ID` + `events.jsonl`), testable in-process.
2. Routes in one chained `routes/sessions.ts`:
   - `POST /sessions` `{prompt}` → `{sessionId}` (starts cascade; typed via `hc`)
   - `GET /sessions/:id/events` → `streamSSE`; `SessionEvent` zod union (`agent_progress | proposal | timeline_updated | run_result | error | done`), `id` = seq
   - `POST /sessions/:id/commands` → `SessionCommand` zod union (`edit_story_point | approve | what_if`) → `{accepted, cmdSeq}`; work runs async, results on the stream
3. Server: per-session serial command queue (one promise chain) = ordering guarantee; newer command may `abort()` a running re-run (section 2 `AbortController`). What-if = forked scenario copy → engine → `compare` → `run_result`.
4. Client: one `EventSource` per tab + reducer over events; `hc` for commands; browser → `:4000` directly.
5. Split: A = `SessionEvent`/`SessionCommand` in `@s2d/schema` (owner approval), B = routes + queue + tests, C = timeline/editor UI, D = cascade `onEvent` + partial re-run. Revisit WS only on a real duplex need.
