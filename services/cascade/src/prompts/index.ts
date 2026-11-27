/**
 * Prompts for the cascade (SPEC §3.A). Instructions in English (model quality), data values in Czech.
 * Changing a prompt changes the cache key -> re-record the demo cache (`pnpm cascade` online).
 */
export const SHARED_RULES = `You design configuration for a deterministic synthetic-data engine.
Rules:
- You NEVER produce data rows or code. Only the JSON object requested by the schema.
- The story must emerge from a causal process chain: change PARAMETERS (probabilities, rates) over time, never outcome metrics.
- Every derived record must reference its source entity (foreign keys).
- Human-readable values (names, categories, descriptions) are in Czech (cs-CZ). Identifiers are English snake_case.`;

export const A1_COMPANY = `${SHARED_RULES}
Task A1: describe the company and its environment: industry, size, actors around it (suppliers, customers, competitors, ...) and the key business processes relevant to the story.`;

export const A2_MODEL = `${SHARED_RULES}
Task A2: design the data model: entities (with field generators), stateful flows (e.g. stock) and a skeleton of processes (arrival / branch / derive) that can produce the story. Use at least 5 linked tables.`;

export const A3_INFLUENCES = `${SHARED_RULES}
Task A3: build the causal influence graph between process parameters and outcomes: edges from -> to, direction, weight 0-1, delay in days, short rationale.`;

export const A4_STORY = `${SHARED_RULES}
Task A4: split the story into dated story points, define root curves (only on parameters) and SQL expectations.
Each expectation SQL must return columns period ('before'|'after') and value DOUBLE, reading only schema main.`;

export function userPrompt(sections: Record<string, unknown>): string {
  return Object.entries(sections)
    .map(([k, v]) => `## ${k}\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`)
    .join("\n\n");
}
