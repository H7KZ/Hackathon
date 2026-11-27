/**
 * Arrival: one stream per combination of `per` entities. Each day a stream emits
 * Poisson(rate × scale) records, or on its schedule (every N days, optional random phase).
 * Records of one day are emitted in random order so no entity is systematically served first.
 */
import type { ArrivalProcess } from "@s2d/schema/scenario";
import { resolve } from "../context";
import { EngineError } from "../errors";
import { genRecord } from "../fields";
import { evalParam } from "../params";
import { poisson } from "../random";
import { createStream } from "../rng";
import type { Runtime } from "../types";
import { cartesian, shuffle } from "../util";
import { applyEffects, processGen, sink, type Bus, type Runner } from "./common";

export function arrivalRunner(p: ArrivalProcess, index: number, rt: Runtime, bus: Bus): Runner {
  const at = `processes[${index}]`;
  const rng = createStream(rt.seed, p.id);
  const g = processGen(rt, rng, p.id);
  const out = sink(p);

  let streams = cartesian(p.per.map((e, j) => rt.entities.ids(e, `${at}.per[${j}]`))).map((ids) =>
    Object.fromEntries(p.per.map((e, j) => [e, ids[j] ?? ""])),
  );
  if (p.where) {
    // where: { "<perEntity>.<field>": Path } keeps combinations whose entity field equals the path value
    const filters = Object.entries(p.where).map(([target, path]) => {
      const [entity = "", field = ""] = target.split(".");
      if (!p.per.includes(entity) || !field) {
        throw new EngineError(
          `${at}.where.${target}`,
          `where keys must be "<entity>.<field>" with entity in per (${p.per.join(", ")}).`,
        );
      }
      return { entity, field, path };
    });
    streams = streams.filter((key) =>
      filters.every(
        ({ entity, field, path }) =>
          rt.entities.lookup(entity, key[entity] ?? "", field, `${at}.where`) ===
          resolve(path, { day: rt.start, self: {}, key }, `${at}.where.${entity}.${field}`),
      ),
    );
  }

  const schedule = p.schedule;
  const phaseRng = rng.fork("phase");
  const phases = streams.map(() =>
    schedule?.phase === "random" ? phaseRng.int(0, schedule.everyDays - 1) : 0,
  );

  return {
    step(day) {
      const due: (typeof streams)[number][] = [];
      streams.forEach((key, i) => {
        if (schedule) {
          const offset = day - rt.start - (phases[i] ?? 0);
          if (offset < 0 || offset % schedule.everyDays !== 0) return;
        }
        const ctx = { day, self: {}, key };
        const n =
          p.rate === undefined ? 1 : poisson(rng, evalParam(p.rate, ctx, rt, `${at}.rate`) * rt.scale);
        for (let k = 0; k < n; k++) due.push(key);
      });
      for (const key of shuffle(rng, due)) {
        const record = genRecord(p.fields, { day, self: {}, key }, g, `${at}.fields`);
        applyEffects(p.effects, { day, self: record, key }, rt, `${at}.effects`);
        out.rows.push(record);
        bus.emit(p.id, record, day);
      }
    },
    tables: () => [out],
  };
}
