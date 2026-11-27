/**
 * Shared engine interfaces. Implementations live in entities.ts / flows.ts / run.ts; field generators
 * and processes depend only on these interfaces, which keeps the module graph acyclic.
 */
import type { Faker } from "@faker-js/faker";
import type { Cell, Row } from "@s2d/schema/run";
import type { CurveDef, FieldGen } from "@s2d/schema/scenario";
import type { Rng } from "./rng";

/** What a Path can see while a record is being generated. */
export interface Ctx {
  /** Day index (see days.ts). */
  day: number;
  /** The record being built; holds only fields declared so far. */
  self: Row;
  /** Source record (branch / derive only). */
  source?: Row | undefined;
  /** Stream key: entity name -> entity id (arrival only). */
  key?: Readonly<Record<string, string>> | undefined;
}

export type PickGen = Extract<FieldGen, { gen: "pick" }>;
export type FakeKind = Extract<FieldGen, { gen: "fake" }>["kind"];
export type Fields = Readonly<Record<string, FieldGen>>;
export type FlowKeys = Readonly<Record<string, Cell>>;

export interface EntityAccess {
  /** Entity ids in generation order. */
  ids(entity: string, at: string): readonly string[];
  /** Generated count / declared count (1 for entities below MIN_SCALED_COUNT). */
  scaleOf(entity: string, at: string): number;
  /** `field` of the entity row with id `id`. */
  lookup(entity: string, id: Cell, field: string, at: string): Cell;
  /** Random row id of `gen.entity` (filtered by `where`, weighted by `weightBy`), or null if none match. */
  pick(gen: PickGen, ctx: Ctx, rng: Rng, at: string): Cell;
}

export interface FlowAccess {
  level(flow: string, keys: FlowKeys, at: string): number;
  /** Apply `delta` on `day`: now if `day <= today`, otherwise at the start of `day`. */
  change(flow: string, keys: FlowKeys, delta: number, day: number, today: number, at: string): void;
}

export interface Runtime {
  readonly seed: number;
  readonly scale: number;
  /** First and last simulated day index (both inclusive). */
  readonly start: number;
  readonly end: number;
  readonly curves: ReadonlyMap<string, CurveDef>;
  readonly entities: EntityAccess;
  readonly flows: FlowAccess;
}

/** Everything a field generator needs: the runtime plus the caller's own RNG stream. */
export interface Gen {
  readonly rt: Runtime;
  readonly rng: Rng;
  faker(): Faker;
  nextId(): string;
}
