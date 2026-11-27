import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createStream } from "../../src/engine/rng";

describe("rng properties", () => {
  it("next() is always in [0, 1)", () => {
    fc.assert(
      fc.property(fc.integer(), fc.string(), (seed, id) => {
        const r = createStream(seed, id);
        for (let i = 0; i < 50; i++) {
          const x = r.next();
          if (x < 0 || x >= 1) return false;
        }
        return true;
      }),
    );
  });

  it("stream isolation: consuming one stream never changes another", () => {
    fc.assert(
      fc.property(fc.integer(), fc.nat(200), (seed, consumed) => {
        const untouched = createStream(seed, "B");
        const expected = createStream(seed, "B").next();
        const a = createStream(seed, "A");
        for (let i = 0; i < consumed; i++) a.next();
        expect(untouched.next()).toBe(expected);
      }),
    );
  });
});
