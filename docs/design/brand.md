# Brand guide

## Identity

- **Name:** JOJO (wordmark, uppercase, letter-spacing 0.04em). Product/codename in code: Story2Data.
- **Lockup:** FIS VŠE logo (`public/fis-logo.png`) + 2px vertical rule `#c9d1cf` + JOJO in green-dark. Logo left, never recoloured, min height 44px (mobile) / 64px (landing). In the chat header the lockup shrinks to 28px logo + 1.25rem wordmark.
- **Tagline:** „Z vašeho příběhu vytvoříme data, ve kterých se dá dohledat.“
- **Personality:** a careful analyst who is quietly pleased with their work. Precise, calm, a little playful while waiting.

## Colour

Canonical tokens: `services/frontend/app/globals.css` `@theme` (usable as Tailwind classes `bg-green`, `text-muted`, … and as CSS vars `var(--color-green)`).

| Token | Hex | Use |
| --- | --- | --- |
| `fis-dark` / ink | `#00201b` | body text, footer |
| `green` | `#00957d` | primary action, focus ring (60 % alpha), chart series 1 |
| `green-dark` | `#006252` | labels, links, headings accent, pass state |
| `green-light` | `#33b39e` | hover fills, gradients |
| `mint` | `#00d2b0` | glow, highlights, selection (35 % alpha) |
| `blue` | `#009ee0` | VŠE blue: secondary series, info, dataset B |
| `amber` | `#c77700` | **story point** markers and annotations only |
| `error` | `#b42800` | errors, failed expectations, destructive |
| `muted` | `#5b6563` | secondary text, axis labels |
| `line` | `#e3eae8` | borders, dividers, grid lines |
| `wash` | `#f1f9f7` | focused field, selected row, chat agent bubble |
| page | `#f5f5f5` + dot grid `#d2d2d2` 27px | app background (`bg-dots`) |

Rules: white cards on the dotted page. Green = "go / ok / ours", blue = "the other one" (B, comparison, info), amber = "here the story bends", red = only errors. Never encode meaning by colour alone: add an icon, label or dash pattern.

### Chart palette

Ordered: `#00957d` green, `#009ee0` blue, `#7a5cc7` violet, `#c77700` amber (avoid when story markers are present), `#5b6563` gray. Comparison: A = green solid, B = blue dashed. Grid `#e3eae8`, axis text `#5b6563` 12px. Story-point marker: vertical amber dashed line + label chip at top.

## Typography

- **Titillium Web** (Google Fonts, `latin-ext` for Czech), weights 400 / 600 / 700.
- Scale (rem): display 2.6 (landing wordmark) · h1 1.6 · h2 1.25 · h3 1.05 · body 1 · small 0.9 · caption 0.8 (uppercase labels, letter-spacing 0.06em, weight 700, green-dark).
- Numbers in KPIs and tables: `font-variant-numeric: tabular-nums`; Czech formatting (`Intl.NumberFormat("cs-CZ")`: `12 345,6`, `40 %`, dates `12. 3. 2026`).

## Shape, depth, space

- Radius (small, "desloppified"): 16px landing prompt box · 10–12px panels, composer · 8px cards inside panels, inputs, buttons, tables · 6px chips, nav items · 4px badges. Sidebar and app shell: square, hairline borders.
- Shadow: almost none. Hairline `line` borders separate surfaces; composer gets `0 4px 16px rgb(0 32 27 / 6%)`; primary buttons are flat `green-dark`.
- Spacing: 4px base; common steps 8 / 12 / 16 / 22 / 32.
- Border: 1px `line`. Focus: 3px ring `rgb(0 149 125 / 38–60%)`, never removed.

## Motion

- Default ease `cubic-bezier(0.2, 0.8, 0.2, 1)`, 180ms for hover/focus, 350ms panels, 600ms for the landing → chat morph (View Transition `jojo-shell`).
- Aurora glow drifts 11s alternate. Thinking dots pulse 1.2s.
- Everything is disabled under `prefers-reduced-motion: reduce` (instant state change instead).

## Iconography

24px line icons, stroke 2, round caps, `currentColor` (`components/icons.tsx`). Add paths there, no icon library.

## Voice & tone (Czech UI)

- Vykání, short sentences, active voice: „Doplňte, o jakou firmu jde.“ not „Pole firma je povinné.“
- Errors: what happened + how to fix, one sentence each. No blame, no exclamation marks.
- Buttons are verbs: „Schválit a generovat“, „Spustit detektiva“, „Porovnat“.
- Numbers always with unit and direction: „+38 % zpoždění po 1. 3.“
- Humour only while waiting and in empty states.

### Loading phrases

Rotated every ~2.8s under the current step label (`services/frontend/lib/chat/phrases.ts`). Keep them short, kind, data-flavoured:

1. Vyslýchám dodavatele…
2. Učím křivky, kdy mají zatočit…
3. Domlouvám se s cizími klíči…
4. Sypu do dat špetku šumu…
5. Vařím kafe pro agenta A3…
6. Přesvědčuju tabulky, aby spolu mluvily…
7. Hledám, kde se to v březnu pokazilo…
8. Kontroluju, že každá objednávka má svého zákazníka…
9. Ladím příběh, aby měl pointu…
10. Počítám zákazníky. Zase jich je víc než minule…
11. Zametám duplicity pod koberec… ne, mažu je.
12. Ptám se DuckDB, jestli má chvilku…

Step labels (fixed, not rotated): A1 Poznávám firmu · A2 Stavím datový model · A3 Kreslím vlivy · A4 Píšu příběh · A5 Skládám scénář · Engine Generuji data · Evidence Ověřuji důkazy · Detektiv pátrá.
