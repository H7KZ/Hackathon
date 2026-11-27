/** Loading copy (docs/design/brand.md "Loading phrases"). Czech, short, a little playful. */

export const LOADING_PHRASES = [
  "Vyslýchám dodavatele…",
  "Učím křivky, kdy mají zatočit…",
  "Domlouvám se s cizími klíči…",
  "Sypu do dat špetku šumu…",
  "Vařím kafe pro agenta A3…",
  "Přesvědčuju tabulky, aby spolu mluvily…",
  "Hledám, kde se to v březnu pokazilo…",
  "Kontroluju, že každá objednávka má svého zákazníka…",
  "Ladím příběh, aby měl pointu…",
  "Počítám zákazníky. Zase jich je víc než minule…",
  "Zametám duplicity pod koberec… ne, mažu je.",
  "Ptám se DuckDB, jestli má chvilku…",
] as const;

/** Fixed labels per pipeline step (never rotated). Keys match ArtifactName + pipeline stages. */
export const STEP_LABELS = {
  "01_company": "Poznávám firmu",
  "02_model": "Stavím datový model",
  "03_influences": "Kreslím vlivy",
  "04_story": "Píšu příběh",
  "05_scenario": "Skládám scénář",
  engine: "Generuji data",
  integrity: "Kontroluji vazby",
  evidence: "Ověřuji důkazy",
  detective: "Detektiv pátrá",
  whatIf: "Přepisuji scénář podle otázky",
  compare: "Porovnávám běhy",
} as const;
export type StepKey = keyof typeof STEP_LABELS;

/** Phrase for tick `n`: walks a fixed shuffle so neighbours never repeat and tests stay deterministic. */
export function phraseAt(n: number): string {
  const order = [0, 6, 2, 9, 4, 1, 11, 7, 3, 10, 5, 8];
  const i = order[((n % order.length) + order.length) % order.length] ?? 0;
  return LOADING_PHRASES[i] ?? LOADING_PHRASES[0];
}

export const PHRASE_MS = 2800;
