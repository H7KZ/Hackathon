# Kaskáda agentů — design (živý dokument)

Rozpracovává SPEC §3.A. Stav (2026-11-27): kaskáda má **dvě varianty** za přepínačem `CascadeOptions.design`:

- `"v1"` (výchozí, na ní stojí demo): A1 company → A2 model → A3 influences → A4 story → A5 detail. LLM píše křivky i expectations, kód je kontroluje (`services/cascade/src/checks.ts`).
- `"causal"`: D1–D4 níže, postavené v `services/cascade/src/causal/`. Zapíná se `CASCADE_DESIGN=causal` (API), `pnpm cascade ... --design causal` (CLI). LLM cache pro ni zatím není nahraná.

Artefakty varianty `causal` (`runs/<runId>/`):

| Soubor | Kdo | Obsah |
|---|---|---|
| `01_company`, `02_model` | A1, A2 (stejné jako v1) | firma, entity + kostra procesů |
| `03a_causal_map` | agent 4a | `CausalMap`: uzly a typované hrany (D1) |
| `03b_processes` | agent 4b, smyčka oprav | `ProcessesPlan`: entities, flows, processes + `trace` (D4) |
| `04a_overlay` | agent 5–6 | `StoryOverlay`: name, start, end, storyPoints, matice páka × úsek (D2) |
| `04b_expectations` | kód + agent na SQL | `ExpectationsPlan`: hypotézy (kód) + SQL (agent) (D3) |
| `04_story` | kód | `StoryPlan` složený z 04a + 04b (UI časová osa ho edituje stejně jako ve v1) |
| `05_scenario` | kód | `assembleCausal` + `compileScenario` + story checks, bez LLM |

## Princip

Kaskáda = postupně volaní agenti. Každý odvede kus práce a vrátí **část JSONu** (zod artefakt v `runs/<runId>/NN_name.json`).
Části se **v kódu** (deterministicky) složí do `scenario.json`, který dostane noiser (data) a dataer (důkaz).

```
1 Firma a prostředí      → company (kontext)
2 Objekty                → entities, tabulky událostí (name, count, idPrefix)
3 Atributy               → fields (generátory polí, FK)
4 Vztahy ukazatelů       → kauzální mapa s typovanými hranami → processes, flows
5 Overlay příběhu        → storyPoints: fáze per vstupní atribut
6 Subagenti per úsek     → matice čas × hodnota (body, kudy jdou křivky)
  ── kód ──
  matice → curves, mapa + overlay → expectations (hypotézy), složení + compiler
```

## Dohodnutá rozhodnutí

### D1. Hrany kauzální mapy mají typ (agent 4)

Noiser simuluje události den po dni, není to Bayesovská síť nad ukazateli. Každá hrana proto nese typ, který určuje, čím se ve scénáři realizuje:

| Typ hrany | Příklad | Realizace ve scénáři |
|---|---|---|
| pravděpodobnostní | výpadek → stížnost, p = 0,25 | `derive` / `branch` s `bernoulli`, `p` |
| mechanická | dodávka → zásoba → prodej | `flow` + `effects` + cond `flowGte` |
| atributová | produkt → dodavatel → zpoždění | `lookup` / `if` v `fields` |

Podmíněné pravděpodobnosti existují jen u pravděpodobnostních hran; ostatní efekty vznikají mechanikou.

Postaveno: `CausalEdge` (`packages/schema/src/artifacts.ts`) má `id`, `from`, `to`, `type`, `sign` (`positive | negative`), u pravděpodobnostních povinné `p` (hlídá `checkCausalMap`, `causal/map.ts`). Mapa musí být acyklická, páky jsou kořeny (žádná hrana do páky) s `baseline` a aspoň jednou výstupní hranou, větvení má výstupní hranu.

Varianta v1 dostala levnou náhradu (varianta C z briefu): hrany `03_influences` smí odkazovat jen na `<process_id>`, `<process_id>.<param|pole>`, `<tabulka>`, `<entita>.<pole>` nebo `<flow_id>` z 02_model (`checkInfluenceRefs`) a křivka v A5 smí řídit jen parametr bez příchozí hrany (`checkCurvesOnRoots`).

### D2. Agenti 5–6 vrací body, křivky staví kód

- LLM vrací jen hodnoty vstupních atributů (parametrů) v časových úsecích, např. `late_prob` březen–duben 0,05 → 0,6.
- Kód z matice deterministicky postaví `CurveDef` (`segments`, `scope`, `clamp`). LLM nepíše datumy segmentů ani tvary.
- Matice smí obsahovat **jen vstupní atributy** (páky). Výsledné ukazatele (tržby, stížnosti) musí vyplynout z modelu (SPEC §2 pravidlo 4).
- Navazování úseků hlídá kód: konec úseku *i* = začátek úseku *i+1*.

Postaveno (`causal/curves.ts`): úseky = story pointy. Řádek matice je `{lever, scope?, values: [{storyPointId, value}]}`. `buildCurves` udělá z každé páky mapy jednu křivku s `id` = id páky: segmenty `step` na datech story pointů, hodnota rovná baseline se vynechá, nepohnutá páka zůstane plochá na baseline, pravděpodobnost dostane `clamp [0, 1]`. Úsek s `end` vrací páku po konci na baseline, poslední úsek bez `end` drží hodnotu. Tvar (ramp, spike) LLM nevolí, vždy je to `step`. `checkOverlay` hlídá: jen páky mapy, známé story pointy, souvislé úseky; pak se složený scénář musí zkompilovat (`checkOverlayScenario`).

### D3. Expectations odvozuje kód, LLM píše jen SQL

- Z overlaye (které páky se hýbou a kterým směrem) a kauzální mapy (znaménka hran po cestě) kód spočítá, co má stoupnout, klesnout a zůstat stabilní.
- Ukazatele, které neleží na žádné cestě z pohnuté páky, jsou automaticky **kontroly** (`stable`).
- LLM dostane hotovou hypotézu (ukazatel, směr, období) a napíše k ní jen SQL.

Postaveno (`causal/hypotheses.ts`, `causal/sql.ts`):

- Ukazatel = uzel `event` nebo `state` s `table`, která je `observed`. ground_truth tabulky (pokusy o nákup, neuskutečněné nákupy) hypotézu nedostanou.
- Pro každý story point, kde se páka pohne (proti předchozímu navazujícímu úseku nebo baseline), se projdou všechny cesty z páky. Směr = znaménko pohybu × součin znamének hran. Když k uzlu vedou cesty s opačným znaménkem, vyhraje silnější (síla = součin `p` pravděpodobnostních hran), pokud je aspoň 2× silnější; jinak se hypotéza vynechá.
- Páka se `scope` (např. `SUP-002`) dá hypotéze `focus: only` a k ní kontrolu „mimo scope zůstane stabilní" (`focus: exclude`). Uzly mimo všechny cesty jsou kontroly `stable`.
- Vzácné události (uzel s příchozí pravděpodobnostní hranou, např. stížnosti, pozdní dodávky) kontrolu `stable` nedostanou: malé počty v pásmu ±15 % padaly na 3 z 5 seedů.
- Okna: `before` = od začátku datasetu (nebo předchozího story pointu) do startu story pointu, `after` = od startu do jeho `end` (nebo konce datasetu), konec okna je exkluzivní.
- Agent dostane hypotézy, sloupce observed tabulek a vrátí `{queries: [{hypothesisId, sql}]}`. `checkQueries`: dotaz pro každou hypotézu, čte její tabulku, vrací `period`/`value`, čte jen observed tabulky (`checkExpectationTables`).
- Stav (`state`, snapshot flow) se měří jako dostupnost (podíl řádků s `value > 0`), ne průměrná hladina: u `supplier_delay` hladina zásob SUP-002 po zpoždění roste (objednávky `topUp` se překrývají), dostupnost klesá.
- Integrační test `tests/integration/causal_gate.test.ts`: odvozené hypotézy `supplier_delay` (4 směrové + 2 kontroly) projdou na seedu 42 i na seedech 1..5.

### D4. Agent 4 je rozdělený na 4a (mapa) a 4b (procesy)

- **4a `causal_map`**: jen konceptuální graf. Uzly mají druh `lever | event | state | attribute | branch`, hrany typ z D1, znaménko a u pravděpodobnostních i baseline `p`.
- **4b `processes`**: z mapy vyrobí `flows` + `processes` a ke každé hraně uvede, kde ve scénáři je realizovaná (`trace: edgeId → JSON pointer`).
- Kód kontroluje pokrytí oběma směry: každá hrana je realizovaná, každý proces vede na nějakou hranu, a druh realizace odpovídá typu hrany.

Postaveno (`causal/trace.ts`, `causal/steps.ts`): 4b běží ve smyčce oprav (max 3 iterace) nad dočasným scénářem s plochými křivkami pák a rozsahem 2025-01-01..2025-12-31, `compileScenario` + `checkModelShape` + `checkTrace`. `checkTrace`:

- každá hrana má `trace` a ukazatel (RFC 6901) se vyhodnotí; neznámé id hrany v `trace` je chyba;
- druh realizace v cíli ukazatele odpovídá typu hrany (`REALIZES`): pravděpodobnostní → `derive` / `bernoulli` / `branch`; mechanická → `effect` / `flowGt(e)` / `topUp` / `rate` / `arrival` / `branch`; atributová → `lookup` / `if` / `fieldEq|fieldGt` / `pick` / `ref`. Ukazatel na celý proces `/processes/<i>` znamená jeho typ;
- hrana z páky musí v cíli použít `{"curve": "<id páky>"}`;
- každý `branch`/`derive` proces je cílem (nebo předponou cíle) nějakého ukazatele; arrival se nevyžaduje (je to zdroj události, ne hrana);
- `{curve}` smí odkazovat jen na páky a každá páka musí být použitá (pravidlo 3 v AGENTS.md hlídá kód);
- tabulky uzlů mapy musí existovat.

Proti původnímu návrhu: kroky 2 a 3 (objekty, atributy) zůstaly jedním A2 (`02_model`); 4b dostane jeho kostru a vrací finální entity, flows a procesy. A5 v causal variantě není, `05_scenario` skládá kód.

Mapování mapy na scénář:

| V mapě | Ve scénáři |
|---|---|
| událost bez vstupní události, poháněná pákou | `arrival` s `rate: {curve}` |
| pravděpodobnostní hrana událost → událost | `derive` s `p`, `lag` |
| větvení s podmínkou na stavu | `branch` s `flowGte`, výstupy `then`/`else` |
| mechanická hrana událost → stav | `effect` (+/−) na flow |
| páka → atribut | `bernoulli`/`normal` s `{curve}` |
| atributová hrana (produkt → dodavatel) | `lookup` v polích |

### D5. Kaskáda nespouští noiser ani dataer

- Kaskáda končí složeným `scenario.json`. Generování dat (noiser engine) a důkaz (dataer) navazují až po ní.
- Uvnitř kaskády běží jen čistý kód: zod, kontroly pokrytí mapy (4a/4b), stavba křivek z matice, odvození hypotéz pro expectations.
- Žádná zkušební generace dat ani smyčka nad expectations. Chyby v SQL nebo slabý efekt se ukážou až v evidence.

### D6. Složený scénář validuje `compileScenario`

- Na konci kaskády se zavolá `compileScenario` z `@s2d/noiser` (čistá funkce: reference, DAG, rozsah datumů). Engine se nespouští.
- Spouštění noiseru a dataeru řeší API (`POST /runs` na větvi `feat/api-runs`).

### D7. Kaskáda se volá přes přístupové funkce

- `services/cascade/src/access.ts`: `cascade()`, `getRun()`, `listRuns()`, `saveArtifact()`, `newRunId()`.
- Stejný vzor jako noiser `generate()`: špatný vstup a chyba agenta vrací `{ ok: false, errors: {path, message}[] }`, nevyhazují výjimku.
- `saveArtifact()` ověří ruční úpravu schématem a smaže pozdější artefakty (SPEC §2 pravidlo 9).

### D8. Smyčka oprav = jen `compileScenario` (A5 i whatIf)

- A5 vrací jen `name`, `start`, `end`, `entities`, `flows`, `processes`. Meta (seed 42, id z runId), `curves`, `storyPoints` a `expectations` doplní kód z `00_input` a `04_story`.
- Smyčka: agent → složení kódem → `compileScenario` → chyby zpět agentovi, max 3 iterace. Zod-neplatná odpověď je taky feedback. Každá iterace emituje `loop.iteration`.
- Po 3 neúspěších se `05_scenario` nezapíše, přijde `log` a `CascadeStepError` (nekompilující scénář nejde dát noiseru).
- whatIf: agent vrátí celé `curves` + záplaty existujících `Param` přes JSON pointer (mimo `meta`, `curves`, `storyPoints`, `expectations`). Kód je aplikuje na kopii, seed a struktura zůstanou. Po 3 neúspěších `WhatIfFailed`.
- Engine na vzorku a expectations ve smyčce **nejsou** (D5). Handoff API (`docs/handoffs/cascade.md`) s tím počítal; gate „expectations ≥ 4/5 seedů" se ověřuje až v evidence.

## Otevřené otázky

- **Nahrání cache.** Varianta `causal` nemá nahrané LLM odpovědi; eval `supplier_delay_causal` se offline přeskočí. Prompty: `services/cascade/src/prompts/causal.ts`. Změna promptu A3 (konvence jmen hran) změnila klíč cache i pro v1 od kroku 03.
- **Agent 6 per úsek.** Matici vrací jeden agent (`04a_overlay`), žádní subagenti per úsek. Hranice úseků = story pointy, které agent sám navrhne.
- **Tvary křivek.** Kód staví jen `step`. Pozvolný náběh (ramp) by potřeboval pravidlo, kdy ho kód zvolí.
- **Kompatibilita druhů uzlů a typů hran.** Kontroluje se jen „žádná hrana do páky", „páka a větvení mají výstup" a realizace podle typu hrany. Např. „mechanická hrana musí končit ve `state`" kód nehlídá.
- **Chyby ve 05.** Když složený scénář v causal variantě neprojde, přijde `CascadeStepError` a `log`. Chyby se nevrací žádnému agentovi (úpravou 04_story nebo 03b_processes v UI se 05 přepočítá).
- **Znaménka přes větvení.** Znaménko hrany z uzlu `branch` (fulfil → lost_sale = negative) dává směr jen tehdy, když ho 4a nakreslí konzistentně (víc zásoby → víc vyřízených → méně ztrát). Kód to neověřuje.
- **whatIf** pracuje se složeným scénářem a o mapě neví; křivky může měnit libovolně, ne přes matici.
- Kalibrace: kdo nastaví „pozaďová“ čísla (rate, initial), aby efekt byl vidět a data realistická.
