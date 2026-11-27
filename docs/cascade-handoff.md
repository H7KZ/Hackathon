# Handoff: kaskáda agentů

Stav k 2026-11-27 večer. Design: [`docs/cascade-design.md`](cascade-design.md) (rozhodnutí D1–D7).

## Kde to je

- Větev `worktree-feat+cascade-design`, worktree `.claude/worktrees/feat+cascade-design`, postavená na `origin/main` (`4e67ed3`). **Nepushnuto.**
- Commity: `feat(cascade): access functions for the API + design doc` a tento handoff.
- Lokálně necommitnuté (nepatří do PR):
  - `pnpm-workspace.yaml`: `minimumReleaseAgeExclude` pro 11 balíčků mladších než 1 den, bez toho neprojde `pnpm install`. Pokud to má platit pro celý tým, musí to jít na `main` a domluvit se v týmu.
  - `.claude/settings.json`: z `main` se nepřepsal (sandbox ho chránil). Srovnat přes `git checkout .claude/settings.json`.

## Je kaskáda nadesignovaná?

**Princip ano, detail kroků ne.**

| Oblast | Stav |
|---|---|
| Princip: agenti vrací části JSONu, kód je skládá | dohodnuto (D1–D5) |
| Typované hrany kauzální mapy, rozdělení agenta 4 na 4a/4b | dohodnuto, tvar artefaktu navržen (níže) |
| Křivky z matice kódem, expectations odvozené kódem | dohodnuto, algoritmus nenapsaný |
| Validace přes `compileScenario`, žádný noiser/dataer v kaskádě | dohodnuto (D5, D6) |
| Přístupové funkce pro API | **hotovo** a otestováno (D7) |
| Agenti 1–3 (firma, objekty, atributy) | jen popis role, tvar artefaktu chybí |
| Agent 5 (overlay příběhu) a 6 (subagenti per úsek) | jen popis role, tvar artefaktu a hranice úseků chybí |
| Prompty, few-shot, evals | nic, současné prompty patří ke starému návrhu |

Kód v `services/cascade/src/steps.ts` je pořád **starý skeleton** A1–A4 (`01_company … 04_story`). Nový design ho nahradí.

## Navržený tvar 4a / 4b (ještě není v `packages/schema`)

```ts
// 4a causal_map
nodes: [{ id, kind: "lever" | "event" | "state" | "attribute" | "branch",
          label, ref?, visibility?, baseline? }]
edges: [{ id, from, to, type: "probabilistic" | "mechanical" | "attribute",
          sign: 1 | -1, role?: "source" | "condition", p?, lagDays?, rationale }]

// 4b processes
{ flows: FlowDef[], processes: ProcessDef[], trace: Record<edgeId, string[]> }  // JSON pointery do scénáře
```

Kontroly v kódu:

- **4a:** reference uzlů; `ref` míří na entity a tabulky z kroků 2–3; druh uzlu sedí k typu hrany; větvení má jednu `condition` a výstupy `then`/`else` s opačným znaménkem; cyklus jen přes `state`; z každé páky vede cesta do `observed` události.
- **4b:** každý pointer v `trace` existuje a jeho druh odpovídá typu hrany; pokrytí oběma směry (hrana ↔ proces); páky se píšou jako `{curve: <leverId>}`.

## Další kroky (v tomhle pořadí)

1. **Schéma artefaktů** v `packages/schema/src/artifacts.ts` pro kroky 1–6 (včetně 4a/4b výše). Je to změna kontraktu, **předem ji schvaluje owner schématu** (AGENTS.md). Pak upravit mapu `SCHEMAS` v `access.ts` a pořadí v `cascade.ts`.
2. **Čistý kód kaskády** (unit testy s pevnými vstupy, bez LLM):
   - kontroly 4a a pokrytí 4b,
   - matice → `CurveDef` (navazování úseků, `scope`, `clamp`),
   - odvození hypotéz expectations: znaménka po cestách z pohnutých pák; uzly mimo cesty jsou `stable`,
   - složení `scenario.json` + `compileScenario`.
3. **Doladit design zbylých agentů:** hranice mezi 2 (objekty) a 3 (atributy); tvar overlaye (5); jak se z overlaye určí úseky a jestli subagenti (6) běží paralelně.
4. **Prompty** s `scenarios/supplier_delay.json` jako vzorem. Pak `pnpm evals` offline; nahrávání (`EVAL_LIVE=1`) jen po domluvě, je placené.
5. **API route** `/cascade` nad přístupovými funkcemi, až se `feat/api-runs` dostane na `main`. Hotové funkce: `cascade`, `getRun`, `listRuns`, `saveArtifact`, `newRunId` z `@s2d/cascade`.

## Otevřené otázky

Viz konec [`cascade-design.md`](cascade-design.md): tvar 4a/4b v zod, agent 6 (paralelně, hranice úseků), smyčka oprav per krok, kalibrace čísel v pozadí.

## Gotchas

- `runCascade` dál vyhazuje výjimky (`CascadeStepError`, `CascadeRunMismatch`), protože na něm stojí CLI (`pnpm cascade`), a to i na `feat/api-runs`. API má volat `cascade()`.
- Agent v sandboxu nespustí pnpm (zámek storu v `~/Library/pnpm`). Kontroly jde pustit přímo přes `./node_modules/.bin/{tsc,eslint,vitest,depcruise}`, ale pre-commit hook a `pnpm verify:fast` potřebují pnpm.
