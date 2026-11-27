# Components

## App components (`services/frontend/components/`)

| Component | Role | States |
| --- | --- | --- |
| `Landing` | landing page; morphs into the chat after send | landing / chat |
| `PromptForm` | company + story + files, examples, clear dialog | idle, error bubble, sending, sent |
| `PromptHelp` | inline expandable help | closed / open (Esc closes) |
| `chat/ChatWorkspace` | header, chat column, canvas tabs; owns the surface store | busy / idle, chat / canvas view (mobile) |
| `chat/ChatRoute` | `/chat` entry: picks mock or live source after hydration | loading, missing, ready |
| `chat/Composer` | input + quick replies; Enter sends | enabled / disabled ("Pracuji…") |
| `chat/Thinking` | step label + rotating phrase | — |
| `chat/HistoryMenu` | hamburger + drawer with history | closed / open / empty history |
| `DesignGallery` | `/design` living style guide | — |
| `a2ui/A2uiSurface` | renders one surface from the store | missing node → placeholder, unknown → error text |

## A2UI catalog (JOJO v1)

`Dyn` = literal or `{"@path": "…"}`. **Bold** props must be bound (`DATA_PROPS`, enforced by `validateComponents`). Every component accepts `weight` (flex-grow).

### Layout (A2UI basic names)

| Component | Props |
| --- | --- |
| `Column` | `children`, `gap: sm\|md\|lg` |
| `Row` | `children`, `gap`, `justify: start\|center\|end\|spaceBetween`, `wrap` (default true) |
| `Card` | `child` or `children`, `title: Dyn<string>` |
| `List` | `children` (usually a template `{componentId, path}`), `direction: vertical\|horizontal` |
| `Tabs` | `tabs: [{ title: Dyn<string>, child }]` |
| `Divider` | — |

### Content

| Component | Props |
| --- | --- |
| `Text` | `text: Dyn<string>` (`**bold**` only), `variant: h1\|h2\|h3\|body\|caption\|muted` |
| `Badge` | `text`, `tone: ok\|fail\|info\|story\|neutral` (icon + colour) |
| `Callout` | `title`, `text`, `tone` |

### Inputs (two-way bound)

| Component | Props |
| --- | --- |
| `Button` | `label: Dyn<string>` or `child`, `variant: primary\|secondary\|ghost`, `disabled: Dyn<boolean>`, `action: {event: {name, userMessage?, context?}}` |
| `TextField` | `label`, **`value`**, `placeholder`, `multiline` |
| `Slider` | `label`, **`value`**, `min`, `max`, `steps`, `unit` |
| `ChoicePicker` | `label`, **`value`** (string[]), `options: [{label, value}]`, `variant: single\|multiple` |

### Data

| Component | Props |
| --- | --- |
| `Kpi` | `label`, **`value`**, `format: number\|int\|percent\|text`, `unit`, `delta: Dyn<number>` (ratio) |
| `Table` | `columns: [{key, label, format?: text\|number\|int\|percent\|delta\|date\|pass\|yesno, goodWhen?: up\|down}]`, **`rows`**, `maxRows` (8), `caption` |
| `LineChart` | **`data`** (rows `{day, …}`), `lines: [{key, label, dashed?, color?}]`, `markers: Dyn<[{date, label}]>`, `xKey` (day), `title`, `height` (260) |
| `BarChart` | **`data`**, `bars: [{key, label, color?}]`, `xKey` (label), `title`, `height` (240) |

### Story

| Component | Props |
| --- | --- |
| `Steps` | **`steps`**: `[{id, label, state: pending\|running\|done\|failed, detail?}]` |
| `StoryTimeline` | **`points`**: `[{id, title, start, end?}]`, `from`, `to` (ISO dates) |

## Presenter surfaces (`lib/chat/surfaces.ts`)

| Builder | Placement | Contents |
| --- | --- | --- |
| `progressSurface` / `setSteps` | chat | Card + Steps |
| `companySurface` | chat | industry, size, actor badges (template), processes |
| `storySurface` | canvas | timeline, curve preview, editable point cards (template), approve |
| `datasetSurface` | canvas | 4 KPIs, tabs: Přehled (chart + markers), Důkazy (expectations), Tabulky |
| `readySurface` | chat | summary + "Spustit detektiva" / "Otevřít data" |
| `detectiveSurface` | canvas | recall/precision/count KPIs, narrative, findings table |
| `compareSurface` | canvas | question, A vs B chart, diff table |
