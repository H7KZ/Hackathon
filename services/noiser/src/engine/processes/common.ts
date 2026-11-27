/** Shared machinery of process runners: output tables, ids, effects, source subscriptions. */
import type { GeneratedTable, Row } from "@s2d/schema/run";
import type { Effect, Outcome, Visibility } from "@s2d/schema/scenario";
import { resolve, toDayIndex, toNumber } from "../context";
import { createFaker } from "../faker";
import { resolveKeys } from "../fields";
import type { Rng } from "../rng";
import type { Ctx, Gen, Runtime } from "../types";

export interface Runner {
  step(day: number): void;
  tables(): GeneratedTable[];
}

type Listener = (record: Row, day: number) => void;

/** Routes emitted records ("<processId>" or "<branchId>:then|else") to consuming processes. */
export class Bus {
  private readonly listeners = new Map<string, Listener[]>();
  /** Day each process record was emitted on (every process record goes through `emit`). */
  readonly dayOf = new WeakMap<Row, number>();

  subscribe(ref: string, fn: Listener): void {
    this.listeners.set(ref, [...(this.listeners.get(ref) ?? []), fn]);
  }

  emit(ref: string, record: Row, day: number): void {
    this.dayOf.set(record, day);
    for (const fn of this.listeners.get(ref) ?? []) fn(record, day);
  }
}

/** Source records waiting for their (day + lag). */
export class DueQueue {
  private readonly byDay = new Map<number, Row[]>();

  add(day: number, record: Row): void {
    const list = this.byDay.get(day) ?? [];
    list.push(record);
    this.byDay.set(day, list);
  }

  take(day: number): Row[] {
    const list = this.byDay.get(day) ?? [];
    this.byDay.delete(day);
    return list;
  }
}

/** Subscribes to `source`; each record becomes due after a lag drawn from the consumer's lag stream. */
export function consume(
  bus: Bus,
  source: string,
  rng: Rng,
  lag: { min: number; max: number } | undefined,
): DueQueue {
  const queue = new DueQueue();
  const lagRng = rng.fork("lag");
  bus.subscribe(source, (record, day) => {
    queue.add(day + (lag ? lagRng.int(lag.min, lag.max) : 0), record);
  });
  return queue;
}

export function sink(
  out: Pick<Outcome, "table" | "fields"> & { visibility?: Visibility | undefined },
): GeneratedTable {
  return {
    name: out.table,
    visibility: out.visibility ?? "observed",
    columns: Object.keys(out.fields),
    rows: [],
  };
}

/** Gen with record ids `<prefix>-000001` (unique per process, hence per table). */
export function processGen(rt: Runtime, rng: Rng, prefix: string): Gen {
  let n = 0;
  let faker: ReturnType<typeof createFaker> | undefined;
  return {
    rt,
    rng,
    faker: () => (faker ??= createFaker(rng.fork("faker"))),
    nextId: () => `${prefix}-${String(++n).padStart(6, "0")}`,
  };
}

/** `ctx.self` must be the finished record. Default `on` is the record's day. */
export function applyEffects(
  effects: readonly Effect[] | undefined,
  ctx: Ctx,
  rt: Runtime,
  at: string,
): void {
  effects?.forEach((e, i) => {
    const path = `${at}[${i}]`;
    const keys = resolveKeys(e.keys, ctx, `${path}.keys`);
    const delta = toNumber(resolve(e.delta, ctx, `${path}.delta`), `${path}.delta`, `"${e.delta}"`) * e.sign;
    const on =
      e.on === undefined ? ctx.day : toDayIndex(resolve(e.on, ctx, `${path}.on`), `${path}.on`, `"${e.on}"`);
    rt.flows.change(e.flow, keys, delta, on, ctx.day, path);
  });
}
