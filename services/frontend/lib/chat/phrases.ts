/**
 * Loading copy (docs/design/brand.md "Loading phrases"). Czech, short, cozy and gently funny, in the
 * spirit of Claude Code's spinner verbs (claudionary.com): one small warm activity, never a joke about
 * the user or a fake technical claim.
 */

export const LOADING_PHRASES = [
  "Přemítám…",
  "Kutím…",
  "Nechávám data vykynout…",
  "Míchám tabulky do hladka…",
  "Probublávám…",
  "Hnětu čísla…",
  "Přikládám pod kotel…",
  "Spřádám vazby mezi tabulkami…",
  "Rovnám řádky do latě…",
  "Vařím na mírném ohni…",
  "Pošťuchuju křivky…",
  "Ladím detaily…",
  "Usrkávám čaj a počítám…",
  "Skládám střípky dohromady…",
  "Šustím papíry…",
  "Klubíčkuju souvislosti…",
] as const;

/** Fixed labels per pipeline step (never rotated). Keys match ArtifactName + pipeline stages. */
export const STEP_LABELS = {
  "01_company": "Poznávám firmu",
  "02_model": "Stavím datový model",
  "03_influences": "Kreslím vlivy",
  // CASCADE_DESIGN=causal (docs/cascade-design.md D1–D4)
  "03a_causal_map": "Kreslím kauzální mapu",
  "03b_processes": "Převádím mapu na procesy",
  "04a_overlay": "Rozvrhuji příběh v čase",
  "04b_expectations": "Píšu ověřitelné hypotézy",
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

/** What a running step is doing, in plain words, with a rough duration (shown under the step). */
export const STEP_HINTS: Partial<Record<StepKey, string>> = {
  "01_company": "Agent si z popisu skládá, kdo ve firmě co dělá.",
  "02_model": "Navrhuje tabulky a jak spolu souvisí.",
  "04_story": "Rozvrhuje příběh do bodů v čase.",
  "05_scenario":
    "Agent převádí příběh na procesy a pravidla. Každý pokus trvá asi minutu, pak ho stroj nanečisto vygeneruje a zkontroluje, že příběh v datech opravdu je.",
  engine: "Deterministický stroj vyrábí řádky den po dni. Pár sekund.",
  evidence: "Ověřuji hypotézy dotazy nad hotovou databází.",
  detective:
    "Druhý agent dostal jen tabulky, scénář nezná. Píše vlastní SQL dotazy a hledá, co se v datech stalo. Asi minuta.",
  whatIf: "Agent upravuje křivky podle otázky, struktura firmy zůstává.",
};

/** Phrase for tick `n`: walks a fixed shuffle so neighbours never repeat and tests stay deterministic. */
export function phraseAt(n: number): string {
  const order = [0, 6, 2, 9, 4, 13, 1, 11, 7, 15, 3, 10, 5, 14, 8, 12];
  const i = order[((n % order.length) + order.length) % order.length] ?? 0;
  return LOADING_PHRASES[i] ?? LOADING_PHRASES[0];
}

/** 1.75 × the first version (2.8 s): phrases were read as flicker, not as company. */
export const PHRASE_MS = 4900;
