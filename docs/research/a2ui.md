# Research: A2UI (agent-to-UI protocol) for the Story2Data chat window

Date: 2026-11-27. Scope: A2UI protocol versions, messages, component model, catalogs, data binding, actions, transport, official renderers, security; fit with Next.js 16 / React 19 / Tailwind v4 / recharts.
Primary sources only: a2ui.org, the official repo, npm registry. The repo moved from `google/A2UI` to **`a2ui-project/a2ui`** (all raw links below use the new path; `google/A2UI` redirects).
Abbrev.: `RAW` = `https://raw.githubusercontent.com/a2ui-project/a2ui/main`, `SPEC1` = `RAW/specification/v1_0/docs/a2ui_protocol.md` (rendered: https://a2ui.org/specification/v1.0-a2ui/).

Supersedes the A2UI part of `docs/research/api-orchestration.md` §1 (that note said "skip A2UI"; this one assumes we now want agent-rendered UI in chat).

## TL;DR

1. **Target A2UI v1.0** (status `current`; v0.9.1/v0.9 `previous`, v0.8 `deprecated`) — `RAW/specification/versions.json`. Envelope `{"version":"1.0", <one of createSurface|updateComponents|updateDataModel|deleteSurface|callRendererFunction|agentFunctionResponse>}`; renderer → agent: `action`, `error`, `callAgentFunction`, `rendererFunctionResponse`.
2. **Official React renderer exists: `@a2ui/react@0.16.1`** (+ `@a2ui/web_core@0.16.1`), published 2026-11-23, peer `react ^17||^18||^19`, **peer/dep `zod ^3.25.76`** (we are on zod 4.6.7) — https://registry.npmjs.org/@a2ui/react. Still 0.x, with breaking changes in minors (0.16.0 "BREAKING CHANGE") — `RAW/typescript/renderers/react/CHANGELOG.md`.
3. **Recommendation: keep the v1.0 wire format, write our own thin React renderer** for a v1.0 subset (adjacency list, `@path` bindings, `ChildList` templates, `action.event`) with zod schemas in `packages/schema`. Reasons: everything we need (charts, tables, KPI, progress) is a *custom* component anyway; basic catalog is Web Components styled by `--a2ui-*` vars, not Tailwind; zod 3 vs 4 mismatch; 0.x churn. ~half a day. Wire-compatible, so swapping to `@a2ui/react` later is possible.
4. **If we do try the official renderer:** timebox ~1 h spike; render in a `'use client'` component (processor is browser state; `injectBasicCatalogStyles()` no-ops under SSR — https://a2ui.org/guides/client-integration.md); load via `next/dynamic` with `ssr:false` to be safe (SSR behaviour not documented → unverified). Needs approval: new dependency (AGENTS.md).
5. **Transport: our existing SSE stream** carries A2UI JSON envelopes as one SSE event each; `action` goes back via `POST /sessions/:id/commands`. Spec is transport-agnostic and lists SSE+JSON-RPC, WebSockets, REST, AG-UI, A2A, MCP (SPEC1 "Transport bindings"). No A2A/AG-UI/CopilotKit needed. LLM still never emits rows/code: the agent (or deterministic code) emits component JSON validated against our catalog; chart *data* comes from DuckDB via `updateDataModel`.

---

## 1. Protocol versions

From `RAW/specification/versions.json` (also published at https://a2ui.org/specification/versions.json):

| Version | Status | Spec |
|---|---|---|
| v1.0 | **current** | https://a2ui.org/specification/v1.0-a2ui/ |
| v0.9.1 | previous | https://a2ui.org/specification/v0.9.1-a2ui/ |
| v0.9 | previous | https://github.com/a2ui-project/a2ui/tree/main/specification/v0_9 |
| v0.8 | deprecated | https://github.com/a2ui-project/a2ui/tree/main/specification/v0_8 |

So the premise "v0.8 stable / v0.9 draft" is outdated: v1.0 is current. Nothing newer than v1.0 in `versions.json`; there are proposals (e.g. `specification/proposals/express/`, a compact "A2UI Express" inference format) but they are not protocol versions.

### v0.8 → v0.9 (https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/docs/evolution_guide.md)

- `beginRendering` **replaced** by `createSurface`; `root` attribute removed — "There must be exactly one component with the `ComponentId` 'root'"; `styles` → `theme`; `createSurface` requires `catalogId`.
- `surfaceUpdate` → `updateComponents`; component shape flattened: `{"id":"title","component":{"Text":{"text":{"literalString":"Hello"}}}}` → `{"id":"title","component":"Text","text":"Hello"}`.
- `dataModelUpdate` (typed `contents` array of `key`/`valueString`/`valueNumber`/`valueBoolean`/`valueMap`, per `RAW/specification/v0_8/json/server_to_client.json`) → `updateDataModel` with simple `path`/`value`.
- `sendDataModel` (bool) on `createSurface` added for explicit client→server data model sync.
- Every message carries `"version"`.

### v0.9 → v1.0 (`RAW/specification/v1_0/docs/evolution_guide.md`, rendered https://a2ui.org/specification/v1.0-evolution-guide/)

Relevant to us:
- `version` = `"1.0"` (v0.9 used `"v0.9"`). MIME type `application/json+a2ui` → `application/a2ui+json`.
- `createSurface`: `theme` removed; `catalogId` now **optional** (default catalog); may carry initial `components`, `dataModel`, `metadata.extensions`.
- Catalog mixing in one surface; per-component `@catalogId`.
- Envelope keys on components get `@` prefix: `@accessibility`, `@checks`, `@catalogId`, `@metadata` (`id`, `component` stay plain). Data bindings / function calls use `{"@path": ...}` / `{"@call": ..., "args": {...}}`; `ChildList` template objects keep plain `{"componentId": ..., "path": ...}`.
- `Text.variant` `h1..h5` removed → Markdown headings in `text` (`"text": "## Welcome"`); only `caption`, `body` remain.
- `updateDataModel.value` now **required**; `null` deletes the key.
- New bidirectional RPC: `callRendererFunction`/`rendererFunctionResponse`, `callAgentFunction`/`agentFunctionResponse`.
- Terminology: client → renderer, server → agent; schema files renamed (`server_to_client.json` → `agent_to_renderer.json`, `client_to_server.json` → `renderer_to_agent.json`, …).
- "Catalogs authored for v0.9 cannot be used directly with v1.0 protocol runtimes."

## 2. Agent → renderer messages

Exact names per version (schemas: `RAW/specification/v0_8/json/server_to_client.json`, `RAW/specification/v1_0/json/agent_to_renderer.json`):

| v0.8 | v0.9 / v0.9.1 | v1.0 |
|---|---|---|
| `beginRendering` | `createSurface` | `createSurface` |
| `surfaceUpdate` | `updateComponents` | `updateComponents` |
| `dataModelUpdate` | `updateDataModel` | `updateDataModel` |
| `deleteSurface` | `deleteSurface` | `deleteSurface` |
| — | — | `callRendererFunction`, `agentFunctionResponse` |

v1.0 fields (SPEC1 "Envelope message structure"):

- **`createSurface`**: `surfaceId` (req, "globally unique for the renderer's lifetime"; re-creating an existing id = `INTEGRITY_ERROR`), `catalogId` (opt, string id, "not a resolvable URI"), `sendDataModel` (opt bool, default false), `components` (opt), `dataModel` (opt; applied before `components`), `metadata` (opt). Implicitly creates a `Surface` container with `"child": "root"`.
- **`updateComponents`**: `surfaceId`, `components` (flat list, adjacency list). Missing refs → render placeholders (progressive rendering).
- **`updateDataModel`**: `surfaceId`, `path` (opt JSON Pointer, default `/` = replace whole model), `value` (req; `null` = delete). Upsert semantics.
- **`deleteSurface`**: `surfaceId`.

```json
{"version":"1.0","createSurface":{"surfaceId":"user_profile_card","catalogId":"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json","sendDataModel":true,"components":[{"id":"root","component":"Column","children":["user_name"]},{"id":"user_name","component":"Text","text":{"@path":"/name"}}],"dataModel":{"name":"John Doe"}}}
{"version":"1.0","updateDataModel":{"surfaceId":"user_profile_card","path":"/name","value":"Jane Doe"}}
{"version":"1.0","deleteSurface":{"surfaceId":"user_profile_card"}}
```
(adapted from SPEC1)

v0.8 for comparison (from `RAW/specification/v0_8/docs/a2ui_protocol.md`):
```jsonl
{"surfaceUpdate": {"components": [{"id": "handle_text", "component": {"Text": {"text": {"literalString": "@a2a_fan"}}}}]}}
{"dataModelUpdate": {"contents": {}}}
{"beginRendering": {"root": "root"}}
```

## 3. Component model

- Flat list, each `{ "id": ..., "component": "<Type>", ...props }`; parents reference children by id (`child` for one, `children` for many). Component `"id": "root"` mounts under the surface (SPEC1 "UI composition: the adjacency list model", "`updateComponents`"). Re-sending a component with the same id updates it (see incremental-dashboard example, §10).
- `children` is a `ChildList`: either a static array of ids, or a template object `{"componentId": "...", "path": "/items"}` (SPEC1 "Common types").
- Layout `weight` (flex-grow-like) appears on every basic component in v1.0.

### Basic catalog components per version

Extracted from the catalog JSON files (`RAW/catalogs/basic/v1/catalog.json`, `RAW/catalogs/basic/v0_9/catalog.json`, `RAW/specification/v0_8/json/standard_catalog_definition.json`):

| Component | v0.8 props | v0.9 props | v1.0 props (+`weight`) |
|---|---|---|---|
| Text | text, usageHint | text, variant | text (Markdown), variant (`caption`/`body`) |
| Image | url, altText, fit, usageHint | url, description, fit, variant | same as v0.9 |
| Icon | name | name | name |
| Video | url | url | url, posterUrl |
| AudioPlayer | url, description | url, description | url, description |
| Row / Column | children, distribution, alignment | children, justify, align | children, justify, align |
| List | children, direction, alignment | children, direction, align, listStyle | children, direction, align |
| Card | child | child | child |
| Tabs | tabItems | tabs | tabs |
| Modal | entryPointChild, contentChild | trigger, content | trigger, content |
| Divider | axis | axis | axis |
| Button | child, primary, action | child, variant, action | child, variant, action |
| TextField | label, text, textFieldType, validationRegexp | label, value, variant, validationRegexp | label, value, placeholder, variant (+`@checks`) |
| CheckBox | label, value | label, value | label, value |
| **MultipleChoice** (v0.8) → **ChoicePicker** (v0.9+) | selections, options, maxAllowedSelections, variant, filterable | label, variant, options, value, displayStyle, filterable | same as v0.9 |
| Slider | label, value, minValue, maxValue | label, min, max, value | label, min, max, value, steps |
| DateTimeInput | value, enableDate, enableTime | value, enableDate, enableTime, min, max, label | same as v0.9 |

18 components in every version. **No Chart, Table, Progress or KPI component** in the basic catalog. `MultipleChoice` exists only in v0.8.
Basic v1.0 functions: `required, regex, length, numeric, email, formatString, formatNumber, formatCurrency, formatDate, pluralize, openUrl, and, or, not` (`RAW/catalogs/basic/v1/catalog.json`). `formatString` interpolates `${/path}`.
Basic catalog id v1.0: `https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`.

## 4. Custom catalogs

- A catalog = components + functions under one `catalogId` (string; URI by convention, need not resolve) — SPEC1 "`createSurface`", https://a2ui.org/guides/defining-a-catalog.md.
- Catalog JSON schema: `RAW/specification/v1_0/json/catalog_definition.json`; top-level props `$schema, $id, protocolVersion, $defs, title, description, catalogId (required), metadata, instructions, components, functions`. v1.0 catalogs must set `"protocolVersion": "1.0"` and use relative refs `common_types.json#/$defs/...` (v1.0 evolution guide, "For catalog authors").
- **Negotiation** (SPEC1 "Capabilities and metadata"; schema `RAW/specification/v1_0/json/renderer_capabilities.json`):
  - renderer → agent `a2uiRendererCapabilities`: `{"1.0": {"supportedCatalogIds": [...], "inlineCatalogs": [<catalog_definition>...]}}` (`supportedCatalogIds` required; `inlineCatalogs` only if agent says `acceptsInlineCatalogs: true`).
  - agent capabilities: `{"1.0": {"supportedCatalogIds": [...], "acceptsInlineCatalogs": false}}`.
  - Catalogs listed in `supportedCatalogIds` are mixable within one surface; resolution: component `@catalogId` → surface `catalogId`.
- Restricting placement: component API may declare `allowedParents`/`allowedChildren`; violations → `UNALLOWED_PARENT` / `UNALLOWED_CHILD` (`RAW/typescript/renderers/react/README.md`).

Minimal v1.0 custom catalog (verbatim from https://a2ui.org/guides/defining-a-catalog.md):
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.com/catalogs/status/v1/catalog.json",
  "catalogId": "https://example.com/catalogs/status/v1/catalog.json",
  "protocolVersion": "1.0",
  "title": "Status Catalog",
  "components": {
    "StatusBadge": {
      "type": "object",
      "description": "Displays a short status pill.",
      "properties": {
        "component": {"const": "StatusBadge"},
        "label": {"$ref": "common_types.json#/$defs/DynamicString"},
        "status": {"type": "string", "enum": ["info", "success", "warning"]}
      },
      "required": ["component", "label", "status"]
    }
  },
  "$defs": {
    "anyComponent": {"oneOf": [{"$ref": "#/components/StatusBadge"}], "discriminator": {"propertyName": "component"}},
    "anyFunction": {"not": {}}
  }
}
```

**Official chart catalog exists:** VegaChart (`spec`: `DynamicValue` Vega-Lite JSON, `height`: `DynamicNumber`, default 290), catalogId `https://a2ui.org/specification/v1_0/catalogs/vegachart/catalog.json` — `RAW/catalogs/vegachart/README.md`, `RAW/catalogs/vegachart/v1/catalog.json`. TS package named `@a2ui/catalog-vegachart` in `RAW/typescript/catalogs/vegachart/README.md`; its usage example imports Lit (`@a2ui/lit/v0_9`). **Unverified** whether it is on npm (not checked; `@a2ui/vegachart` returns 404) and whether it works with the React renderer. It would also pull in Vega instead of our recharts.

## 5. Data binding

v1.0 (SPEC1 "Common types", "Data model representation: binding, scope"; https://a2ui.org/concepts/data-binding/):
- `DynamicString|Number|Boolean|StringList|Value` = literal **or** `{"@path": "<JSON Pointer>"}` **or** `{"@call": "<fn>", "args": {...}}`.
- Data model = per-surface JSON object; paths are RFC 6901 JSON Pointers.
- **Templates:** container `children: {"componentId": "item_row", "path": "/items"}` → one instance per array element; inside, a path **without** leading `/` is relative to the item (`name` → `/items/0/name`); absolute paths still reach root scope.
- **Two-way binding:** `TextField, CheckBox, Slider, ChoicePicker, DateTimeInput` write user input back into the data model at their bound path (path need not exist yet).
- `sendDataModel: true` → renderer attaches the full surface data model to every message it sends to the agent (via transport metadata).

v0.8 used `{"literalString": "Hello"}` / `{"path": "/user/name"}` (both = init shorthand) — `RAW/specification/v0_8/docs/a2ui_protocol.md` §4.2.

Template example (verbatim from `RAW/catalogs/basic/v1/examples/child-list-template.json`):
```json
{"id": "item_list", "component": "List", "children": {"componentId": "item_row", "path": "/items"}},
{"id": "item_row", "component": "Row", "children": ["item_name", "qty_label", "item_qty"]},
{"id": "item_name", "component": "Text", "text": {"@path": "name"}},
{"id": "qty_label", "component": "Text", "text": " - Qty: "},
{"id": "item_qty", "component": "Text", "text": {"@path": "quantity"}}
```
```json
{"version": "1.0", "updateDataModel": {"surfaceId": "gallery-child-list-template", "value": {"items": [{"name": "Apple", "quantity": 10}, {"name": "Banana", "quantity": 5}]}}}
```

## 6. User actions and errors (renderer → agent)

| v0.8 (`client_to_server.json`) | v0.9 | v1.0 (`renderer_to_agent.json`) |
|---|---|---|
| `userAction` {name, surfaceId, sourceComponentId, timestamp, context} | `action`, `error` | `action`, `error`, `callAgentFunction`, `rendererFunctionResponse` |
| `error` | | |

Component side (SPEC1 "Defining actions"):
```json
{"id": "submit_button", "component": "Button", "child": "submit_button_label",
 "action": {"event": {"name": "submit_form", "userMessage": "Submitted order #123", "context": {"itemId": "123"}}}}
```
or a local function: `"action": {"functionCall": {"@call": "openUrl", "args": {"url": {"@path": "/url"}}}}` (`requiresUserActivation` functions only run on user gesture).

Wire message — bindings inside `context` are **resolved against the data model before sending** (SPEC1 "`action`"):
```json
{"version": "1.0", "action": {"name": "submitForm", "surfaceId": "contact_form_1", "sourceComponentId": "submit_button", "timestamp": "2026-06-02T08:57:23Z", "userMessage": "Submitted contact form", "context": {"isSubscribed": true}}}
```
Fields: `name`, `surfaceId`, `sourceComponentId`, `timestamp` (ISO 8601), `context` required; `userMessage`, `metadata` optional.

Errors (SPEC1 "`error`", "Standard validation error format"): `code` (`VALIDATION_FAILED`, `INTEGRITY_ERROR`, `INVALID_FUNCTION_CALL`, `UNALLOWED_PARENT`, `UNALLOWED_CHILD`; also `EXPRESSION_ERROR` mentioned), `message`, and `surfaceId` xor `functionCallId`; validation errors add `path` (JSON Pointer into the payload) so the LLM can self-correct (prompt-generate-validate loop):
```json
{"error": {"code": "VALIDATION_FAILED", "surfaceId": "user_profile_card", "path": "/components/0/text", "message": "Expected stringOrPath, got integer"}}
```
This maps neatly onto our compiler-errors-to-A5 loop (`{ path, message }[]`).

## 7. Transport

- Transport-agnostic. Contract: ordered reliable delivery; message framing ("newlines in JSONL, WebSocket frames, or SSE events"); a metadata channel (capabilities, `sendDataModel`); optional return channel for `action` (SPEC1 "The transport contract").
- Bindings listed (SPEC1 "Transport bindings"): **AG-UI** ("the standard transport binding for Agent-to-User Interaction"), **A2A** (extension), **MCP** (tool calls/outputs/resource subscriptions), plus **SSE with JSON-RPC**, **WebSockets**, **REST** (no streaming). Spec examples are JSONL streams ("Example Stream").
- **A2A extension** (`RAW/specification/v1_0/extensions/a2a/docs/a2ui_extension_specification.md`, https://a2ui.org/specification/v1.0-a2ui-extension-specification/): URI `https://a2ui.org/a2a-extension/a2ui/v1.0`; renderer sends `message.metadata["a2uiRendererCapabilities"]`; A2UI payloads are A2A `DataPart`s with `metadata.mimeType = "application/a2ui+json"`; AgentCard `capabilities.extensions[].params = {supportedCatalogIds, acceptsInlineCatalogs}`. Activation optional.
- **AG-UI / CopilotKit:** a2ui.org links an "A2UI Composer & Inspector" at https://a2ui-editor.ag-ui.com and an "A2UI Playground" at https://go.copilotkit.ai/a2ui-playground (https://a2ui.org/llms.txt). Integration details of CopilotKit not researched (not primary A2UI source).
- **MCP:** guides for serving A2UI from an MCP server, calling MCP tools from A2UI, embedding MCP Apps (https://a2ui.org/guides/mcp-overview/, https://a2ui.org/guides/a2ui-over-mcp/).
- Client integration guide: "these methods can exchange messages over HTTP responses, Server-Sent Events (SSE), WebSockets, A2A, or MCP" (https://a2ui.org/guides/client-integration.md).

## 8. Official renderers

npm registry (queried 2026-11-27):

| Package | Latest | First published | Notes |
|---|---|---|---|
| `@a2ui/react` | **0.16.1** (2026-11-23) | 2026-03-17 | exports `.`, `./v0_8`, `./v0_9`, `./styles`; peer react 17–19, zod ^3.25.76; deps `@a2ui/web_core ^0.16.1`, `@a2ui/markdown-it`, `markdown-it`, `clsx` |
| `@a2ui/web_core` | 0.16.1 | 2026-03-04 | protocol messages, state, expressions, basic catalog shared by React/Lit/Angular |
| `@a2ui/lit` | 0.16.0 | 2025-12-16 | Lit / Web Components |
| `@a2ui/angular` | 0.16.0 | 2025-12-16 | Angular |
| `@a2ui/agent` | 0.2.1 | 2026-10-19 | TS agent SDK |
| `@a2ui/markdown-it` | 0.2.4 | 2026-03-05 | Markdown in Text |

Sources: https://registry.npmjs.org/@a2ui/react (and same URL pattern for others), README package table `RAW/README.md`. Renderer support matrix: React = v0.8, v0.9.1, v1.0 (https://a2ui.org/concepts/sdks.md). Other official renderers: Flutter, SwiftUI, Jetpack Compose; community: Lynx, Svelte, Vue, Go (https://a2ui.org/ecosystem/renderers/).

**Maturity:** 0.x semver, monthly minors, breaking changes in minors (0.16.0 "BREAKING CHANGE: Stop assigning `element.context`…", 0.14.0 relocated package dir) — `RAW/typescript/renderers/react/CHANGELOG.md`. The React README's security note says samples are "for demonstration purposes".

**API sketch** (from `RAW/typescript/renderers/react/README.md` and https://a2ui.org/guides/defining-a-catalog.md):
```tsx
'use client';
import {useState, useEffect} from 'react';
import {z} from 'zod';
import {A2uiSurface, createComponentImplementation, type ReactCatalogComponent} from '@a2ui/react';
import {Catalog, DynamicStringSchema, MessageProcessor, basicCatalog} from '@a2ui/web_core/v1_0';

const StatusBadge = createComponentImplementation(
  {name: 'StatusBadge', schema: z.object({label: DynamicStringSchema, status: z.enum(['info', 'success', 'warning'])})},
  ({props}) => <span className={`badge badge-${props.status}`}>{String(props.label ?? '')}</span>,
);
const s2dCatalog = new Catalog('https://story2data.local/catalogs/v1/catalog.json', '1.0', [StatusBadge]);

export function ChatSurfaces({messages}: {messages: unknown[]}) {
  const [processor] = useState(() => new MessageProcessor<ReactCatalogComponent>([basicCatalog, s2dCatalog]));
  const [surfaces, setSurfaces] = useState(() => Array.from(processor.model.surfacesMap.values()));
  useEffect(() => { processor.processMessages(messages as never); setSurfaces(Array.from(processor.model.surfacesMap.values())); }, [messages, processor]);
  return <>{surfaces.map(s => <A2uiSurface key={s.id} surface={s} />)}</>;
}
```
(README subscribes to surface created/deleted events instead of the naive re-read above; `props` are typed from the zod schema; `CommonSchemas.Action` resolves to `() => void`; `createBinderlessComponentImplementation` gives raw `context`.)

**Next.js App Router caveats:**
- Must be a client component (stateful processor, `useState`/`useLayoutEffect`; `A2uiSurface.tsx` has no `'use client'` directive itself → wrap it in our own `'use client'` file).
- Basic catalog components are **W3C Custom Elements** rendered as elements by React ("They are W3C Custom Elements, and the React renderer renders them as elements" — React README) → they only upgrade in the browser. `injectBasicCatalogStyles()` "no-ops during server-side rendering" (client-integration guide). SSR support is otherwise **undocumented** → use `next/dynamic(..., {ssr: false})` for the chat surface pane.
- **zod conflict:** `@a2ui/react` wants zod ^3.25.76; repo uses zod ^4.6.7. Custom component schemas must use the same zod instance as `CommonSchemas`/`DynamicStringSchema` → frontend would carry zod 3 next to zod 4. Unverified whether zod 4 schemas work.
- Styling: CSS variables `--a2ui-*`, `.a2ui-dark`/`.a2ui-light` classes; custom components can use any CSS (CSS Modules shown) → Tailwind fine inside our custom components.

**No mature-enough fit → own renderer path:** spec itself says so: "consult `blueprints/modules` and `conformance` to build a custom framework adapter" (https://a2ui.org/concepts/sdks.md). Minimum we would implement: surface map; `createSurface/updateComponents/updateDataModel/deleteSurface`; component map by id + recursive render from `root`; `@path` resolution (absolute + relative in template scope); `ChildList` templates; `action.event` → POST with resolved `context`; zod validation of each envelope, `error` back on failure.

## 9. Security model

- "No untrusted code is executed on the client" (https://a2ui.org/llms.txt); agent sends declarative JSON; only components registered in the client catalog can be rendered (https://a2ui.org/, https://a2ui.org/concepts/overview/).
- Catalog = whitelist; unknown components/props fail schema validation (`VALIDATION_FAILED`); placement rules (`UNALLOWED_PARENT/CHILD`).
- Functions: `allowedCallers` (`rendererOnly | agentOnly | rendererOrAgent`) and `requiresUserActivation` (e.g. `openUrl`) enforced by renderer (SPEC1 "Renderer capabilities", "Local actions").
- Still treat agent output as untrusted: React README warns of phishing UI spoofing, XSS via property values, DoS via layout complexity; developers own sanitization/CSP (`RAW/typescript/renderers/react/README.md` "Security"). Markdown in `Text` goes through `@a2ui/markdown-it` with a sanitizer (`RAW/typescript/renderers/markdown-it/src/sanitizer.ts` exists; not reviewed).
- For us: compatible with hard rule 1 — the LLM emits UI config validated by zod, never rows or code.

## 10. Dashboard-like example payloads

Incremental dashboard (verbatim, abridged, `RAW/catalogs/basic/v1/examples/incremental-dashboard.json`) — placeholders replaced by re-sending the same id:
```jsonl
{"version":"1.0","createSurface":{"surfaceId":"gallery-incremental-dashboard","catalogId":"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"}}
{"version":"1.0","updateComponents":{"surfaceId":"gallery-incremental-dashboard","components":[{"id":"root","component":"Column","children":["header","content_grid"],"align":"stretch"},{"id":"header","component":"Text","text":"## System Dashboard"},{"id":"content_grid","component":"Row","children":["left_panel","right_panel"]},{"id":"left_panel","component":"Column","children":["panel_a_loading"],"weight":1},{"id":"right_panel","component":"Column","children":["panel_b_loading"],"weight":1},{"id":"panel_a_loading","component":"Text","text":"Loading analytics...","variant":"caption"},{"id":"panel_b_loading","component":"Text","text":"Loading logs...","variant":"caption"}]}}
{"version":"1.0","updateComponents":{"surfaceId":"gallery-incremental-dashboard","components":[{"id":"left_panel","component":"Column","children":["analytics_card"],"weight":1},{"id":"analytics_card","component":"Card","child":"analytics_text"},{"id":"analytics_text","component":"Text","text":"Analytics are ready.","variant":"body"}]}}
{"version":"1.0","updateComponents":{"surfaceId":"gallery-incremental-dashboard","components":[{"id":"right_panel","component":"Column","children":["logs_list"],"weight":1},{"id":"logs_list","component":"List","children":{"path":"/logs","componentId":"log_template"}},{"id":"log_template","component":"Text","text":{"@path":"message"},"variant":"caption"}]}}
{"version":"1.0","updateDataModel":{"surfaceId":"gallery-incremental-dashboard","value":{"logs":[{"message":"System boot complete."},{"message":"All services healthy."}]}}}
```

KPI/stats card (verbatim components, `RAW/catalogs/basic/v1/examples/stats-card.json`):
```json
{"id": "value", "component": "Text", "text": {"@call": "formatCurrency", "args": {"value": {"@path": "/value"}, "currency": "USD"}}},
{"id": "trend_text", "component": "Text", "text": {"@call": "formatString", "args": {"value": "+${/trendPercent}% from last month"}}, "variant": "body"}
```
Data: `{"icon": "payment", "metricName": "Monthly Revenue", "value": 48294, "trendIcon": "arrowForward", "trendPercent": 12.5}`.

Table-ish grid: `RAW/catalogs/basic/v1/examples/financial-data-grid.json` builds a table from `Row`s with `weight` columns and a `List` template over `/assets` (no real Table component).

Chart: VegaChart example in `RAW/typescript/catalogs/vegachart/README.md` (`"component": "VegaChart", "height": 320, "spec": {<vega-lite>}`).

---

## Implications for Story2Data

**Catalog:** one custom catalog `https://story2data.local/catalogs/s2d/v1` (`protocolVersion: "1.0"`), zod-defined in `packages/schema/src/ui.ts` (single source of truth; JSON Schema exported for the agent prompt). Mix with a tiny subset of basic layout (`Column`, `Row`, `Card`, `Text`, `Button`, `Slider`, `TextField`, `ChoicePicker`) — implemented by us with Tailwind if we go own-renderer.

Custom components (props are `Dynamic*`, i.e. literal or `{"@path"}`; heavy data always via `@path` into `updateDataModel`, filled from DuckDB/evidence, never by the LLM):

| Component | Key props | Renders with |
|---|---|---|
| `LineChart` | `data` (@path → array), `x`, `series[] {key,label}`, `title`, `annotations[] {x,label}` (story points / curve segments) | recharts `LineChart` |
| `BarChart` | `data`, `x`, `series[]`, `stacked` | recharts `BarChart` |
| `Table` | `rows` (@path), `columns[] {key,label,format}`, `pageSize`, `metadata` (allowed in v1.0 since envelope uses `@metadata`) | plain `<table>` |
| `KpiCard` | `label`, `value`, `format` (`number|currency|percent`), `delta`, `trend` (`up|down|flat`) | Tailwind card |
| `ProgressSteps` | `steps` (@path → `[{id,label,status: pending|running|done|error}]`) | cascade A1–A5 + engine progress |
| `EvidenceList` / `ExpectationResult` | `items` (@path) with pass/fail, metric, expected vs actual | evidence + compare |
| `DetectiveFinding` | `title`, `confidence`, `sql` (text only, display), `matchedStoryPoint` | detective results |
| `CurveEditor` (form) | `points` (@path, two-way), `min`, `max`; action `event: "apply_curve"` with `context` = resolved params | parameter tweaking → POST command → re-run engine |

Flow: Hono SSE `GET /sessions/:id/events` emits `{"type":"a2ui", "message": <A2UI envelope>}` events; frontend feeds them into the renderer; `action` → `POST /sessions/:id/commands` (`{type:"a2ui_action", action}`), validated by zod. Validation failures returned as A2UI `error` objects to the agent (same shape as our compiler errors). Surfaces keyed per chat turn (`surfaceId = <turnId>-evidence`), so `deleteSurface`/re-create rules are trivial.

Effort: own renderer + 4 components (LineChart, Table, KpiCard, ProgressSteps) ~4–5 h; `@a2ui/react` spike ~1 h + zod/SSR risk.

## Sources

- https://raw.githubusercontent.com/a2ui-project/a2ui/main/specification/versions.json
- https://a2ui.org/specification/v1.0-a2ui/ · https://raw.githubusercontent.com/a2ui-project/a2ui/main/specification/v1_0/docs/a2ui_protocol.md
- https://a2ui.org/specification/v1.0-evolution-guide/ · https://raw.githubusercontent.com/a2ui-project/a2ui/main/specification/v1_0/docs/evolution_guide.md
- https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/docs/evolution_guide.md · https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9/docs/a2ui_protocol.md
- https://github.com/a2ui-project/a2ui/blob/main/specification/v0_8/docs/a2ui_protocol.md · `specification/v0_8/json/{server_to_client,client_to_server,standard_catalog_definition}.json`
- https://raw.githubusercontent.com/a2ui-project/a2ui/main/specification/v1_0/json/agent_to_renderer.json · `renderer_to_agent.json` · `renderer_capabilities.json` · `catalog_definition.json`
- https://raw.githubusercontent.com/a2ui-project/a2ui/main/specification/v1_0/extensions/a2a/docs/a2ui_extension_specification.md
- https://raw.githubusercontent.com/a2ui-project/a2ui/main/catalogs/basic/v1/catalog.json · `catalogs/basic/v0_9/catalog.json` · `catalogs/basic/v1/examples/{incremental-dashboard,stats-card,child-list-template,financial-data-grid}.json`
- https://raw.githubusercontent.com/a2ui-project/a2ui/main/catalogs/vegachart/README.md · `catalogs/vegachart/v1/catalog.json` · `typescript/catalogs/vegachart/README.md`
- https://raw.githubusercontent.com/a2ui-project/a2ui/main/typescript/renderers/react/README.md · `CHANGELOG.md` · `src/A2uiSurface.tsx`
- https://raw.githubusercontent.com/a2ui-project/a2ui/main/README.md
- https://a2ui.org/llms.txt · https://a2ui.org/concepts/overview.md · https://a2ui.org/concepts/sdks.md · https://a2ui.org/guides/defining-a-catalog.md · https://a2ui.org/guides/client-integration.md
- https://registry.npmjs.org/@a2ui/react · https://registry.npmjs.org/@a2ui/web_core · https://registry.npmjs.org/@a2ui/lit · https://registry.npmjs.org/@a2ui/angular · https://registry.npmjs.org/@a2ui/agent · https://registry.npmjs.org/@a2ui/markdown-it
