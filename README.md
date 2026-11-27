# Story2Data — 4FIS Hackathon 2026

Generátor propojených datasetů, ve kterých je zadaný příběh kauzálně zapsaný v záznamech (výzva FIS VŠE).

- Specifikace: [SPEC.md](SPEC.md)
- Pravidla pro vývoj a AI agenty: [AGENTS.md](AGENTS.md)
- Rešerše výzev: [docs/](docs/)

## Start

```sh
pnpm install
cp .env.example .env   # doplň ANTHROPIC_API_KEY
pnpm dev               # API http://localhost:4000, UI http://localhost:3000
```

## Ověření

```sh
pnpm verify:fast   # typecheck + lint + unit testy
pnpm verify        # vše včetně hranic mezi moduly a buildu
```
