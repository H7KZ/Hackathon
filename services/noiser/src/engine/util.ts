/** Small pure helpers on top of an Rng. */
import type { Rng } from "./rng";

/** Cartesian product of lists, in lexicographic order. */
export function cartesian<T>(lists: readonly (readonly T[])[]): T[][] {
  return lists.reduce<T[][]>((acc, list) => acc.flatMap((prefix) => list.map((x) => [...prefix, x])), [[]]);
}

/** In-place Fisher–Yates shuffle driven by `rng`. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return items;
}
