/**
 * Data-quality noise (SPEC §3.C, `noise` block). Applied AFTER the simulation and only to observed
 * tables: the story is encoded in clean records, noise only degrades what analysts see. ground_truth
 * tables stay clean. Every table/column draws from its own stream "noise:<kind>:<table>#<n>[.<field>]",
 * so changing the noise of one table never changes another.
 *
 *   hourJitter            process tables get `ts` = record day + uniform time 08:00–19:59
 *   missing["t.field"]    the field becomes null with probability p
 *   duplicates["t"]       an exact copy is inserted right after the row with probability p
 */
import type { GeneratedTable, Row } from "@s2d/schema/run";
import type { Scenario } from "@s2d/schema/scenario";
import { fromDay } from "./days";
import { bernoulli } from "./random";
import { createStream } from "./rng";

export const TS_COLUMN = "ts";
const OPEN = 8 * 3600;
const CLOSE = 20 * 3600;

type NoiseDef = NonNullable<Scenario["noise"]>;

const pad = (n: number) => String(n).padStart(2, "0");

function timestamp(day: number, seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${fromDay(day)} ${pad(h)}:${pad(m)}:${pad(seconds % 60)}`;
}

/**
 * Returns `(table, isProcessTable) => noisy copy`. Tables are numbered per name (`complaint#0`,
 * `complaint#1`) so two processes writing one table get independent streams.
 */
export function createNoise(
  noise: NoiseDef | undefined,
  seed: number,
  dayOf: WeakMap<Row, number>,
): (table: GeneratedTable, isProcessTable: boolean) => GeneratedTable {
  const seen = new Map<string, number>();
  return (t, isProcessTable) => {
    if (!noise || t.visibility !== "observed") return t;
    const n = seen.get(t.name) ?? 0;
    seen.set(t.name, n + 1);
    const key = `${t.name}#${n}`;
    let rows = t.rows;
    let columns = t.columns;

    if (noise.hourJitter && isProcessTable) {
      const rng = createStream(seed, `noise:ts:${key}`);
      rows = rows.map((r) => {
        const day = dayOf.get(r);
        return { ...r, [TS_COLUMN]: day === undefined ? null : timestamp(day, rng.int(OPEN, CLOSE - 1)) };
      });
      columns = [...(columns ?? []), TS_COLUMN];
    }

    for (const [target, p] of Object.entries(noise.missing ?? {})) {
      const dot = target.indexOf(".");
      if (target.slice(0, dot) !== t.name) continue;
      const field = target.slice(dot + 1);
      const rng = createStream(seed, `noise:missing:${key}.${field}`);
      rows = rows.map((r) => (bernoulli(rng, p) && Object.hasOwn(r, field) ? { ...r, [field]: null } : r));
    }

    const dup = noise.duplicates?.[t.name];
    if (dup) {
      const rng = createStream(seed, `noise:duplicates:${key}`);
      rows = rows.flatMap((r) => (bernoulli(rng, dup) ? [r, { ...r }] : [r]));
    }

    return rows === t.rows ? t : { ...t, rows, ...(columns ? { columns } : {}) };
  };
}
