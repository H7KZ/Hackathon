/** Small hand-written scenarios for engine unit tests. Always compiled, so tests use valid input only. */
import type { Scenario } from "@s2d/schema/scenario";
import type { GeneratedTable, Row } from "@s2d/schema/run";
import { compileScenario } from "../../src/compiler/validate";

type Input = Record<string, unknown>;

export const BASE = {
  meta: {
    id: "mini",
    name: "mini",
    company: "test",
    story: "test",
    seed: 1,
    start: "2025-01-01",
    end: "2025-01-31",
    locale: "cs-CZ",
  },
  entities: [{ name: "store", count: 2, idPrefix: "STO", fields: { id: { gen: "id" } } }],
  curves: [],
  flows: [],
  processes: [
    { type: "arrival", id: "visit", table: "visit", per: ["store"], rate: 1, fields: { id: { gen: "id" } } },
  ],
  storyPoints: [],
  expectations: [],
};

/** BASE with top-level sections replaced (meta is merged). Throws with compiler errors if invalid. */
export function mini(overrides: Input = {}): Scenario {
  const raw = { ...BASE, ...overrides, meta: { ...BASE.meta, ...(overrides.meta as Input | undefined) } };
  const result = compileScenario(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  return result.scenario;
}

export function table(tables: readonly GeneratedTable[], name: string): Row[] {
  const rows = tables.filter((t) => t.name === name).flatMap((t) => t.rows);
  if (!tables.some((t) => t.name === name)) throw new Error(`no table ${name}`);
  return rows;
}
