/** Branch: each source record (after its lag) goes to `then` if `cond` holds, else to `else`. */
import type { BranchProcess } from "@s2d/schema/scenario";
import { evalCond, genRecord } from "../fields";
import { createStream } from "../rng";
import type { Runtime } from "../types";
import { applyEffects, consume, processGen, sink, type Bus, type Runner } from "./common";

export function branchRunner(p: BranchProcess, index: number, rt: Runtime, bus: Bus): Runner {
  const at = `processes[${index}]`;
  const rng = createStream(rt.seed, p.id);
  const g = processGen(rt, rng, p.id);
  const queue = consume(bus, p.source, rng, p.lag);
  const outcomes = (["then", "else"] as const).flatMap((name) => {
    const def = p[name];
    return def ? [{ name, def, out: sink(def) }] : [];
  });

  return {
    step(day) {
      for (const source of queue.take(day)) {
        const ctx = { day, self: {}, source };
        const name = evalCond(p.cond, ctx, g, `${at}.cond`) ? "then" : "else";
        const outcome = outcomes.find((o) => o.name === name);
        if (!outcome) continue;
        const record = genRecord(outcome.def.fields, ctx, g, `${at}.${name}.fields`);
        applyEffects(outcome.def.effects, { ...ctx, self: record }, rt, `${at}.${name}.effects`);
        outcome.out.rows.push(record);
        bus.emit(`${p.id}:${name}`, record, day);
      }
    },
    tables: () => outcomes.map((o) => o.out),
  };
}
