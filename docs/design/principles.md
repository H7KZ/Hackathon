# Principles

JOJO turns a short business story into linked relational data where the story is provably hidden. The UI's job: make that proof **visible, adjustable and trustworthy** in a few minutes of demo.

## 1. The data proves the story, the UI shows the proof

Every claim on screen ("zpoždění dodávek vzrostlo o 40 %") links to the query/series that backs it. A chart without a source is decoration. Charts show the story-point marker where the curve was bent, so the viewer sees cause → effect.

## 2. LLM picks the layout, DuckDB supplies the numbers

Mirrors hard rule 1. An agent may decide *which* card, chart or table to show (an A2UI component tree). Numbers in that tree always come from the data model filled from DuckDB / evidence endpoints — never from model text. If a number has no data path, it does not render.

## 3. One conversation, one canvas

The chat (left) is the timeline of what happened and what you asked. The canvas (right) is the current, big, workable thing: timeline editor, chart, table, comparison. The chat never holds a 600px chart; the canvas never holds history. A chat card can "Otevřít v plátně".

## 4. Always show the machine working

Agent runs take tens of seconds. Never a dead spinner: show the step (A1–A5, engine, evidence, detective), its loop iterations, and a light rotating phrase. Users forgive waiting they can watch.

## 5. Change one thing, see what moved

The product's best moment is the counterfactual: tweak a parameter or ask "co kdyby…", get dataset B, see the diff. Every editable value is one click from a re-run, and every re-run ends with a compare view against its parent.

## 6. Configurable, not configured-for-you

Defaults are good enough to demo without touching anything. Every default (seed, period, curve, chart type, columns) can be changed in place, inline, without a settings page. Edits are validated at the boundary (zod) and errors say what is wrong **and** what is valid.

## 7. Calm, academic, a bit warm

FIS identity: light, green, lots of air. No neon, no dark dashboards. Humour lives only in loading phrases and empty states, never in data or errors.

## 8. Works offline, fails loud

The demo must run from cache/mock (`?demo=1`). Errors are a red bubble at the place they happened with the fix in one sentence. No silent fallbacks: if mock data is shown, a "Demo data" badge says so.

## Decision rules (when in doubt)

- Readability over density. Max ~7 series per chart, max ~8 columns visible per table (rest behind "Sloupce").
- Czech in the UI and data, English in code and docs.
- Keyboard first: every action reachable with Tab/Enter/Esc; focus is always visible.
- Respect `prefers-reduced-motion`: every animation has a no-motion path.
- A new visual element needs a reason a viewer would notice in a 3-minute demo. Otherwise cut it.
