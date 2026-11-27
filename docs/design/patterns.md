# Interaction patterns

## 1. Landing → chat morph

- User sends company + story. On `201` (or instantly in demo mode) the landing **does not navigate**: `Landing.tsx` swaps to `ChatWorkspace` inside `document.startViewTransition` + `flushSync`.
- The prompt box (`.box`) and the chat frame (`.chat-frame`) share `view-transition-name: jojo-shell`, so the browser grows the box to the full-height frame (600ms, `--ease-out-soft`). The rest cross-fades (350ms).
- URL updates with `history.pushState` to `/chat?s=<id>` (`&demo=1` in demo) so reload/back work. The session is saved to history (localStorage).
- No View Transition support or `prefers-reduced-motion` → instant swap.

## 2. Chat + canvas

| Chat column (340–420px) | Canvas (rest) |
| --- | --- |
| user / agent bubbles, small surfaces (progress, company, "what next" card), thinking, composer, quick replies | big surfaces as tabs: Příběh, Data dN, Detektiv dN, dA ↔ dB |

- Placement is decided by the emitter: `createSurface.metadata.placement`. A new canvas surface becomes the active tab.
- A chat card can open a canvas tab (`open_canvas` action).
- ≤ 900px: one column with a Chat / Plátno toggle in the header.

## 3. Always-visible work (loading)

- Every pipeline run creates a **progress card** (`Steps`) in the chat: pending → running (spinner) → done (✓ + detail, e.g. "2 iterace", "48 210 řádků") / failed.
- Under the thread a **thinking row** shows the current step label (fixed) + a rotating phrase every 2.8s (`lib/chat/phrases.ts`). The composer is disabled while busy ("Pracuji…").
- Canvas shows an empty state until the first canvas surface arrives. Surfaces that stream in late show shimmering placeholders.

## 4. Refine before generating

- After `04_story` the story surface shows: timeline of story points, curve preview, and one editable card per point (date text field + strength slider, two-way bound into the surface data model).
- "Schválit a generovat" sends `approve` with the edited points as context; the button locks (`/locked`).
- Live mode: changed points → `PUT artifacts/04_story`, then `approve` once the session is back in `awaiting_refinement`.

## 5. Counterfactual loop

- After a dataset is ready the chat offers quick replies ("Co kdyby…?") and the composer accepts free text → `what_if`.
- Result: new dataset with the same seed, and a compare surface (A green solid vs B blue dashed, story marker, diff table).

## 6. Errors

- Form errors: red bubble above the field (landing pattern), focus moves to the field.
- Pipeline errors: agent bubble "Chyba: …" with what to do; progress step → failed.
- A2UI integrity/validation errors are logged (`console.warn`) and the surface is skipped, never a crash.
- `409` (busy): "Ještě běží předchozí krok. Zkuste to za chvilku."

## 7. History / skip landing

- Hamburger top-left (landing + chat) opens a drawer (native `<dialog>`: focus trap, Esc, backdrop click): Nový chat, Ukázka s demo daty, history (newest first, max 20, localStorage), Design systém.
- `/chat?s=<id>` reconnects to an API session (SSE replays from `events.jsonl`); `/chat?demo=1` replays the scripted demo.

## 8. Demo mode

- `/?demo=1` (landing sends without API) or `/chat?demo=1`. Scripted in `lib/chat/mockSource.ts`, data in `lib/chat/mockData.ts` (deterministic LCG).
- Always shows the amber **Demo data** badge.

## 9. Configurability rules

- Every chart/table is a catalog component with declarative props (`lines`, `columns`, `format`, `goodWhen`, `maxRows`, `height`) so emitters change views without code.
- Tables: sortable headers, "Zobrazit vše". Deltas are coloured only when a column declares `goodWhen`.
- Numbers formatted once, in `lib/format.ts` (cs-CZ).
