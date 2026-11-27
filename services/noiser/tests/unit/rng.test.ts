import { describe, expect, it } from "vitest";
import { createStream, hashString } from "../../src/engine/rng";
import { bernoulli, normal, poisson, weightedIndex } from "../../src/engine/random";

const draw = (seed: number, id: string, n = 5) => {
  const r = createStream(seed, id);
  return Array.from({ length: n }, () => r.next());
};

describe("rng", () => {
  it("is deterministic for the same seed and process id", () => {
    expect(draw(42, "delivery")).toEqual(draw(42, "delivery"));
  });

  it("gives independent streams per process id and per seed", () => {
    expect(draw(42, "delivery")).not.toEqual(draw(42, "purchase_attempt"));
    expect(draw(42, "delivery")).not.toEqual(draw(43, "delivery"));
  });

  it("hashString is stable and input-sensitive", () => {
    expect(hashString("supplier_delay")).toBe(hashString("supplier_delay"));
    expect(hashString("a")).not.toBe(hashString("b"));
  });

  it("fork() yields a reproducible child stream", () => {
    const a = createStream(1, "p").fork("SUP-001");
    const b = createStream(1, "p").fork("SUP-001");
    expect(a.next()).toBe(b.next());
  });

  it("int() stays within inclusive bounds", () => {
    const r = createStream(7, "x");
    const xs = Array.from({ length: 2000 }, () => r.int(3, 10));
    expect(Math.min(...xs)).toBe(3);
    expect(Math.max(...xs)).toBe(10);
  });
});

describe("distributions", () => {
  const N = 20_000;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

  it("bernoulli matches p", () => {
    const r = createStream(1, "b");
    expect(mean(Array.from({ length: N }, () => (bernoulli(r, 0.3) ? 1 : 0)))).toBeCloseTo(0.3, 1);
  });

  it("normal matches mean", () => {
    const r = createStream(1, "n");
    expect(mean(Array.from({ length: N }, () => normal(r, 25, 5)))).toBeCloseTo(25, 0);
  });

  it.each([0.06, 3, 50])("poisson(%d) matches lambda", (lambda) => {
    const r = createStream(1, `p${lambda}`);
    expect(mean(Array.from({ length: N }, () => poisson(r, lambda)))).toBeCloseTo(
      lambda,
      lambda > 10 ? 0 : 1,
    );
  });

  it("poisson rejects non-finite lambda", () => {
    const r = createStream(1, "pe");
    expect(() => poisson(r, Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => poisson(r, Number.NaN)).toThrow(/finite/);
  });

  it("weightedIndex rejects NaN / negative / all-zero weights", () => {
    const r = createStream(1, "we");
    expect(() => weightedIndex(r, [1, Number.NaN])).toThrow();
    expect(() => weightedIndex(r, [1, -1])).toThrow();
    expect(() => weightedIndex(r, [0, 0])).toThrow();
  });

  it("weightedIndex respects zero weights", () => {
    const r = createStream(1, "w");
    const xs = Array.from({ length: 1000 }, () => weightedIndex(r, [0, 1, 0]));
    expect(new Set(xs)).toEqual(new Set([1]));
  });
});
