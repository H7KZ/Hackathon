/**
 * Stateful quantities (e.g. stock per [store, product]). Effects apply immediately or at the start of
 * their `on` day; `min` is enforced after every change. Optional end-of-day snapshot table.
 */
import type { Cell, GeneratedTable, Row } from "@s2d/schema/run";
import type { FlowDef } from "@s2d/schema/scenario";
import { toNumber } from "./context";
import { fromDay } from "./days";
import { EngineError } from "./errors";
import { createFaker } from "./faker";
import { genField } from "./fields";
import { clamp } from "./random";
import { createStream } from "./rng";
import type { FlowAccess, FlowKeys, Runtime } from "./types";
import { cartesian } from "./util";

interface FlowState {
  def: FlowDef;
  index: number;
  combos: string[][];
  levels: Map<string, number>;
  snapshot: Row[];
}

const SEP = "\u0000";

export class FlowStore implements FlowAccess {
  private readonly flows = new Map<string, FlowState>();
  private readonly pending = new Map<number, { state: FlowState; key: string; delta: number }[]>();

  init(defs: readonly FlowDef[], rt: Runtime): void {
    defs.forEach((def, index) => {
      const at = `flows[${index}]`;
      const rng = createStream(rt.seed, `flow:${def.id}`);
      let faker: ReturnType<typeof createFaker> | undefined;
      const g = {
        rt,
        rng,
        faker: () => (faker ??= createFaker(rng.fork("faker"))),
        nextId: () => {
          throw new EngineError(
            `${at}.initial`,
            'A flow initial value cannot be {"gen": "id"}; use a number generator.',
          );
        },
      };
      const combos = cartesian(def.keys.map((k, j) => rt.entities.ids(k, `${at}.keys[${j}]`)));
      const levels = new Map<string, number>();
      for (const ids of combos) {
        const key = Object.fromEntries(def.keys.map((k, j) => [k, ids[j] ?? ""]));
        const value = genField(def.initial, { day: rt.start, self: {}, key }, g, `${at}.initial`);
        levels.set(ids.join(SEP), clamp(toNumber(value, `${at}.initial`, "flow initial value"), def.min));
      }
      this.flows.set(def.id, { def, index, combos, levels, snapshot: [] });
    });
  }

  private find(flow: string, keys: FlowKeys, at: string): { state: FlowState; key: string } {
    const state = this.flows.get(flow);
    if (!state) throw new EngineError(at, `Unknown flow "${flow}".`);
    const ids = state.def.keys.map((k) => keys[k]);
    const key = ids.map((v) => String(v)).join(SEP);
    if (!state.levels.has(key)) {
      throw new EngineError(
        `${at}.keys`,
        `Flow "${flow}" has no level for ${state.def.keys.map((k, i) => `${k}=${JSON.stringify(ids[i] as Cell)}`).join(", ")}; keys must be existing entity ids.`,
      );
    }
    return { state, key };
  }

  level(flow: string, keys: FlowKeys, at: string): number {
    const { state, key } = this.find(flow, keys, at);
    return state.levels.get(key) ?? 0;
  }

  change(flow: string, keys: FlowKeys, delta: number, day: number, today: number, at: string): void {
    const target = this.find(flow, keys, at);
    if (day <= today) this.apply(target.state, target.key, delta);
    else {
      const due = this.pending.get(day) ?? [];
      due.push({ ...target, delta });
      this.pending.set(day, due);
    }
  }

  private apply(state: FlowState, key: string, delta: number): void {
    state.levels.set(key, clamp((state.levels.get(key) ?? 0) + delta, state.def.min));
  }

  /** Effects scheduled for `day` (e.g. late deliveries), in the order they were scheduled. */
  applyDue(day: number): void {
    for (const { state, key, delta } of this.pending.get(day) ?? []) this.apply(state, key, delta);
    this.pending.delete(day);
  }

  /** End-of-day snapshot rows for flows with `snapshot`. */
  snapshot(day: number): void {
    const date = fromDay(day);
    for (const state of this.flows.values()) {
      if (!state.def.snapshot) continue;
      for (const ids of state.combos) {
        const row: Row = { date };
        state.def.keys.forEach((k, j) => {
          row[`${k}_id`] = ids[j] ?? null;
        });
        row.value = state.levels.get(ids.join(SEP)) ?? 0;
        state.snapshot.push(row);
      }
    }
  }

  toTables(): GeneratedTable[] {
    return [...this.flows.values()].flatMap(({ def, snapshot }) =>
      def.snapshot
        ? [
            {
              name: def.snapshot.table,
              visibility: def.snapshot.visibility ?? "observed",
              columns: ["date", ...def.keys.map((k) => `${k}_id`), "value"],
              rows: snapshot,
            },
          ]
        : [],
    );
  }
}
