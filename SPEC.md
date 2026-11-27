# Story2Data — specifikace

Generátor propojených datasetů, ve kterých je zadaný příběh **kauzálně zapsaný v záznamech**, ne jen popsaný.
Hackathon 4FIS, výzva FIS VŠE. Odevzdání **sobota 28. 11. 12:00**, feature freeze 9:00.

---

## 1. Cíl a mapování na zadání

| Požadavek zadání | Čím ho plníme |
|---|---|
| 1. Zadání příběhu | `story` + `company` v `meta`, artefakty kaskády `01–04` |
| 2. Generovaná data | DuckDB s ≥ 5 propojenými tabulkami (FK), export do Parquet/CSV |
| 3. Důkaz v datech | `expectations` (SQL hypotézy) + grafy + **slepý detektiv** |
| 4. Možnost změny | Úprava parametru ve scénáři → přegenerování enginem (seed) → diff dvou běhů |

Hodnoticí kritéria: věrohodnost a konzistence dat, dohledatelnost příběhu, znovupoužitelnost generátoru, funkční demo.

---

## 2. Pravidla (invarianty — neporušovat)

1. **LLM generuje jen konfiguraci.** Nikdy negeneruje řádky dat ani kód. Data vznikají výhradně v enginu.
2. **Engine je deterministický.** Stejný `scenario.json` + stejný `seed` ⇒ bitově stejný výstup. Žádné `Math.random()`, `Date.now()`, I/O ani síť v enginu.
3. **Nezávislé RNG proudy.** Každý proces má vlastní RNG odvozený z `hash(seed, process.id)`. Přidání/úprava jednoho procesu nesmí přeházet data ostatních (díky tomu je diff dvou běhů čistý).
4. **Příběh jen přes kořenové křivky.** Story pointy mění *parametry* (pravděpodobnosti, rychlosti, rozdělení), nikdy přímo výsledné metriky (tržby, počet stížností). Výsledky musí *vyplynout* z kauzálního řetězce.
5. **Každý odvozený záznam má předka.** Záznam vzniklý z procesu typu `branch`/`derive` nese FK na zdrojový záznam nebo jeho entity. Žádná "volně plovoucí" data.
6. **Referenční integrita je povinná.** Každý FK ukazuje na existující řádek. Ověřuje se testem po každém běhu.
7. **Důkaz nečte scénář.** Modul `evidence` i detektiv pracují jen nad DuckDB. Jediná výjimka: `expectations` jsou SQL hypotézy předem napsané agentem, vyhodnocují se ale nad daty.
8. **Detektiv je slepý.** Vidí jen schéma `main` (pozorovaná data). Nevidí `truth`, scénář ani příběh.
9. **Každý artefakt je editovatelný JSON validovaný schématem.** Ruční úprava kteréhokoli kroku → přepočet jen kroků po něm.
10. **LLM volání jsou cachovaná** podle `hash(model, prompt, schema)`. Demo musí jít pustit offline z cache.
11. **Scénář je jediný kontrakt** mezi agenty a enginem. Moduly mezi sebou nesdílí jiný stav.

---

## 3. Pipeline

```
story + company (text)
   │
   ▼
[A] Kaskáda agentů ── 01_company → 02_model → 03_influences → 04_story → 05_scenario.json
   │                                         ▲ (loop A5: engine na vzorku + expectations)
   ▼
[B] Compiler/validator  (DAG, reference, FK, data v rozsahu) ── chyby → zpět agentovi
   │
   ▼
[C] Engine (seed) ── DuckDB: schema main (observed) + schema truth (ground truth)
   │
   ├─► [D] Evidence: expectations + grafy
   ├─► [E] Detektiv: LLM + run_sql nad main
   └─► [F] Compare: běh A vs běh B (změna parametru)
          │
          ▼
       [G] Web UI
```

### [A] Kaskáda agentů

Každý krok = jedna funkce `(vstup) → zod objekt` přes structured output. Výstup se uloží do `runs/<runId>/NN_name.json`.

| Krok | Vstup | Výstup | Obsah |
|---|---|---|---|
| A1 `company` | story, company | `01_company.json` | spec firmy: obor, velikost, aktéři okolí (dodavatelé, zákazníci, konkurence), klíčové procesy |
| A2 `model` | 01 | `02_model.json` | entity + atributy, tabulky událostí, FK vazby (= `entities` + kostra `processes`, `flows`) |
| A3 `influences` | 01, 02 | `03_influences.json` | kauzální graf: hrany `from → to`, směr, váha (0–1), zpoždění ve dnech, odůvodnění |
| A4 `story` | story, 02, 03 | `04_story.json` | story pointy rozdělené do fází (datumy), kořenové křivky, `expectations` (SQL hypotézy) |
| A5 `detail` | 02, 03, 04 | `05_scenario.json` | doplnění všech parametrů; **agentic loop**: compile → engine na zmenšeném vzorku (`scale: 0.2`) → expectations → při neúspěchu feedback agentovi, max 3 iterace |

Převod vah z A3 do scénáře: váha hrany → multiplikátor nebo podmíněná pravděpodobnost v příslušném procesu (A5 to explicitně zapíše jako `Param`).

### [B] Compiler / validator

- zod validace,
- všechny reference (`entity`, `curve`, `flow`, `process`, cesty polí) existují,
- procesy tvoří DAG (bez cyklů), topologické pořadí,
- datumy segmentů v `[start, end]`,
- `expectations[].sql` se dá naparsovat (`EXPLAIN` na prázdné DB se schématem).

Chyby vrací jako strukturovaný seznam `{path, message}` — použitelné jako feedback pro A5.

### [C] Engine (= "Noiser")

```
init RNG proudy, vygeneruj entity (static)
init flows (počáteční stavy)
for day in [start..end]:
    aplikuj čekající efekty s datem == day (např. zpožděné dodávky)
    for process in topo_order:
        arrival: pro každý stream (kombinace `per`) vygeneruj N ~ Poisson(rate(day)) nebo dle schedule
        branch/derive: zpracuj zdrojové záznamy s (datum + lag) == day
        pole záznamu generuj v deklarovaném pořadí (pozdější pole smí odkazovat na dřívější)
        efekty na flows aplikuj okamžitě (nebo naplánuj na `on` datum)
        pořadí záznamů v rámci dne promíchej RNG proudem procesu
    snapshot flows (pokud `snapshot`)
zapiš tabulky: visibility=observed → main.*, ground_truth → truth.*
zapiš truth.story_points, truth.run_meta (seed, hash scénáře, verze enginu)
# Evidence a detektiv dotazují jen sandbox: kopie main do zvláštního souboru, read-only, bez externího přístupu
```

Šum vzniká přirozeně vzorkováním. Volitelný `noise` blok (stretch) přidává vady kvality dat: chybějící hodnoty, duplicity, jitter času.

Zrnitost: engine vždy generuje záznamy s datem (den), volitelně `hourJitter` → timestamp. Agregace na týden/měsíc je až věc dotazů a UI.

### [D] Evidence

- Spustí `expectations` nad DuckDB → tabulka pass/fail s hodnotami before/after.
- Standardní grafy: časová řada každé observed tabulky (počty/sumy po dnech), rozpad podle hlavních entit.

### [E] Detektiv

- LLM s nástroji `list_tables()`, `describe_table(name)`, `run_sql(sql)` (read-only, jen `main`, limit 200 řádků, timeout 5 s).
- Max ~15 tool volání.
- Výstup (zod): `{ narrative, findings: [{ claim, entities[], start, end?, supportingSql }] }`.
- Skóre proti `truth.story_points`: shoda, pokud se entita shoduje a datum v ±14 dnech → recall/precision.

### [F] Compare

Dva běhy (stejný seed, jiný parametr) → overlay grafů, diff klíčových metrik, diff výsledků expectations. Tohle je demo bodu 4.

### [G] Web UI (stránky)

1. **Příběh** — textová pole story/company, tlačítko "Spustit kaskádu", průběh kroků A1–A5.
2. **Scénář** — editor scénáře (formulář + raw JSON), editor křivek (graf + slidery story pointů).
3. **Data** — prohlížeč tabulek, ERD, export.
4. **Důkaz** — expectations + grafy.
5. **Detektiv** — spuštění, log dotazů, nalezený příběh vs. zadaný.
6. **Porovnání** — běh A vs B.

---

## 4. Kontrakt: `Scenario` (implementovat v zod, `packages/schema/src/`)

```ts
type Param = number | { curve: string; scale?: number };   // křivka vyhodnocená v (den, aktuální záznam)
type Visibility = "observed" | "ground_truth";
type Path = string; // "day" | "self.<field>" | "source.<field>" (branch/derive) | "key.<entity>" (arrival, entita v `per`); jen jeden segment

interface Scenario {
  meta: {
    id: string; name: string;
    company: string;          // popis firmy a prostředí
    story: string;            // zadaný příběh (text)
    seed: number;
    start: string; end: string;   // ISO datum
    scale?: number;           // násobič rate a počtů entit s count ≥ 50 (A5 loop: 0.2); malé entity (dodavatelé) se neškálují
    locale: "cs-CZ";
  };
  entities: EntityDef[];
  curves: CurveDef[];
  flows: FlowDef[];
  processes: ProcessDef[];
  storyPoints: StoryPoint[];
  expectations: Expectation[];
  noise?: NoiseDef;
}

interface EntityDef {
  name: string;               // = název tabulky, např. "supplier"
  count: number;
  idPrefix: string;           // "SUP" → SUP-001
  fields: Record<string, FieldGen>;   // pořadí = pořadí generování
  visibility?: Visibility;    // default observed
}

interface CurveDef {
  id: string;
  baseline: number;
  scope?: { field: Path; ids: string[] };  // platí jen pro záznamy, kde field ∈ ids; jinak baseline
  segments: Segment[];
  clamp?: [number, number];
}
interface Segment {
  kind: "step" | "ramp" | "spike" | "decay";
  start: string; end?: string;   // start včetně, end bez; ramp: lineárně start→end; spike: návrat do end; decay: exp. návrat, end − start = poločas
  to: number;
  storyPointId: string;
}

interface FlowDef {               // stavová veličina, např. zásoba
  id: string;
  keys: string[];                 // názvy entit, např. ["store","product"]
  initial: FieldGen;
  min?: number;                   // např. 0
  snapshot?: { table: string; visibility?: Visibility };   // snapshot na konci dne: sloupce date, <key>_id za každý klíč, value
}

type ProcessDef = ArrivalProcess | BranchProcess | DeriveProcess;

interface ArrivalProcess {
  type: "arrival"; id: string; table: string;
  per: string[];                  // stream pro každou kombinaci entit, např. ["customer"]
  rate?: Param;                   // záznamů / stream / den (Poisson)
  schedule?: { everyDays: number; phase?: "random" };
  where?: Record<string, Path>;   // omezení kombinací, např. product.supplier_id
  fields: Record<string, FieldGen>;
  effects?: Effect[];
  visibility?: Visibility;
}
interface BranchProcess {         // if/else nad zdrojovým záznamem
  type: "branch"; id: string;
  source: string;                 // "<processId>" nebo "<branchId>:then|else"
  lag?: { min: number; max: number };
  cond: Cond;
  then?: Outcome; else?: Outcome;
}
interface DeriveProcess {         // s pravděpodobností p vznikne potomek
  type: "derive"; id: string; table: string;
  source: string;                 // "<processId>" nebo "<branchId>:then|else"
  p: Param;
  lag?: { min: number; max: number };
  fields: Record<string, FieldGen>;
  effects?: Effect[];
  visibility?: Visibility;
}
interface Outcome {
  table: string;
  fields: Record<string, FieldGen>;
  effects?: Effect[];
  visibility?: Visibility;
}

type Cond =
  | { kind: "flowGt" | "flowGte"; flow: string; keys: Record<string, Path>; value: number | Path }  // > resp. >=
  | { kind: "fieldEq"; path: Path; value: string | number | boolean }
  | { kind: "fieldGt"; path: Path; value: number }
  | { kind: "bernoulli"; p: Param }
  | { kind: "and" | "or"; conds: Cond[] }
  | { kind: "not"; cond: Cond };

interface Effect {
  flow: string;
  keys: Record<string, Path>;
  delta: Path;                    // pole s množstvím
  sign: 1 | -1;
  on?: Path;                      // datum aplikace (default = datum záznamu)
}

type FieldGen =
  | { gen: "id" }                                         // PK záznamu
  | { gen: "ref"; path: Path }                            // kopie (typicky FK)
  | { gen: "lookup"; entity: string; key: Path; field: string }  // key = id entity → vrátí její field
  | { gen: "topUp"; flow: string; keys: Record<string, Path>; target: Param }  // max(0, target − stav flow): objednávka do stavu
  | { gen: "pick"; entity: string; weightBy?: string; where?: Record<string, Path> }
  | { gen: "const"; value: string | number | boolean }
  | { gen: "normal"; mean: Param; sd: Param; min?: number; max?: number; round?: boolean }
  | { gen: "poisson"; lambda: Param }
  | { gen: "uniformInt"; min: Param; max: Param }
  | { gen: "bernoulli"; p: Param }
  | { gen: "categorical"; values: string[]; weights?: Param[] }
  | { gen: "dateOffset"; base: Path; days: Path }
  | { gen: "fake"; kind: "personName" | "companyName" | "city" | "email" | "productName" }
  | { gen: "if"; cond: Cond; then: FieldGen; else: FieldGen };

interface StoryPoint {
  id: string; phase: number;
  title: string; description: string;
  entity?: { name: string; ids: string[] };
  start: string; end?: string;
}

interface Expectation {           // hypotéza ověřitelná jen z dat
  id: string; storyPointId: string; description: string;
  sql: string;                    // vrací řádky (period TEXT 'before'|'after', value DOUBLE)
  check: { kind: "increase" | "decrease" | "stable"; minRelChange: number };   // 0.2 = ±20 %; stable = |změna| < minRelChange
}

interface NoiseDef {              // stretch
  missing?: Record<string, number>;       // "table.field": p
  duplicates?: Record<string, number>;    // "table": p
  hourJitter?: boolean;
}
```

### Výstup DuckDB

- `main.<entity>`, `main.<table>` — observed data
- `truth.<table>` — ground truth tabulky (např. `lost_sale`)
- `truth.story_points`, `truth.run_meta`
- Soubor: `out/<scenarioId>/<seed>-<scenarioHash8>.duckdb` + `parquet/` export

---

## 5. Referenční scénář `scenarios/supplier_delay.json`

Příklad ze zadání: tržby klesají, ale poptávka ne — dodavatel SUP-002 začne dodávat pozdě.

- **Entity:** `supplier` (3), `product` (24, FK `supplier_id`, `price`, `category`), `store` (5), `customer` (600, FK `home_store_id`).
- **Křivky:**
  - `late_prob` — baseline 0.05, scope `self.supplier_id ∈ [SUP-002]`, ramp 2025-03-01 → 2025-04-15 na 0.6 (`sp1`).
  - `demand` — baseline 1.0 (bez story, jen týdenní sezónnost volitelně).
- **Flow:** `stock` keys `[store, product]`, initial ~ N(7, 1.5), min 0, snapshot → `main.stock_daily`.
- **Procesy:**
  1. `delivery` (arrival, per `[store, product]`, schedule každých 7 dní): `planned_date`, `quantity` = topUp(stock, target 7) — objednávka do stavu ≈ 1,5 týdne poptávky (poptávka ≈ 4,2 ks/týden na [prodejna, produkt]), `supplier_id` lookup z produktu, `is_late` ~ Bernoulli(`late_prob`), `delay_days` = if late → uniformInt(3, 10) else 0, `actual_date` = planned + delay; efekt +quantity na `stock` `on: actual_date`. → `main.delivery`
  2. `purchase_attempt` (arrival, per `[customer]`, rate 0.06 × `demand`): `product_id` pick vážený, `store_id` = home store, `quantity` 1–3. → `truth.purchase_attempt`
  3. `fulfil` (branch na `purchase_attempt`, cond `flowGte stock ≥ source.quantity`):
     - then → `main.sale` (FK attempt, customer, store, product, `quantity`, `unit_price` lookup z produktu; tržba = quantity × unit_price v SQL), efekt −qty na `stock`
     - else → `truth.lost_sale`
  4. `complaint_oos` (derive, source `fulfil:else`, p 0.25, lag 0–3) → `main.complaint` (`type = "nedostupnost"`, FK customer, store, product)
  5. `complaint_quality` (derive, source `fulfil:then`, p 0.01, lag 1–10) → `main.complaint` (`type = "kvalita"`)
- **Expectations** (každé SQL vrací oba řádky `before`/`after` přes CTE `periods` + `COALESCE`, aby prázdné období nebylo chybou; nulová baseline u increase/decrease neprojde):
  - `e1`: průměrné zpoždění dodávek SUP-002 před/po 2025-04-15 → increase ≥ 100 %
  - `e2`: podíl dní s nulovou zásobou u produktů SUP-002 → increase ≥ 50 %
  - `e3`: tržby z produktů SUP-002 → decrease ≥ 20 %
  - `e4`: tržby z produktů ostatních dodavatelů → změna < 10 % (poptávka neklesla)
  - `e5`: stížnosti typu "nedostupnost" → increase ≥ 50 %
- **Demo změny (bod 4):** posunout start rampy z března na červen, nebo `to: 0.6 → 0.3` → všechny grafy se posunou/zmírní.
- **Demo znovupoužitelnosti:** druhý scénář z jiné domény, vygenerovaný kaskádou z textu (např. e-shop, kde marketingová kampaň přivede nekvalitní zákazníky → víc vratek).

---

## 6. Stack

| Vrstva | Technologie |
|---|---|
| Jazyk | TypeScript 6 (strict), Node ≥ 22, pnpm workspaces + Turborepo |
| Kontrakt | zod 4 (`z.toJSONSchema` pro LLM) |
| LLM | Vercel AI SDK 7 (`generateText` + `Output.object`, `instructions`), `@ai-sdk/anthropic` / `@ai-sdk/openai` — jen přes `@s2d/llm` |
| Engine | čisté TS, vlastní RNG (sfc32 + cyrb hash), distribuce v `engine/random.ts` |
| Fake data | `@faker-js/faker` (seed per proces), locale `cs_CZ` |
| Úložiště | DuckDB (`@duckdb/node-api` 2.x) |
| API | Hono na Node (`@hono/node-server`), typovaný klient `hono/client` pro frontend |
| UI | Next.js 16 (App Router), Tailwind 4, TanStack Query, Recharts |
| CLI | `tsx` skripty v `services/api/src/cli` |
| Testy | vitest (unit / integration / property s fast-check / golden), Playwright e2e, evals agentů |
| Kvalita | ESLint (typescript-eslint strictTypeChecked + pravidla čistoty enginu), dependency-cruiser (hranice), Prettier, husky + lint-staged, GitHub Actions |

---

## 7. Struktura repa

Jedna backendová služba: `services/api` volá ostatní služby jako funkce (žádné mikroslužby). Frontend komunikuje přes REST.

```
Hackathon/
├─ AGENTS.md  CLAUDE.md  SPEC.md
├─ package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json
├─ eslint.config.js  .dependency-cruiser.cjs  vitest.config.ts  vitest.shared.ts
├─ .claude/settings.json      # Stop hook → scripts/agent-verify.mjs (pnpm verify:fast)
├─ scenarios/supplier_delay.json
├─ runs/  out/  .cache/llm/
├─ packages/
│  ├─ schema/       # zod: scenario, evidence, run, artifacts, detective, api
│  ├─ llm/          # AI SDK + disk cache + offline režim
│  └─ test-utils/   # fixtures, temp dir, fakeGenerate
└─ services/
   ├─ noiser/       # src/compiler (validate, dag) + src/engine (rng, random, days, curves, processes/, run)
   ├─ dataer/       # src/store (DuckDB), evidence, detective (tools, score), compare
   ├─ cascade/      # steps A1–A4 (+A5), cascade.ts, prompts/, tests/evals
   ├─ api/          # Hono app, routes/, cli/, server.ts
   └─ frontend/     # Next.js: app/{pribeh,scenar,data,dukaz,detektiv,porovnani}, lib/api.ts
```

Každý workspace má podle potřeby `tests/unit`, `tests/integration`, `tests/property`, `tests/golden`.

### Skripty (z rootu)

```
pnpm dev                                  # api :4000 + web :3000
pnpm verify:fast | pnpm verify            # viz AGENTS.md
pnpm gen scenarios/supplier_delay.json --seed 42 [--scale 0.2]
pnpm cascade "<story>" "<company>"        # → runs/<runId>/0N_*.json
pnpm evidence out/…/x.duckdb
pnpm detective out/…/x.duckdb
pnpm compare a.duckdb b.duckdb
pnpm evals                                # evals agentů
```

---

## 8. Priority (MoSCoW) a harmonogram

**Must:** schema, compiler, engine, ruční scénář, evidence, compare, minimální UI.
**Should:** kaskáda A1–A5 s loopem, detektiv se skóre.
**Could:** noise blok, druhá doména, ERD, editor křivek s drag&drop.
**Won't:** obecné ontologie, tisíce tabulek, auth, deploy.

| Čas | Cíl |
|---|---|
| pá 18–20 | schema + ruční scénář + kostra enginu (entity, arrival) |
| pá 20–24 | engine end-to-end na `supplier_delay`, evidence; paralelně A1–A4 |
| so 00–04 | A5 loop, detektiv, UI stránky |
| so 04–09 | integrace, compare, druhý scénář, cache pro demo |
| so 09–11 | **freeze**, slidy, zkouška dema offline |
| so 12:00 | odevzdání |
