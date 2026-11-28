# Story2Data — 4FIS Hackathon 2026

Generátor propojených datasetů, ve kterých je zadaný příběh **kauzálně zapsaný v záznamech**, ne jen popsaný (výzva FIS VŠE).

Zadáš příběh („dodavatel začne v březnu zpožďovat dodávky“) a firmu. Agenti z toho sestaví konfiguraci, deterministický engine z ní vygeneruje tabulky a nezávislé kontroly ověří, že příběh v datech opravdu je.

## Jak to funguje

```mermaid
flowchart LR
    story["Příběh + firma"] --> cascade["Kaskáda agentů<br/>A1–A5 (LLM)"]
    cascade --> scenario[("scenario.json")]
    scenario --> engine["Engine<br/>deterministický, seed"]
    engine --> db[("DuckDB")]
    db --> evidence["Důkaz<br/>SQL hypotézy + grafy"]
    db --> detective["Slepý detektiv<br/>LLM nad daty"]
    db --> compare["Porovnání<br/>běh A vs B"]
    scenario -. "chyby kompilace" .-> cascade
```

Tři pravidla, na kterých vše stojí:

1. **LLM píše jen konfiguraci**, nikdy řádky dat ani kód.
2. **Engine je deterministický**: stejný scénář + seed ⇒ stejná data.
3. **Příběh jen přes křivky na parametrech.** Výsledné metriky (tržby, stížnosti) z nich musí vyplynout.

## Struktura repa

Jedna backendová služba (`api`), ostatní služby volá jako obyčejné funkce.

```mermaid
flowchart TD
    frontend["services/frontend<br/>Next.js UI"] -- REST --> api["services/api<br/>Hono + CLI"]
    api --> cascade["services/cascade<br/>agenti A1–A5"]
    api --> dataer["services/dataer<br/>DuckDB, důkaz, detektiv"]
    cascade --> noiser["services/noiser<br/>compiler + engine"]
    cascade --> dataer
    noiser --> schema["packages/schema<br/>zod kontrakt"]
    dataer --> schema
    cascade --> llm["packages/llm<br/>LLM + cache"]
    dataer --> llm
```

## Start

```sh
pnpm install
cp .env.example .env   # doplň ANTHROPIC_API_KEY
pnpm dev               # API http://localhost:4000, UI http://localhost:3000
pnpm demo              # totéž offline z nahrané LLM cache, bez API klíče
```

## Ověření

```sh
pnpm verify:fast   # hranice + typecheck + lint + unit testy (~30 s)
pnpm verify        # vše včetně formátu, všech testů a buildu
```

## Kam dál

- [SPEC.md](SPEC.md) — specifikace a kontrakt scénáře
- [AGENTS.md](AGENTS.md) — pravidla pro vývoj, git workflow a AI agenty
- [docs/](docs/) — návrh kaskády, demo data, rozhodnutí, gotchas
