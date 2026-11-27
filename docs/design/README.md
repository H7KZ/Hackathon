# Design system — JOJO (Story2Data UI)

One place for how the UI looks, talks and behaves. Read in this order:

| File | What | Read when |
| --- | --- | --- |
| [principles.md](principles.md) | 8 product/design principles, decision rules | before any UI work |
| [brand.md](brand.md) | identity, colour, type, spacing, motion, voice (Czech), loading phrases | styling anything |
| [patterns.md](patterns.md) | interaction patterns: landing → chat morph, chat + canvas, loading, errors, history, editing | building a screen |
| [components.md](components.md) | app components + the A2UI component catalog (props, states) | building / extending a component |
| [a2ui.md](a2ui.md) | how A2UI works in our product: who emits what, data flow, mock stream | touching chat / agent output |

Living versions:

- `/design` route — tokens + every catalog component rendered with mock data.
- `/chat?demo=1` — full demo workflow on scripted mock data, no API needed.
- `/lab/components` — every A2UI component live, with its data model and actions.
- `/lab` — the same demo in three workspace layouts (thread is the chosen one).

Protocol research (primary sources): [`docs/research/a2ui.md`](../research/a2ui.md).

Tokens live in code, not here: `services/frontend/app/globals.css` (`@theme`). Docs quote them; if they disagree, code wins and the doc gets fixed.
