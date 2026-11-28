# Scénář: jak vypadá teď a jak by mohl vypadat

Příklad na `scenarios/supplier_delay.json`. Část B je **návrh**: bloky označené 🟢 projdou dnešním schématem, bloky 🟡 vyžadují změnu `packages/schema` (nejdřív schválí vlastník).

---

## A. Teď

### Kauzální řetězec

```
curve late_prob (SUP-002: 0.05 → 0.8, ramp 1. 3.–15. 4.)
        │
        ▼
delivery (arrival, každých 7 dní per [store, product])
   is_late ~ bernoulli(late_prob) → delay_days 30–60 → actual_date
        │  effect: +quantity do flow stock v actual_date
        ▼
flow stock[store, product] ──► stock_daily (snapshot)
        ▲
        │  effect: −quantity
purchase_attempt (arrival, rate = demand × 0.06 per customer, ground_truth)
   product_id ~ pick(product)          ← rovnoměrně
        │
        ▼
fulfil (branch: stock ≥ quantity?)
   ├─ then → sale
   └─ else → lost_sale (ground_truth)
                 │
                 ▼
            complaint_oos (derive, p = 0.25, lag 0–3) → complaint
```

### Co je na tom „ploché“

| Místo | Dnes | Proč to vadí |
|---|---|---|
| `curves.demand` | `baseline: 1`, žádné segmenty | Žádný víkend, žádné svátky. Skutečná data takhle nevypadají. |
| `purchase_attempt.product_id` | `pick` bez vah | Všech 24 produktů se prodává stejně. |
| `customer.home_store_id` | `pick` bez vah | Všech 5 prodejen je stejně velkých. |
| `curves` | jen 1 příběhová křivka | Detektiv nemá co odlišovat, jediná změna v datech je ta správná. |
| `sale.unit_price` | `lookup` ceny produktu | Cena se za 8 měsíců nikdy nezmění. |
| `customer` | statický | Zákazník po výpadku dál nakupuje stejně, chybí zpětná vazba. |
| `noise` | nepoužito | Data jsou „příliš čistá“. |

---

## B. Jak by mohl vypadat

Jsou tu jen změněné nebo přidané části, zbytek zůstává stejný.

### 1. 🟢 Popularita produktů a velikost prodejen (funguje dnes)

```jsonc
// entities.product.fields
"popularity": { "gen": "normal", "mean": 1, "sd": 0.6, "min": 0.1 },

// entities.store.fields
"size": { "gen": "categorical", "values": ["malá", "střední", "velká"], "weights": [0.4, 0.4, 0.2] },
"traffic": { "gen": "normal", "mean": 1, "sd": 0.4, "min": 0.3 },

// entities.customer.fields
"home_store_id": { "gen": "pick", "entity": "store", "weightBy": "traffic" },

// processes.purchase_attempt.fields
"product_id": { "gen": "pick", "entity": "product", "weightBy": "popularity" }
```

Efekt: několik bestsellerů a jedna velká prodejna. Výpadek SUP-002 se projeví nerovnoměrně podle toho, jestli jsou jeho produkty populární.

### 2. 🟢 Druhá fáze příběhu: zotavení (funguje dnes)

```jsonc
// curves.late_prob.segments
{ "kind": "ramp", "start": "2025-03-01", "end": "2025-04-15", "to": 0.8, "storyPointId": "sp1" },
{ "kind": "step", "start": "2025-07-01", "to": 0.1, "storyPointId": "sp2" }

// storyPoints
{
  "id": "sp2", "phase": 2,
  "title": "Firma vyjednala nápravu se SUP-002",
  "description": "Od 1. 7. klesá podíl pozdních dodávek SUP-002 na 10 %, zásoby a tržby se vracejí.",
  "entity": { "name": "supplier", "ids": ["SUP-002"] },
  "start": "2025-07-01"
}
```

Efekt: příběh má začátek, krizi i konec, takže detektiv musí najít dva zlomy.

### 3. 🟡 Sezónnost na křivkách

```jsonc
// curves.demand
{
  "id": "demand",
  "baseline": 1,
  "seasonality": {
    "weekly": [0.8, 0.85, 0.9, 1.0, 1.25, 1.5, 0.7],   // po–ne
    "holidays": { "calendar": "cz", "factor": 0.2 }      // státní svátky ČR
  },
  "segments": []
}
```

Schéma: nové volitelné pole `CurveDef.seasonality`. Engine ho vynásobí v `curves.ts` a je to dál čistá funkce dne.
Efekt: detektiv musí odlišit pravidelný týdenní rytmus od skutečného zlomu.

### 4. 🟡 Distraktor (red herring)

```jsonc
// curves
{
  "id": "garden_promo",
  "baseline": 1,
  "scope": { "field": "self.category", "ids": ["zahrada"] },
  "segments": [
    { "kind": "spike", "start": "2025-05-01", "end": "2025-05-20", "to": 2.0, "storyPointId": "d1" }
  ]
}
// purchase_attempt: váha produktů = popularity × garden_promo

// storyPoints
{ "id": "d1", "phase": 0, "distractor": true,
  "title": "Jarní akce na zahradu", "description": "Krátký nárůst poptávky po zahradním zboží, s příběhem nesouvisí.",
  "start": "2025-05-01", "end": "2025-05-20" }
```

Schéma: `StoryPoint.distractor?: boolean`. Detektiv zahradní akci najít smí, ale nesmí ji označit za příčinu poklesu tržeb.
Poznámka: aby `weightBy` respektoval křivku, musí `pick` umět váhu jako `Param`, nejen jako pole entity.

### 5. 🟡 Zpětná vazba: zákazníci odcházejí

```jsonc
// flows
{
  "id": "satisfaction",
  "keys": ["customer"],
  "initial": { "gen": "const", "value": 1 },
  "min": 0.2
}

// branch fulfil.else.effects (lost_sale)
{ "flow": "satisfaction", "keys": { "customer": "self.customer_id" }, "delta": "self.penalty", "sign": -1 }
// lost_sale.fields: "penalty": { "gen": "const", "value": 0.15 }

// processes.purchase_attempt
"rate": { "curve": "demand", "scale": 0.06, "flow": "satisfaction" }   // rate × satisfaction[customer]
```

Schéma: `Param` umí číst úroveň flow. Efekt: výpadek způsobí **trvalý** pokles nákupů dotčených zákazníků, i u produktů jiných dodavatelů. Kauzální řetězec je tak delší a zajímavější.
Pozor: kolidovalo by to s očekáváním `e4` („tržby ostatních dodavatelů stabilní“). To by se muselo přepsat.

### 6. 🟡 Ceny v čase

```jsonc
// curves
{ "id": "price_index", "baseline": 1, "segments": [
  { "kind": "step", "start": "2025-04-01", "to": 1.08, "storyPointId": "d2" }   // plošné zdražení 8 %
] }

// sale.fields
"unit_price": { "gen": "lookupScaled", "entity": "product", "key": "source.product_id",
                "field": "price", "by": { "curve": "price_index" } }
```

Efekt: tržby by plošným zdražením samy vzrostly. To je další distraktor, protože zakryje část poklesu u SUP-002.

### 7. 🟢 Šum (schéma ho má, engine zatím ne)

```jsonc
"noise": {
  "missing":    { "sale.customer_id": 0.03, "complaint.product_id": 0.1 },
  "duplicates": { "delivery": 0.01 },
  "hourJitter": true
}
```

---

## Doporučené pořadí

1. Engine (`runScenario`) — bez něj nic z toho neběží.
2. B1 + B2: nula změn ve schématu, jen JSON + nová `expectations` pro `sp2`.
3. B3 + B4: malé změny schématu, nejvíc pomůžou demu detektiva.
4. B7 šum, B6 ceny.
5. B5 zpětná vazba jen pokud zbude čas.
