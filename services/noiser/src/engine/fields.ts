/**
 * Field generators and conditions. Fields are generated in declaration order, so a later field may
 * reference an earlier one via `self.<field>`.
 */
import type { Cell, Row } from "@s2d/schema/run";
import type { Cond, FieldGen } from "@s2d/schema/scenario";
import { resolve, toDayIndex, toNumber } from "./context";
import { fromDay } from "./days";
import { EngineError } from "./errors";
import { fake } from "./faker";
import { evalParam } from "./params";
import { bernoulli, clamp, normal, poisson, weightedIndex } from "./random";
import type { Ctx, FlowKeys, Gen } from "./types";

export function genRecord(fields: Readonly<Record<string, FieldGen>>, ctx: Ctx, g: Gen, at: string): Row {
  const self: Row = {};
  const recordCtx: Ctx = { ...ctx, self };
  for (const [name, gen] of Object.entries(fields)) {
    self[name] = genField(gen, recordCtx, g, `${at}.${name}`);
  }
  return self;
}

export function resolveKeys(keys: Readonly<Record<string, string>>, ctx: Ctx, at: string): FlowKeys {
  const out: Record<string, Cell> = {};
  for (const [entity, path] of Object.entries(keys)) out[entity] = resolve(path, ctx, `${at}.${entity}`);
  return out;
}

export function genField(gen: FieldGen, ctx: Ctx, g: Gen, at: string): Cell {
  const param = (p: Parameters<typeof evalParam>[0], name: string) =>
    evalParam(p, ctx, g.rt, `${at}.${name}`);

  switch (gen.gen) {
    case "id":
      return g.nextId();
    case "ref":
      return resolve(gen.path, ctx, `${at}.path`);
    case "lookup":
      return g.rt.entities.lookup(gen.entity, resolve(gen.key, ctx, `${at}.key`), gen.field, at);
    case "topUp": {
      const level = g.rt.flows.level(gen.flow, resolveKeys(gen.keys, ctx, `${at}.keys`), at);
      return Math.max(0, param(gen.target, "target") - level);
    }
    case "pick":
      return g.rt.entities.pick(gen, ctx, g.rng, at);
    case "const":
      return gen.value;
    case "normal": {
      const v = normal(g.rng, param(gen.mean, "mean"), param(gen.sd, "sd"));
      return clamp(gen.round ? Math.round(v) : v, gen.min, gen.max);
    }
    case "poisson":
      return poisson(g.rng, param(gen.lambda, "lambda"));
    case "uniformInt": {
      const min = Math.ceil(param(gen.min, "min"));
      const max = Math.floor(param(gen.max, "max"));
      if (min > max) throw new EngineError(at, `uniformInt needs min <= max, got min=${min} max=${max}.`);
      return g.rng.int(min, max);
    }
    case "bernoulli":
      return bernoulli(g.rng, param(gen.p, "p"));
    case "categorical": {
      const weights = gen.weights?.map((w, i) => param(w, `weights[${i}]`)) ?? gen.values.map(() => 1);
      try {
        return gen.values[weightedIndex(g.rng, weights)] ?? null;
      } catch (err) {
        throw new EngineError(`${at}.weights`, `${(err as Error).message}; got [${weights.join(", ")}].`);
      }
    }
    case "dateOffset": {
      const base = resolve(gen.base, ctx, `${at}.base`);
      if (base === null) return null;
      const days = toNumber(resolve(gen.days, ctx, `${at}.days`), `${at}.days`, "dateOffset days");
      return fromDay(toDayIndex(base, `${at}.base`, "dateOffset base") + Math.round(days));
    }
    case "fake":
      return fake(g.faker(), gen.kind);
    case "if":
      return evalCond(gen.cond, ctx, g, `${at}.cond`)
        ? genField(gen.then, ctx, g, `${at}.then`)
        : genField(gen.else, ctx, g, `${at}.else`);
  }
}

export function evalCond(cond: Cond, ctx: Ctx, g: Gen, at: string): boolean {
  switch (cond.kind) {
    case "flowGt":
    case "flowGte": {
      const level = g.rt.flows.level(cond.flow, resolveKeys(cond.keys, ctx, `${at}.keys`), at);
      const value =
        typeof cond.value === "number"
          ? cond.value
          : toNumber(resolve(cond.value, ctx, `${at}.value`), `${at}.value`, `"${cond.value}"`);
      return cond.kind === "flowGt" ? level > value : level >= value;
    }
    case "fieldEq":
      return resolve(cond.path, ctx, `${at}.path`) === cond.value;
    case "fieldGt": {
      const v = resolve(cond.path, ctx, `${at}.path`);
      return v !== null && toNumber(v, `${at}.path`, `"${cond.path}"`) > cond.value;
    }
    case "bernoulli":
      return bernoulli(g.rng, evalParam(cond.p, ctx, g.rt, `${at}.p`));
    case "and":
      return cond.conds.every((c, i) => evalCond(c, ctx, g, `${at}.conds[${i}]`));
    case "or":
      return cond.conds.some((c, i) => evalCond(c, ctx, g, `${at}.conds[${i}]`));
    case "not":
      return !evalCond(cond.cond, ctx, g, `${at}.cond`);
  }
}
