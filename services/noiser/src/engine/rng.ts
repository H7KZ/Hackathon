/**
 * Deterministic RNG streams (SPEC §2 rules 2+3).
 * Each process gets its own stream derived from hash(seed, processId), so editing one
 * process never reshuffles the random draws of another.
 */

/** 32-bit string hash (cyrb53 folded to 32 bits) — stable across platforms. */
export function hashString(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Derive an independent child stream, e.g. per entity or per field. */
  fork(label: string): Rng;
}

/** sfc32 PRNG seeded from four 32-bit words. */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function fromKey(key: string): Rng {
  const next = sfc32(hashString(key, 1), hashString(key, 2), hashString(key, 3), hashString(key, 4));
  // warm-up: discard first outputs to decorrelate similar keys
  for (let i = 0; i < 12; i++) next();
  return {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    fork(label) {
      return fromKey(`${key}/${label}`);
    },
  };
}

/** The only way the engine obtains randomness. */
export function createStream(seed: number, processId: string): Rng {
  return fromKey(`${seed}:${processId}`);
}
