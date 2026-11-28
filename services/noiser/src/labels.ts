/**
 * Human labels for entity ids ("STO-001" → "Novák a syn s.r.o."): users never see the entity tables,
 * so a story that says "STO-001" means nothing to them. The engine generates entity rows only from
 * the seed and the entity definition (stream `entity:<name>`), so the labels here are exactly the
 * names the dataset will hold for the same seed. Display only; nothing is written back.
 */
import type { CurveDef, EntityDef } from "@s2d/schema/scenario";
import { toDay } from "./engine/days";
import { EntityStore } from "./engine/entities";
import { FlowStore } from "./engine/flows";
import type { Runtime } from "./engine/types";

const NAME_KINDS = new Set(["companyName", "personName", "productName", "city"]);

/** The field that names a row: `name`/`title`/`label`, else the first faker name-like field. */
function labelField(def: EntityDef): string | undefined {
  const named = ["name", "title", "label", "nazev"].find((f) => f in def.fields);
  if (named) return named;
  return Object.entries(def.fields).find(([, g]) => g.gen === "fake" && NAME_KINDS.has(g.kind))?.[0];
}

export function entityLabels(
  entities: EntityDef[],
  opts: { seed: number; start?: string; end?: string; curves?: CurveDef[] },
): Record<string, string> {
  const store = new EntityStore();
  const start = toDay(opts.start ?? "2024-01-01");
  const rt: Runtime = {
    seed: opts.seed,
    scale: 1,
    start,
    end: opts.end ? toDay(opts.end) : start,
    curves: new Map((opts.curves ?? []).map((c) => [c.id, c])),
    entities: store,
    flows: new FlowStore(),
  };
  const labels: Record<string, string> = {};
  entities.forEach((def, i) => {
    try {
      store.generate(def, i, rt);
    } catch {
      return; // an entity that needs more than its own definition simply keeps its id
    }
    const field = labelField(def);
    if (!field) return;
    for (const table of store.toTables())
      if (table.name === def.name)
        for (const row of table.rows) {
          const id = row.id;
          const label = row[field];
          if (typeof id === "string" && typeof label === "string" && label.trim()) labels[id] = label;
        }
  });
  return labels;
}
