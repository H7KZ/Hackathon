/** Static entities (suppliers, products, ...) generated once before the day loop. */
import type { Cell, GeneratedTable, Row } from "@s2d/schema/run";
import type { EntityDef } from "@s2d/schema/scenario";
import { resolve } from "./context";
import { EngineError } from "./errors";
import { createFaker } from "./faker";
import { genRecord } from "./fields";
import { weightedIndex } from "./random";
import { createStream, type Rng } from "./rng";
import type { Ctx, EntityAccess, PickGen, Runtime } from "./types";

/** Entity counts below this are never scaled, so story-point ids like SUP-002 keep existing. */
export const MIN_SCALED_COUNT = 50;

export function scaledCount(count: number, scale: number): number {
  return count >= MIN_SCALED_COUNT ? Math.max(1, Math.round(count * scale)) : count;
}

interface EntityTable {
  def: EntityDef;
  rows: Row[];
  ids: string[];
  byId: Map<string, Row>;
}

export class EntityStore implements EntityAccess {
  private readonly tables = new Map<string, EntityTable>();

  private get(entity: string, at: string): EntityTable {
    const table = this.tables.get(entity);
    if (!table) {
      throw new EngineError(
        at,
        `Entity "${entity}" is not generated yet. Entities are generated in declaration order; ` +
          `declare "${entity}" before the entity that references it. Generated so far: ${[...this.tables.keys()].join(", ") || "(none)"}.`,
      );
    }
    return table;
  }

  ids(entity: string, at: string): readonly string[] {
    return this.get(entity, at).ids;
  }

  lookup(entity: string, id: Cell, field: string, at: string): Cell {
    const row = this.get(entity, at).byId.get(String(id));
    if (!row) throw new EngineError(`${at}.key`, `No ${entity} with id ${JSON.stringify(id)}.`);
    return row[field] ?? null;
  }

  pick(gen: PickGen, ctx: Ctx, rng: Rng, at: string): Cell {
    const { rows, ids } = this.get(gen.entity, `${at}.entity`);
    let candidates = ids.map((_, i) => i);
    if (gen.where) {
      const filters = Object.entries(gen.where).map(
        ([field, path]) => [field, resolve(path, ctx, `${at}.where.${field}`)] as const,
      );
      candidates = candidates.filter((i) => filters.every(([field, value]) => rows[i]?.[field] === value));
    }
    if (candidates.length === 0) return null;
    const chosen = (k: number) => ids[candidates[k] ?? -1] ?? null;
    if (!gen.weightBy) return chosen(rng.int(0, candidates.length - 1));
    const field = gen.weightBy;
    const weights = candidates.map((i) => {
      const w = rows[i]?.[field];
      return typeof w === "number" ? w : NaN;
    });
    try {
      return chosen(weightedIndex(rng, weights));
    } catch (err) {
      throw new EngineError(
        `${at}.weightBy`,
        `${(err as Error).message} (field "${field}" of ${gen.entity}).`,
      );
    }
  }

  /** Generates all rows of `def` from its own stream `entity:<name>`. */
  generate(def: EntityDef, index: number, rt: Runtime): void {
    const rng = createStream(rt.seed, `entity:${def.name}`);
    let faker: ReturnType<typeof createFaker> | undefined;
    let current = "";
    const g = { rt, rng, faker: () => (faker ??= createFaker(rng.fork("faker"))), nextId: () => current };
    const table: EntityTable = { def, rows: [], ids: [], byId: new Map() };
    const count = scaledCount(def.count, rt.scale);
    for (let i = 1; i <= count; i++) {
      current = `${def.idPrefix}-${String(i).padStart(3, "0")}`;
      const row = genRecord(def.fields, { day: rt.start, self: {} }, g, `entities[${index}].fields`);
      table.rows.push(row);
      table.ids.push(current);
      table.byId.set(current, row);
    }
    this.tables.set(def.name, table);
  }

  toTables(): GeneratedTable[] {
    return [...this.tables.values()].map(({ def, rows }) => ({
      name: def.name,
      visibility: def.visibility ?? "observed",
      columns: Object.keys(def.fields),
      rows,
    }));
  }
}
