# 4FIS Hackathon 2026: řešení Nova a Story2Data

Čas: pátek 15:00 až sobota 12:00 (~21 h). Prezentace v sobotu 13:00.
Zdroje: rešerše webu (listopad 2026). Položky označené ⚠️ nejsou ověřené.

---

## 0. Slovníček konceptů (co kde použijeme)

| Koncept | Co to je | Nova | Story2Data |
|---|---|---|---|
| **Učení s učitelem (supervised), regrese** | model se učí ze vstupů X předpovídat známé číslo y | ✅ jádro (y = share) | ❌ |
| **Učení bez učitele (unsupervised)** | hledá strukturu bez y (shlukování) | ➖ shluky pořadů podle typu | ➖ volitelně archetypy zákazníků |
| **Self-supervised / embeddingy** | předtrénovaný model převede text na vektor čísel, podobný význam → blízké vektory | ✅ názvy a popisy pořadů | ➖ |
| **Decision tree (rozhodovací strom)** | série otázek ano/ne („je pátek? je premiéra?“) → predikce | základ | ❌ |
| **Random Forest** | mnoho stromů na náhodných vzorcích, výsledky se zprůměrují | baseline | ❌ |
| **Gradient boosting (LightGBM, CatBoost, XGBoost)** | stromy za sebou, každý opravuje chyby předchozích; nejlepší na tabulková data | ✅ **hlavní model** | ❌ |
| **Časové řady, lag features** | jako vstupy hodnoty z minulosti (share stejného slotu minulý týden nebo loni) | ✅ | ✅ sezónnost v generátoru |
| **Validace v čase (time-series split)** | trénink jen na minulosti, test na budoucnosti; nikdy náhodné míchání | ✅ kritické | ❌ |
| **Kompoziční data** | podíly dávají dohromady 100 %; log-ratio transformace + softmax | ✅ odlišení | ❌ |
| **Kvantilová regrese / conformal prediction** | interval nejistoty místo jednoho čísla | ✅ bonus | ❌ |
| **SHAP** | vysvětlí, kolik každý vstup přidal nebo ubral k predikci | ✅ prezentace | ❌ |
| **Vektorová DB, sémantické vyhledávání** | uloží embeddingy, najde nejpodobnější podle významu | ➖ jen pro nové pořady (viz 1.6) | ❌ zbytečné |
| **RAG** | LLM si před odpovědí dohledá relevantní dokumenty | ❌ | ❌ zbytečné, šablony firem se vejdou do JSON |
| **LLM se strukturovaným výstupem** | LLM vrací validovaný JSON (Pydantic) místo volného textu | ➖ klasifikace žánru | ✅ **jádro** |
| **Simulace, kauzální model (SCM)** | kód generuje data podle pravidel příčina → následek | ❌ | ✅ **jádro** |
| **Detekce změnového bodu, diff-in-diff** | statistické testy, jestli v datech je skok nebo efekt | ❌ | ✅ ověřovač |
| **Webová aplikace (Streamlit)** | Python skript → webové UI za hodinu | ✅ dashboard | ✅ demo |

**Shrnutí:** Nova je klasické ML (gradient boosting a časové řady). Story2Data je LLM a simulace. RAG a vektorové DB nejsou jádrem ani jednoho. Použít je jen kvůli buzzwordům porota prokoukne.

---

## 1. Nova: předpověď share 15–54 v prime time

### 1.1 Kontext z rešerše
- **Měření:** ATO a Nielsen Admosphere, peoplemetry v ~1 900 domácnostech (~4 200 osob). Od 1. 2. 2026 navíc mobilní panel (sledování mimo domov).
  https://www.ato.cz/en/tv-research/
- **Měna trhu:** **L+TS0-3** = živé sledování plus odložené do 3 dnů.
  ⚠️ Zeptat se Novy, jaký je přesně cíl.
- **Share** = diváci kanálu / všichni diváci TV v cílové skupině v daném čase.
- **Typické hodnoty, prime time 15–54:** Nova ~35–37 % (2025: 36,7 %; H1 2026: 35,2 %), ČT ~28 %.
  https://www.lupa.cz/clanky/ct-loni-uhajila-celkove-prvenstvi-nova-dominuje-v-komercni-cilove-skupine/
  https://www.mediaguru.cz/ct-obhajila-v-pololeti-prvenstvi-rostla-diky-sportovnimu-vysilani
- **Vánoce:** 24. 12. dominuje ČT1 (pohádka ~2,2–2,3 mil., share přes 50 %). Nova tradičně vyhrává 26. 12. Každý vánoční den potřebuje vlastní příznak, ne jeden „svátek“.
  https://www.lupa.cz/clanky/jednicka-na-stedry-den-rekordni-nova-zaostala-u-mladsich-divaku-o-temer-10/

### 1.2 Datasety
| Data | Veřejné? | Zdroj |
|---|---|---|
| Share po slotech a kanálech | ❌ **ne**, dá Nova na místě | ATO publikuje jen souhrny: https://www.ato.cz/en/results/ |
| TV program (EPG) | ⚠️ částečně | `epg-grabber` (XMLTV) https://pypi.org/project/epg-grabber/ |
| Státní svátky | ✅ | `czech-holidays` (má 24. 12.) https://pypi.org/project/czech-holidays/ |
| Školní prázdniny | ✅ ručně | MŠMT: vánoční prázdniny 23. 12. 2026 až 3. 1. 2027 (⚠️ druhý zdroj uvádí 2. 1.) |
| Západ slunce | ✅ | `astral` https://pypi.org/project/astral/ |
| Počasí (historie) | ✅ bez klíče | Open-Meteo https://open-meteo.com/en/docs/historical-weather-api |
| Velké sportovní akce | ✅ ručně | MS v hokeji, fotbal, olympiáda: tabulka termínů |

### 1.3 Pipeline
```
data od Novy ──┐
EPG ───────────┼─► tabulka: datum × slot × kanál ─► features ─► LightGBM ─► softmax ─► share
kalendář ──────┤                                               (log-ratio)   (součet 100 %)
počasí, slunce ┘                                                   │
                                                                   ├─► kvantily (interval)
                                                                   └─► SHAP (vysvětlení)
```

### 1.4 Features (od nejdůležitějších podle literatury)
1. **Historie (lag features):** share stejného slotu a kanálu před 1 týdnem, průměr za 4 týdny, share stejného dne loni.
   ⚠️ U predikce dál než týden dopředu použít jen lagy delší než horizont, jinak dochází k úniku informací z budoucnosti.
2. **Čas:** den v týdnu, slot, měsíc, týden v roce.
3. **Kalendář:** svátek, den před svátkem, prázdniny, počet dní do 24. 12., zvláštní příznak pro 24., 25., 26. a 31. 12.
4. **Program:** žánr, premiéra nebo repríza, kolikátá repríza, délka, **lead-in** (share předchozího pořadu).
5. **Konkurence:** žánr a premiérovost toho, co běží na ČT1 a Primě, plus sport na ČT sport.
6. **Prostředí:** hodina západu slunce, teplota, srážky.

Zdroj seznamu důležitých faktorů: Nielsen https://www.nielsen.com/insights/2017/using-machine-learning-to-predict-future-tv-ratings

### 1.5 Model
- **Baseline 1:** stejný slot loni. **Baseline 2:** průměr posledních 4 týdnů. Všechno ostatní je musí porazit.
- **Hlavní model:** LightGBM nebo CatBoost. CatBoost si sám poradí s kategoriemi (žánr, kanál).
- **Trik s podíly:** zvolit referenční kanál a predikovat `log(share_k / share_ref)`. Zpětný převod softmaxem zaručí, že všechno je mezi 0 a 1 a součet dává 100 %. Pro malé kanály použít kategorii „ostatní“.
- **Vánoce s málo daty:** příznaky pro konkrétní dny a jako fallback násobek „vánoční den / normální prosincový den“ naučený z minulých let. Vyhodnotit zvlášť.
- **Interval nejistoty:** LightGBM s `objective="quantile"` (10. a 90. percentil) nebo MAPIE (conformal prediction) https://mapie.readthedocs.io

### 1.6 Kde dávají smysl embeddingy a sémantické vyhledávání
Problém **nového pořadu**: v testovacím období poběží pořady, které model nikdy neviděl.
- Názvy a popisy pořadů převést na embeddingy (`paraphrase-multilingual-MiniLM-L12-v2`, umí češtinu):
  https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
- Pro nový pořad najít k nejpodobnějších pořadů z historie (kosinová podobnost, stačí numpy nebo FAISS, žádná vektorová DB) a jejich průměrný share použít jako feature.
- Alternativa: LLM zařadí pořad do žánru (pohádka, reality, zprávy, film-akce, …).
- ⚠️ Přínos ověřit validací. Literatura čeká malé zlepšení, ale v prezentaci to dobře zní.

### 1.7 Validace
- **Nikdy** nemíchat náhodně. Použít `TimeSeriesSplit` s mezerou (gap).
- Hlavní test: **odložit celý poslední prosinec** a simulovat „období, které model neviděl“.
- Metriky: MAE v procentních bodech, zvlášť pro běžné dny a pro Vánoce, a srovnání s baseline.

### 1.8 Rozhraní (Streamlit)
- Výběr data → tabulka nebo heatmapa kanál × slot s predikovaným share a intervalem.
- Graf predikce vs. skutečnost pro odložený prosinec.
- SHAP waterfall pro vybraný slot („−4 p. b.: na ČT1 běží pohádka“).
- Volitelně: „co kdyby“ (změnit žánr pořadu → nová predikce). To se plánovačům vysílání bude líbit.

### 1.9 Časový plán (2 lidé)
| Čas | Člověk A (ML) | Člověk B (data a UI) |
|---|---|---|
| Pá 15–17 | průzkum dat, baseline, rozdělení na trénink a test | kalendář, svátky, slunce, počasí |
| Pá 17–21 | features + LightGBM | EPG a žánry (LLM nebo embeddingy) |
| Pá 21–01 | log-ratio + softmax, Vánoce | kostra Streamlitu |
| So 01–06 | ladění, kvantily, SHAP | napojit model na UI |
| So 06–10 | finální trénink, predikce na test | grafy, slidy |
| So 10–12 | odevzdání, zkouška prezentace | |

```
pip install pandas lightgbm catboost shap mapie scikit-learn sentence-transformers streamlit czech-holidays astral openmeteo-requests
```

---

## 2. Story2Data: z příběhu k datům

### 2.1 Klíčové poznatky z rešerše
- **Hotové generátory (SDV, Gretel, MOSTLY AI) se učí z reálných dat.** My žádná nemáme a chceme vložit vlastní příběh, takže jako jádro nejsou použitelné.
  https://docs.sdv.dev/sdv/modeling/multi-table-synthesizers/hmasynthesizer
- **LLM jsou špatné ve statistice a konzistenci napříč sloupci.** Necháme je generovat jen schéma a parametry, řádky vytvoří kód.
  https://arxiv.org/abs/2505.02659 · https://arxiv.org/abs/2503.02161
- **Nejbližší výzkum:** SQUiD (text → relační DB) https://arxiv.org/abs/2505.19025
- **Inspirace pro UX:** SQL Murder Mystery (příběh ukrytý v tabulkách) https://mystery.knightlab.com
- **RAG ani vektorová DB nejsou potřeba**, archetypy firem se vejdou do malého JSONu.

### 2.2 Architektura
```
popis firmy + příběh (text)
        │
        ▼
[1] LLM + Instructor ──► Spec (Pydantic): tabulky, sloupce, FK, počty řádků, rozdělení
        │
        ▼
[2] LLM + Instructor ──► StoryEffects: [{tabulka, metrika, segment, od, do, typ, síla}]
        │
        ▼
[3] Generátor (Python, deterministický, seed)
      • základ: Faker (jména, adresy), numpy (Pareto, Poisson, log-normal), sezónnost
      • rodiče před dětmi (zákazníci → objednávky → položky), FK integrita
      • aplikace efektů: skok, trend, změna mixu, odliv zákazníků, …
      • falešné stopy a šum
        │
        ▼
[4] Ověřovač ──► pro každý efekt test „naslepo“:
      • ruptures (změnový bod) → najde skok kolem data X?
      • diff-in-diff / t-test → segment Y vs. kontrolní skupina, p < 0,01?
      • referenční integrita (SDMetrics)
      • efekt slabý → zesílit a generovat znovu; moc zjevný → zeslabit
        │
        ▼
[5] Výstup: CSV/Parquet + ER diagram + klíč s řešením (SQL dotazy, grafy) + skóre dohledatelnosti
```

### 2.3 Knihovny efektů (to podstatné, co odliší váš tým)
Šablony, které z příběhu skládá LLM:

| Efekt | Příklad z příběhu | Jak se projeví v datech |
|---|---|---|
| `level_shift` | „zdražili dopravu v březnu“ | počet objednávek −30 % od 1. 3. |
| `trend` | „postupně rostl e-shop“ | lineární nebo exponenciální růst |
| `churn_spike` | „zákazníci z Brna odcházeli“ | P(další nákup) klesá pro segment Brno |
| `mix_shift` | „lidé přešli na levnější produkty“ | změna rozdělení kategorií |
| `anomaly` | „výpadek skladu v týdnu 12“ | nulové dodávky, zpoždění |
| `new_entity` | „spustili věrnostní program“ | nová tabulka nebo sloupec od data X + efekt |
| `fraud` | „zaměstnanec kradl“ | jeden `employee_id` má podezřelé storno |

Každý efekt = funkce `apply(df, params) → df` + odpovídající test `verify(df, params) → (passed, p_value, graf)`.

### 2.4 Typy LLM výstupu (Pydantic)
```python
class Column(BaseModel): name: str; dtype: str; generator: str; params: dict
class Table(BaseModel): name: str; rows: int; columns: list[Column]; fks: list[str]
class Effect(BaseModel): kind: Literal["level_shift","trend","churn_spike","mix_shift","anomaly","fraud"]
                         table: str; metric: str; segment: dict; start: date; end: date | None; magnitude: float
class Spec(BaseModel): company: str; start: date; end: date; tables: list[Table]; effects: list[Effect]
```
Instructor: https://python.useinstructor.com (validace a automatický retry).

### 2.5 Rozhraní (Streamlit)
1. Textová pole „popis firmy“ a „příběh“, posuvník obtížnosti, přepínač „špinavá data“.
2. Tlačítko **Generovat** → zobrazí se Spec (JSON), ER diagram a náhled tabulek.
3. Záložka **Ověření**: každý efekt má ✅ nebo ❌, p-hodnotu a graf, kde je příběh vidět.
4. Stáhnout ZIP (CSV + `answer_key.md` + `queries.sql`).
5. **Demo na pódiu:** porota sama napíše příběh a za ~1 minutu vidí graf, kde se příběh objevil.

### 2.6 Bonusy pro porotu z FIS
- **Obtížnost:** lehká (velký efekt, čistá data), těžká (malý efekt, šum, falešné stopy, chybějící hodnoty).
- **Falešné stopy:** korelace bez příčiny (zmrzlina a utopení), Simpsonův paradox.
- **Režim zadání úlohy:** vygeneruje zadání pro studenty („Zjisti, proč klesly tržby v Q2“) a klíč pro učitele.
- **Reprodukovatelnost:** stejný seed dá stejná data.

### 2.7 Časový plán (2 lidé)
| Čas | Člověk A (LLM a Spec) | Člověk B (generátor) |
|---|---|---|
| Pá 15–18 | Pydantic modely, prompt, Instructor | základ generátoru: 3 tabulky, FK, sezónnost |
| Pá 18–22 | LLM → Spec, 2 testovací příběhy | 3 efekty: level_shift, churn_spike, mix_shift |
| Pá 22–02 | ověřovač (ruptures, DiD) | další efekty, falešné stopy, špinavá data |
| So 02–06 | smyčka zesílit nebo zeslabit | Streamlit UI |
| So 06–10 | předgenerovat 2–3 ukázky (záloha pro demo) | ER diagram, export ZIP, slidy |
| So 10–12 | odevzdání, zkouška dema | |

```
pip install pandas numpy faker instructor anthropic pydantic ruptures statsmodels scipy sdmetrics streamlit
```

---

## 3. Doporučení

| | Nova | Story2Data |
|---|---|---|
| Závisí na datech od partnera | ano (bez nich nic) | ne, můžete začít hned |
| Riziko | ostatní týmy natrénují lepší model | LLM vrátí nevalidní Spec (řeší Instructor + retry) |
| Wow efekt na demu | střední (grafy) | vysoký (porota píše vlastní příběh) |
| Doporučení | máte-li silné ML | **✅ primární volba** |

Na představení výzev ve 14:15 zjistit:
- **Nova:** metriku, formát dat, jestli dostanete EPG i pro testovací období, a zda je cíl L+TS0-3.
- **FIS:** jestli mají příklady příběhů a podle čeho bude porota hodnotit dohledatelnost.
