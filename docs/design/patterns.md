# Interaction patterns

## 1. Landing → chat morph

- User sends company + story. On `201` (or instantly in demo mode) the landing **does not navigate**: `Landing.tsx` swaps to `ChatWorkspace` inside `document.startViewTransition` + `flushSync`.
- The prompt box (`.box`) and the workspace area (`.workspace`) share `view-transition-name: jojo-shell`, so the browser grows the box to the full-height workspace (600ms, `--ease-out-soft`). The rest cross-fades (350ms).
- URL updates with `history.pushState` to `/chat?s=<id>` (`&demo=1` in demo) so reload/back work. The session is saved to history (localStorage).
- No View Transition support or `prefers-reduced-motion` → instant swap.

## 2. Workspace layouts (compare at `/lab`)

Full screen, no outer frame: push sidebar (history) + topbar + layout. Inspiration: CopilotKit A2UI playground (one centered thread, hairline borders, small radii, optional protocol inspector).

| Route | Layout | When |
| --- | --- | --- |
| `/lab/thread` (**chosen**, default for `/chat`) | **A · Vlákno**: one centered column (max 880px); big surfaces render inline as panels with a title strip and `A2UI · N komponent` chip | default product view |
| `/lab/inspector` | **B · Vlákno + inspektor**: thread + right panel with the live A2UI message stream and per-surface data model | demo / jury: shows how agents build UI and that numbers come from data |
| `/lab/split` | **C · Chat + plátno**: narrow chat + canvas tabs | most room for charts |

- Same session hook (`components/chat/useChatSession.ts`) and renderer for all three; only the arrangement differs. `/chat?layout=inspector` works too.
- ≤ 900px: sidebar overlays with a scrim, inspector hidden, split gets a Chat / Plátno toggle.

## 3. Always-visible work (loading)

- Every pipeline run creates a **progress card** (`Steps`) in the chat: pending → running (spinner) → done (✓ + detail, e.g. "2 iterace", "48 210 řádků") / failed.
- Under the thread a **thinking row** shows the current step label (fixed) + a rotating phrase every 2.8s (`lib/chat/phrases.ts`). The composer is disabled while busy ("Pracuji…").
- Canvas shows an empty state until the first canvas surface arrives. Surfaces that stream in late show shimmering placeholders.

## 4. Refine before generating ("it just works")

- The story panel opens with the **CurveEditor**: the story is a parameter curve bent at story points (same shape as `CurveDef.segments`: each point is a ramp to `level`, optional `end` ramps back to baseline).
- Direct manipulation, like Figma: hover near the line → a ghost `+` point follows the cursor, one click adds it on the curve; drag a point in time and value, drag its square to change when things return to normal, double-click empty space to add a point, arrows nudge, Delete removes, Ctrl+Z / Ctrl+Shift+Z undo / redo, a hover guide shows date + value. The selected point gets an inline editor (name, dates, value, description, delete).
- The editor is **sticky**: scrolling down through the settings keeps the curve pinned at the top, so every change is visible on the curve immediately.
- Below: **Období a záznam dat** (start, length in days / weeks / months / years, record per hour / day / week, derived end date and record count, warning for huge volumes, presets) and **basic settings** (objem dat, seed). Everything else is in **Pokročilé nastavení** (collapsed): point list, curve baseline / ramp / label, noise (missing, duplicates, hour jitter), company size, which expectations to check.
- Every control is two-way bound into the surface data model. **Generovat data** sends `points`, `config` and `expectations` as action context, so the run uses exactly what is on screen; the editor locks (`/locked`).
- Live mode: `editToStory` writes points back into `04_story` (story points + ramp segments of the first curve), then `approve`.

## 5. Counterfactual loop

- After a dataset is ready the chat offers quick replies ("Co kdyby…?") and the composer accepts free text → `what_if`.
- Result: new dataset with the same seed, and a compare surface (A green solid vs B blue dashed, story marker, diff table).

## 6. Live mode = demo mode

- The real app (`/` → `/chat?s=<id>`) renders the same thread as the demo. Verified against the API with `API_FAKE=all`: company card and step details come from the artifacts each step writes, the story panel, Generate (PUT `04_story` only when something really changed), dataset, detective, what-if compare.
- Reopening a session replays its SSE log: the story surface is updated in place (one copy, locked if generation already started).
- Dev override of the API URL without rebuild: `?api=http://localhost:4100` (remembered; `?api=` clears).
- Not yet in the API contract: `config.time` (period + granularity), noise, size and scale are UI-only in live mode until `04_story`/scenario carry them.

## 7. Errors

- Form errors: red bubble above the field (landing pattern), focus moves to the field.
- Pipeline errors: agent bubble "Chyba: …" with what to do; progress step → failed.
- A2UI integrity/validation errors are logged (`console.warn`) and the surface is skipped, never a crash.
- `409` (busy): "Ještě běží předchozí krok. Zkuste to za chvilku."

## 8. History sidebar (no hamburger)

- Push sidebar (264px, hairline border, no rounded corners): Nový chat, Ukázka s demo daty, history (newest first, max 20, localStorage, current chat highlighted), footer links Varianty rozložení and Design systém.
- Open by default in the workspace on wide screens, closed on the landing and always closed on ≤ 900px; the choice persists (`jojo.sidebar`). Toggle = sidebar icon (in the sidebar header when open, in the topbar when closed).
- `/chat?s=<id>` reconnects to an API session (SSE replays from `events.jsonl`); `/chat?demo=1` replays the scripted demo.

## 9. Demo mode

- `/?demo=1` (landing sends without API) or `/chat?demo=1`. Scripted in `lib/chat/mockSource.ts`, data in `lib/chat/mockData.ts` (deterministic LCG).
- Always shows the amber **Demo data** badge.

## 10. Configurability rules

- Every chart/table is a catalog component with declarative props (`lines`, `columns`, `format`, `goodWhen`, `maxRows`, `height`) so emitters change views without code.
- Tables: sortable headers, "Zobrazit vše". Deltas are coloured only when a column declares `goodWhen`.
- Numbers formatted once, in `lib/format.ts` (cs-CZ).
