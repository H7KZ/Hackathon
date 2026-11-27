# Kaskáda agentů — design (živý dokument)

Rozpracovává SPEC §3.A. Stav: **dohodnutý princip**, detail kroků se doplňuje postupně.

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

### D2. Agenti 5–6 vrací body, křivky staví kód

- LLM vrací jen hodnoty vstupních atributů (parametrů) v časových úsecích, např. `late_prob` březen–duben 0,05 → 0,6.
- Kód z matice deterministicky postaví `CurveDef` (`segments`, `scope`, `clamp`). LLM nepíše datumy segmentů ani tvary.
- Matice smí obsahovat **jen vstupní atributy** (páky). Výsledné ukazatele (tržby, stížnosti) musí vyplynout z modelu (SPEC §2 pravidlo 4).
- Navazování úseků hlídá kód: konec úseku *i* = začátek úseku *i+1*.

### D3. Expectations odvozuje kód, LLM píše jen SQL

- Z overlaye (které páky se hýbou a kterým směrem) a kauzální mapy (znaménka hran po cestě) kód spočítá, co má stoupnout, klesnout a zůstat stabilní.
- Ukazatele, které neleží na žádné cestě z pohnuté páky, jsou automaticky **kontroly** (`stable`).
- LLM dostane hotovou hypotézu (ukazatel, směr, období) a napíše k ní jen SQL.

### D4. Agent 4 je rozdělený na 4a (mapa) a 4b (procesy)

- **4a `causal_map`**: jen konceptuální graf. Uzly mají druh `lever | event | state | attribute | branch`, hrany typ z D1, znaménko a u pravděpodobnostních i baseline `p`.
- **4b `processes`**: z mapy vyrobí `flows` + `processes` a ke každé hraně uvede, kde ve scénáři je realizovaná (`trace: edgeId → JSON pointer`).
- Kód kontroluje pokrytí oběma směry: každá hrana je realizovaná, každý proces vede na nějakou hranu, a druh realizace odpovídá typu hrany.

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

## Otevřené otázky

- Validace složeného scénáře: použít `compileScenario` (čistá funkce, leží ve workspace `noiser`), nebo jen zod + vlastní kontroly kaskády?

- Agent 4a/4b: přesný zod tvar artefaktů, pravidla kompatibility druhů uzlů a typů hran.
- Agent 6: běží subagenti per úsek paralelně? Jak se určí hranice úseků (z overlaye)?
- Smyčka oprav: kde a jak se vrací chyby compileru / neprošlé expectations (per krok vs. jen na konci).
- Kalibrace: kdo nastaví „pozaďová“ čísla (rate, initial), aby efekt byl vidět a data realistická.
