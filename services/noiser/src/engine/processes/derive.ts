/** Derive: each source record (after its lag) produces a child record with probability `p`. */
import type { DeriveProcess } from "@s2d/schema/scenario";
import { genRecord } from "../fields";
import { evalParam } from "../params";
import { bernoulli } from "../random";
import { createStream } from "../rng";
import type { Runtime } from "../types";
import { applyEffects, consume, processGen, sink, type Bus, type Runner } from "./common";

export function deriveRunner(p: DeriveProcess, index: number, rt: Runtime, bus: Bus): Runner {
  const at = `processes[${index}]`;
  const rng = createStream(rt.seed, p.id);
  const g = processGen(rt, rng, p.id);
  const queue = consume(bus, p.source, rng, p.lag);
  const out = sink(p);

  return {
    step(day) {
      for (const source of queue.take(day)) {
        const ctx = { day, self: {}, source };
        if (!bernoulli(rng, evalParam(p.p, ctx, rt, `${at}.p`))) continue;
        const record = genRecord(p.fields, ctx, g, `${at}.fields`);
        applyEffects(p.effects, { ...ctx, self: record }, rt, `${at}.effects`);
        out.rows.push(record);
        bus.emit(p.id, record, day);
      }
    },
    tables: () => [out],
  };
}
