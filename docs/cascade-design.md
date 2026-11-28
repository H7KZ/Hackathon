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
- Pro každou pohnutou páku kód vezme story point, kde se nejvíc odchyluje od baseline (vrchol), a projde všechny cesty z páky. Směr = znaménko odchylky × součin znamének hran. Když k uzlu vedou cesty s opačným znaménkem, vyhraje silnější (síla = součin `p` pravděpodobnostních hran), pokud je aspoň 2× silnější; jinak se hypotéza vynechá. Páky se stejným vrcholem tvoří jednu sadu.
- Páka se `scope` (např. `SUP-002`) dá hypotéze `focus: only` a k ní kontrolu „mimo scope zůstane stabilní" (`focus: exclude`). Uzly mimo všechny cesty jsou kontroly `stable`.
- Vzácné události (uzel s příchozí pravděpodobnostní hranou, např. stížnosti, pozdní dodávky) kontrolu `stable` nedostanou: malé počty v pásmu ±15 % padaly na 3 z 5 seedů.
- Okna: `before` = baseline od začátku datasetu do prvního pohybu páky, bez prvních 4 týdnů (zahřátí flows), pokud je baseline aspoň 8 týdnů; `after` = vrcholový story point od startu do jeho `end` (nebo konce datasetu). Konec okna je exkluzivní. Živý běh 2026-11-27 porovnával sousední story pointy: okno `before` vyšlo prázdné (začátek = konec) a 18 z 27 hypotéz spadlo na chybě SQL.
- Agent dostane hypotézy, sloupce observed tabulek a vrátí `{queries: [{hypothesisId, sql}]}`. `checkQueries`: dotaz pro každou hypotézu, čte její tabulku, vrací `period`/`value`, čte jen observed tabulky (`checkExpectationTables`).
- Stav (`state`, snapshot flow) se měří jako podíl dní bez zásoby (`value <= 0`), takže hypotéza má opačný směr než hladina. Průměrná hladina nejde (u `supplier_delay` po zpoždění roste, protože se objednávky `topUp` překrývají) a dostupnost (`value > 0`) je u 1 stlačená: v 2. živém běhu klesla na všech 6 seedech jen o 6–10 %, podíl výpadků vzrostl o ~85 %. Stav, vzácná událost ani neúspěšný výstup větvení (záporná hrana z uzlu `branch`, např. neuskutečněný nákup při prázdném regálu) nedostanou kontrolu `stable`: jsou moc hlučné na pásmo ±15 % (ztracené prodeje mimo SUP-001 padaly ve 2. i 3. živém běhu).
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

### D5. Kaskáda smí spustit vložený story gate (nahrazuje „kaskáda nespouští noiser ani dataer")

- Kaskáda končí složeným `scenario.json`. Sama noiser ani dataer nevolá, ale `CascadeOptions.verify` jí může vložit pomalou kontrolu. API (`services/api/src/adapters/cascade.ts`) i CLI (`pnpm cascade`) tam dávají `storyGate` (`services/cascade/src/gate.ts`, PR #14).
- `storyGate`: noiser `generate` na seedu scénáře → `storeRun` do DuckDB (kontrola FK) → na sandboxu `runExpectations` a `baselineDrift` (objem tabulek před prvním segmentem křivky nesmí driftovat o víc než 35 %). Chyby jsou `{path, message}` jako chyby compileru.
- Ostatní kontroly uvnitř kaskády jsou čistý kód: zod, `checks.ts`, v causal variantě kontroly mapy a pokrytí (4a/4b), stavba křivek z matice a odvození hypotéz.
- Bez `verify` (unit testy, `runCascade` bez gate) se slabý efekt nebo chybné SQL ukáže až v evidence.

### D6. Složený scénář validuje `compileScenario`

- Na konci kaskády se volá `compileScenario` z `@s2d/noiser` (čistá funkce: zod, reference, DAG, rozsah datumů a `checkStoryRefs`, tj. id entit ve `scope` křivek a ve story pointech, `services/noiser/src/compiler/story.ts`). Engine spouští jen `verify` (D5).
- Generování datasetů a evidence po kaskádě řeší API: sessions (`routes/sessions.ts`, příkazy `approve`, `what_if`, `edit_scenario` v `orchestrator.ts`) a scénáře (`routes/scenarios.ts`).

### D7. Kaskáda se volá přes přístupové funkce

- `services/cascade/src/access.ts`: `cascade()`, `getRun()`, `listRuns()`, `saveArtifact()`, `newRunId()`.
- Stejný vzor jako noiser `generate()`: špatný vstup a chyba agenta vrací `{ ok: false, errors: {path, message}[] }`, nevyhazují výjimku. Neočekávané chyby (fs, bugy) se vyhodí a API z nich udělá 500.
- `saveArtifact()` ověří ruční úpravu schématem z `ArtifactSchemas` (`@s2d/schema/artifacts`) a smaže pozdější artefakty v pořadí `ArtifactName` (SPEC §2 pravidlo 9).
- API orchestrátor používá `runCascade` přímo přes port (`adapters/cascade.ts`), ne `cascade()`.

### D8. Smyčka oprav: compile, story checks a story gate (A5); whatIf bez gate

- A5 vrací jen `name`, `start`, `end`, `entities`, `flows`, `processes`. Meta (seed 42, id z runId), `curves`, `storyPoints` a `expectations` doplní kód z `00_input` a `04_story`.
- Smyčka A5 (`loop.ts` `repairLoop`, max 5 iterací): agent → složení kódem → `compileScenario` → story checks → `verify`. První neprázdný seznam chyb jde zpět agentovi, `verify` běží jen nad scénářem, který prošel compile i checks. Zod-neplatná odpověď je taky feedback. Každá iterace emituje `loop.iteration`.
- Od live běhu 4 (`keepBest`): agent dostane jako „Best attempt so far“ **nejlepší** dosavadní pokus (dál došlý stupeň schema < compile < check < story gate, pak méně chyb), ne poslední, a sekci „Earlier attempts“ s historií pokusů (`formatHistory`, označí chyby, které se vrátily). Neúspěšné expectations story gate doplní `describeLeverReach` (`reach.ts`): kde je každá páka použitá a jestli k měřené tabulce vede řetězec procesů (proces → tabulka, source → branch/derive, effect → flow → proces, hrany 03_influences). Resume pokračuje od nejlepšího odmítnutého pokusu s celou historií (stupeň je v `05_scenario.rejected-N.feedback.json`).
- Story checks A5 (`checks.ts`): `checkModelShape` (aspoň 5 tabulek, řetězec branch/derive), `checkCurveCoverage` (každá křivka z 04_story je použitá), `checkCurvesOnRoots` (křivka jen na parametr bez příchozí hrany v 03_influences), `checkExpectationTables` (SQL čte jen observed tabulky), `checkEntityIds` (id entit ze 04_story existují).
- Kroky A2–A4 mají checks přes `withSchemaRetry`: 02 `checkModelShape`; 03 `checkInfluenceRefs`; 04 `checkStoryPlan`, `checkExpectationTables`, `checkStoryRefs`.
- Po 3 neúspěších se `05_scenario` nezapíše, odmítnuté pokusy zůstanou v `05_scenario.rejected-N.json`, přijde `log` a `CascadeStepError`.
- whatIf: agent vrátí celé `curves` + záplaty existujících `Param` přes JSON pointer (mimo `meta`, `curves`, `storyPoints`, `expectations`). Kód je aplikuje na kopii, seed a struktura zůstanou. Smyčka má `compileScenario` a story check `checkCurveCoverage` (záplata nesmí odpojit křivku), **bez `verify`**: protipříklad nemusí splnit expectations základního příběhu. Po 3 neúspěších `WhatIfFailed`.
- Causal varianta nemá A5. `05_scenario` skládá kód (`finishCausal`: compile + `checkStoryPlan`, `checkModelShape`, `checkCurveCoverage`, `checkExpectationTables`), pak běží stejné `verify` jako ve v1. Chyby gate jdou zpět agentovi 4b (vlastní rate, počty, initial), nejvýš `GATE_REPAIRS` = 2 kola. Mapa, overlay, křivky a SQL zůstanou; oprava 4b musí zachovat tabulky a sloupce, které SQL čte (`checkQueries`), a přepíše `03b_processes.json`. Pak `CascadeStepError` a `log`.

## Otevřené otázky

- **Živé evaly PROŠLY (2026-11-28):** `supplier_delay_causal` (00:19) i `supplier_delay` v1 (00:27) splnily seed 42, ≥ 4/5 seedů i story gate. Nahrávky (16 souborů v `.cache/llm/`) se přehrají offline za ~11 s: `LLM_OFFLINE=1 LLM_MODEL_01_COMPANY=anthropic:claude-haiku-5-5 LLM_MODEL_03_INFLUENCES=anthropic:claude-haiku-5-5 pnpm evals`. Kroky 01 a 03 byly nahrané na Haiku, ostatní na `anthropic:claude-sonnet-5-5`; klíč cache obsahuje model.
- **Nahrání cache.** K 2026-11-27 nebylo v `.cache/llm/` nahraná žádná odpověď (ani pro v1), oba evaly se offline přeskočí. Varianta v1 zůstává výchozí a funguje, ale konvence jmen hran v promptu A3 mění klíč cache v1 od kroku 03 dál. Nahrávku v1 pořízenou před sloučením této změny je proto potřeba nahrát znovu; nahrávat až po sloučení. Prompty causal varianty: `services/cascade/src/prompts/causal.ts`.
- **Agent 6 per úsek.** Matici vrací jeden agent (`04a_overlay`), žádní subagenti per úsek. Hranice úseků = story pointy, které agent sám navrhne.
- **Tvary křivek.** Kód staví jen `step`. Pozvolný náběh (ramp) by potřeboval pravidlo, kdy ho kód zvolí.
- **Kompatibilita druhů uzlů a typů hran.** Kontroluje se jen „žádná hrana do páky", „páka a větvení mají výstup" a realizace podle typu hrany. Např. „mechanická hrana musí končit ve `state`" kód nehlídá.
- **Chyby ve 05 (causal).** Chyby gate jdou zpět 4b (2 kola). Chyby compile nebo story checks ve 05 nejdou nikomu (vznikají z 04a/04b, které už prošly vlastními kontrolami); úpravou 04_story nebo 03b_processes v UI se 05 přepočítá.
- **Živý běh 2026-11-27** (Sonnet 5.5, bez gate v evalu): artefakty 01–05 validní, 05 se zkompiloval, expectations neprošly. Kromě prázdných oken: 4b nechal páku za podmínkou `if supplier_role == "hlavní"`, takže scope `SUP-001` na křivce nic neměnil, a zásoby byly s pevným množstvím dodávek trvale na 99 %. Na to jsou nové pokyny v promptu 4b a zpětná vazba gate → 4b.
- **2. živý běh 2026-11-27** (s gate → 4b): 4b model opravil (`topUp`, křivka přímo, těsné zásoby), ze 9 hypotéz neprošly 3 a drift. Přepočet offline na seedech 42, 1..5: zásoby se změnou metriky na podíl výpadků projdou všude; zbývá slabý pokles prodejů SUP-001 (−3 až −10 %, projde 2/6) a kontrola ztracených prodejů mimo SUP-001 (jen seed 42, zahřátí v lednu). To je kalibrace 4b, ne kód. Drift kontrola v `gate.ts` (#14) zahřátí nevynechává, na rozdíl od oken hypotéz.
- **3. živý běh 2026-11-27:** zásoby i prodeje prošly, zbyla kontrola ztracených prodejů mimo SUP-001 a drift `lost_sale` (4,2 → 6,7 řádku/den leden → únor). Není to šum po dnech, ale vlna přes několik týdnů (týdenní `topUp` s těsnou zásobou), takže gate má pravdu. Kontrola na výstup větvení už nevzniká; kalibrace 4b dostala konkrétní pravidlo (krytí ~2 týdny poptávky, výpadky v baseline < 2 % dní). Přepočet offline s novými hypotézami: seed 42 projde celý, prodeje SUP-001 padají na seedech 1 a 2 (eval chce 4/5), drift zůstává. Obojí musí vyřešit 4b v dalším živém běhu.
- **Znaménka přes větvení.** Znaménko hrany z uzlu `branch` (fulfil → lost_sale = negative) dává směr jen tehdy, když ho 4a nakreslí konzistentně (víc zásoby → víc vyřízených → méně ztrát). Kód to neověřuje.
- **whatIf** pracuje se složeným scénářem a o mapě neví; křivky může měnit libovolně, ne přes matici.
- Kalibrace: kdo nastaví „pozaďová“ čísla (rate, initial), aby efekt byl vidět a data realistická.
