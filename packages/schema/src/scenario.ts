/**
 * Scenario contract (SPEC.md §4) — the single contract between agents and the engine.
 * Change it HERE first, then compiler (noiser/src/compiler), then engine.
 */
import { z } from "zod";
import { Expectation } from "./evidence";

export const IsoDate = z.iso.date();
export type IsoDate = z.infer<typeof IsoDate>;

export const Visibility = z.enum(["observed", "ground_truth"]);
export type Visibility = z.infer<typeof Visibility>;

/**
 * "day" | "self.<field>" (earlier field of the current record) | "source.<field>" (field of the source
 * record, branch/derive only) | "key.<entity>" (id of the stream's entity, arrival `per` only).
 */
export const Path = z.string().regex(/^(day|(self|source|key)\.[A-Za-z_][A-Za-z0-9_]*)$/, {
  error: 'Path must be "day", "self.<field>", "source.<field>" or "key.<entity>"',
});
export type Path = z.infer<typeof Path>;

/** Process ids and table names: snake_case identifiers (also keeps RNG stream keys collision-free). */
export const Ident = z.string().regex(/^[a-z][a-z0-9_]*$/, { error: "must be a snake_case identifier" });

/** Constant or a curve evaluated at (day, current record). */
export const Param = z.union([z.number(), z.object({ curve: z.string(), scale: z.number().optional() })]);
export type Param = z.infer<typeof Param>;

// ---------- Cond (recursive) ----------
export type Cond =
  | { kind: "flowGt" | "flowGte"; flow: string; keys: Record<string, Path>; value: number | Path }
  | { kind: "fieldEq"; path: Path; value: string | number | boolean }
  | { kind: "fieldGt"; path: Path; value: number }
  | { kind: "bernoulli"; p: Param }
  | { kind: "and" | "or"; conds: Cond[] }
  | { kind: "not"; cond: Cond };

export const Cond: z.ZodType<Cond> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    /** flow level > value (flowGt) or >= value (flowGte); value may be a Path like "source.quantity". */
    z.object({
      kind: z.literal("flowGt"),
      flow: z.string(),
      keys: z.record(z.string(), Path),
      value: z.union([z.number(), Path]),
    }),
    z.object({
      kind: z.literal("flowGte"),
      flow: z.string(),
      keys: z.record(z.string(), Path),
      value: z.union([z.number(), Path]),
    }),
    z.object({
      kind: z.literal("fieldEq"),
      path: Path,
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
    z.object({ kind: z.literal("fieldGt"), path: Path, value: z.number() }),
    z.object({ kind: z.literal("bernoulli"), p: Param }),
    z.object({ kind: z.literal("and"), conds: z.array(Cond) }),
    z.object({ kind: z.literal("or"), conds: z.array(Cond) }),
    z.object({ kind: z.literal("not"), cond: Cond }),
  ]),
);

// ---------- FieldGen (recursive via "if") ----------
export const FakeKind = z.enum(["personName", "companyName", "city", "email", "productName"]);

export type FieldGen =
  | { gen: "id" }
  | { gen: "ref"; path: Path }
  | { gen: "lookup"; entity: string; key: Path; field: string }
  | { gen: "topUp"; flow: string; keys: Record<string, Path>; target: Param }
  | { gen: "pick"; entity: string; weightBy?: string | undefined; where?: Record<string, Path> | undefined }
  | { gen: "const"; value: string | number | boolean }
  | {
      gen: "normal";
      mean: Param;
      sd: Param;
      min?: number | undefined;
      max?: number | undefined;
      round?: boolean | undefined;
    }
  | { gen: "poisson"; lambda: Param }
  | { gen: "uniformInt"; min: Param; max: Param }
  | { gen: "bernoulli"; p: Param }
  | { gen: "categorical"; values: string[]; weights?: Param[] | undefined }
  | { gen: "dateOffset"; base: Path; days: Path }
  | { gen: "fake"; kind: z.infer<typeof FakeKind> }
  | { gen: "if"; cond: Cond; then: FieldGen; else: FieldGen };

export const FieldGen: z.ZodType<FieldGen> = z.lazy(() =>
  z.discriminatedUnion("gen", [
    /** `<idPrefix>-001` for entities, `<process_id>-000001` for process records (unique per table). */
    z.object({ gen: z.literal("id") }),
    z.object({ gen: z.literal("ref"), path: Path }),
    /** `key` must evaluate to an id of `entity`; returns that entity row's `field`. */
    z.object({ gen: z.literal("lookup"), entity: z.string(), key: Path, field: z.string() }),
    /** Order-up-to quantity: max(0, target - current flow level). Ties supply to demand. */
    z.object({
      gen: z.literal("topUp"),
      flow: z.string(),
      keys: z.record(z.string(), Path),
      target: Param,
    }),
    /** Random row of `entity`; `where` = { <entityField>: Path } filter; `weightBy` = numeric entity field. */
    z.object({
      gen: z.literal("pick"),
      entity: z.string(),
      weightBy: z.string().optional(),
      where: z.record(z.string(), Path).optional(),
    }),
    z.object({ gen: z.literal("const"), value: z.union([z.string(), z.number(), z.boolean()]) }),
    z.object({
      gen: z.literal("normal"),
      mean: Param,
      sd: Param,
      min: z.number().optional(),
      max: z.number().optional(),
      round: z.boolean().optional(),
    }),
    z.object({ gen: z.literal("poisson"), lambda: Param }),
    z.object({ gen: z.literal("uniformInt"), min: Param, max: Param }),
    z.object({ gen: z.literal("bernoulli"), p: Param }),
    z.object({
      gen: z.literal("categorical"),
      values: z.array(z.string()).min(1),
      weights: z.array(Param).optional(),
    }),
    z.object({ gen: z.literal("dateOffset"), base: Path, days: Path }),
    z.object({ gen: z.literal("fake"), kind: FakeKind }),
    z.object({ gen: z.literal("if"), cond: Cond, then: FieldGen, else: FieldGen }),
  ]),
);

export const Fields = z.record(z.string(), FieldGen);

// ---------- Entities, curves, flows ----------
export const EntityDef = z.object({
  name: Ident.describe("entity name = table name"),
  count: z.number().int().positive(),
  idPrefix: z.string().regex(/^[A-Z][A-Z0-9]*$/, { error: "idPrefix must be uppercase, e.g. SUP" }),
  fields: Fields,
  visibility: Visibility.optional(),
});
export type EntityDef = z.infer<typeof EntityDef>;

/** Segment days: `start` inclusive, `end` exclusive (value at `end` is the post-segment value). */
export const Segment = z.object({
  kind: z.enum(["step", "ramp", "spike", "decay"]),
  start: IsoDate,
  end: IsoDate.optional(),
  to: z.number(),
  storyPointId: z.string(),
});
export type Segment = z.infer<typeof Segment>;

export const CurveDef = z.object({
  id: z.string(),
  baseline: z.number(),
  scope: z.object({ field: Path, ids: z.array(z.string()).min(1) }).optional(),
  segments: z.array(Segment),
  clamp: z.tuple([z.number(), z.number()]).optional(),
});
export type CurveDef = z.infer<typeof CurveDef>;

export const FlowDef = z.object({
  id: z.string(),
  keys: z.array(z.string()).min(1),
  initial: FieldGen,
  min: z.number().optional(),
  /** End-of-day snapshot table with columns `date`, `<key>_id` per key (e.g. store_id), `value`. */
  snapshot: z.object({ table: Ident, visibility: Visibility.optional() }).optional(),
});
export type FlowDef = z.infer<typeof FlowDef>;

export const Effect = z.object({
  flow: z.string(),
  keys: z.record(z.string(), Path),
  delta: Path,
  sign: z.union([z.literal(1), z.literal(-1)]),
  on: Path.optional(),
});
export type Effect = z.infer<typeof Effect>;

// ---------- Processes ----------
const Lag = z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() });

export const ArrivalProcess = z.object({
  type: z.literal("arrival"),
  id: Ident,
  table: Ident,
  per: z.array(z.string()).min(1),
  rate: Param.optional(),
  schedule: z
    .object({ everyDays: z.number().int().positive(), phase: z.literal("random").optional() })
    .optional(),
  where: z.record(z.string(), Path).optional(),
  fields: Fields,
  effects: z.array(Effect).optional(),
  visibility: Visibility.optional(),
});

export const Outcome = z.object({
  table: Ident,
  fields: Fields,
  effects: z.array(Effect).optional(),
  visibility: Visibility.optional(),
});
export type Outcome = z.infer<typeof Outcome>;

/**
 * Process source reference: "<processId>" for arrival/derive sources,
 * "<branchId>:then" | "<branchId>:else" to consume one outcome of a branch.
 */
export const SourceRef = z.string().regex(/^[a-z][a-z0-9_]*(:(then|else))?$/, {
  error: 'source must be "<processId>" or "<branchId>:then|else"',
});

export const BranchProcess = z.object({
  type: z.literal("branch"),
  id: Ident,
  source: SourceRef,
  lag: Lag.optional(),
  cond: Cond,
  then: Outcome.optional(),
  else: Outcome.optional(),
});

export const DeriveProcess = z.object({
  type: z.literal("derive"),
  id: Ident,
  table: Ident,
  source: SourceRef,
  p: Param,
  lag: Lag.optional(),
  fields: Fields,
  effects: z.array(Effect).optional(),
  visibility: Visibility.optional(),
});

export const ProcessDef = z.discriminatedUnion("type", [ArrivalProcess, BranchProcess, DeriveProcess]);
export type ProcessDef = z.infer<typeof ProcessDef>;
export type ArrivalProcess = z.infer<typeof ArrivalProcess>;
export type BranchProcess = z.infer<typeof BranchProcess>;
export type DeriveProcess = z.infer<typeof DeriveProcess>;

// ---------- Story & evidence ----------
export const StoryPoint = z.object({
  id: z.string(),
  phase: z.number().int().nonnegative(),
  title: z.string(),
  description: z.string(),
  entity: z.object({ name: z.string(), ids: z.array(z.string()) }).optional(),
  start: IsoDate,
  end: IsoDate.optional(),
});
export type StoryPoint = z.infer<typeof StoryPoint>;

export const NoiseDef = z.object({
  missing: z.record(z.string(), z.number().min(0).max(1)).optional(),
  duplicates: z.record(z.string(), z.number().min(0).max(1)).optional(),
  hourJitter: z.boolean().optional(),
});

export const Scenario = z.object({
  meta: z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/),
    name: z.string(),
    company: z.string(),
    story: z.string(),
    seed: z.number().int(),
    start: IsoDate,
    end: IsoDate,
    /**
     * Multiplies arrival rates and entity counts >= 50 (A5 loop uses 0.2). Small entity sets
     * (suppliers, stores) are never scaled so story-point ids like SUP-002 keep existing.
     */
    scale: z.number().positive().optional(),
    locale: z.literal("cs-CZ"),
  }),
  entities: z.array(EntityDef).min(1),
  curves: z.array(CurveDef),
  flows: z.array(FlowDef),
  processes: z.array(ProcessDef).min(1),
  storyPoints: z.array(StoryPoint),
  expectations: z.array(Expectation),
  noise: NoiseDef.optional(),
});
export type Scenario = z.infer<typeof Scenario>;
