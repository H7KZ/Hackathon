import { describe, expect, it } from "vitest";
import { describeShape } from "../../src/loop";

describe("describeShape", () => {
  it("gives no hint when the object has its own top-level keys", () => {
    expect(describeShape({ name: "x", entities: [], flows: [] })).toEqual([]);
  });

  it("hints at a wrapped object and at non-objects", () => {
    expect(describeShape({ scenario: { name: "x" } })).toEqual([
      'Your answer wrapped everything in "scenario"; put the fields directly at the top level.',
    ]);
    expect(describeShape([1])).toEqual(["Your answer was an array, expected one JSON object."]);
    expect(describeShape(undefined)).toEqual([]);
  });
});
