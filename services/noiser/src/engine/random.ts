/** Distributions on top of an Rng stream. Pure functions, no global state. */
import type { Rng } from "./rng";

export function bernoulli(rng: Rng, p: number): boolean {
  return rng.next() < p;
}

/** Box–Muller; consumes two draws. */
export function normal(rng: Rng, mean: number, sd: number): number {
  const u1 = Math.max(rng.next(), Number.EPSILON);
  const u2 = rng.next();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Knuth for small lambda, normal approximation for large lambda. */
export function poisson(rng: Rng, lambda: number): number {
  if (!Number.isFinite(lambda)) throw new Error(`poisson: lambda must be finite, got ${lambda}`);
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(normal(rng, lambda, Math.sqrt(lambda))));
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > limit);
  return k - 1;
}

/** Index into `weights` proportionally to weight (all weights >= 0, sum > 0). */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  if (weights.some((w) => !(w >= 0) || !Number.isFinite(w))) {
    throw new Error("weightedIndex: weights must be finite and >= 0");
  }
  const total = weights.reduce((s, w) => s + w, 0);
  if (!(total > 0)) throw new Error("weightedIndex: weights must sum to > 0");
  let r = rng.next() * total;
  let lastPositive = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] ?? 0;
    if (w > 0) lastPositive = i;
    r -= w;
    if (r < 0 && w > 0) return i;
  }
  return lastPositive;
}

export function clamp(x: number, min?: number, max?: number): number {
  let v = x;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}
