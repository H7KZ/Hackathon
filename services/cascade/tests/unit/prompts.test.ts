import { describe, expect, it } from "vitest";
import { compileScenario } from "@s2d/noiser";
import { DataModel } from "@s2d/schema/artifacts";
import { MODEL_EXAMPLE } from "../../src/prompts/example";
import { A2_MODEL, A5_DETAIL } from "../../src/prompts/index";

describe("prompt few-shot example", () => {
  it("is a valid 02_model", () => {
    expect(DataModel.safeParse(MODEL_EXAMPLE).error).toBeUndefined();
  });

  it("compiles as a scenario (references, DAG) with its two curves", () => {
    const res = compileScenario({
      meta: {
        id: "ex",
        name: "ex",
        company: "c",
        story: "s",
        seed: 1,
        start: "2025-01-01",
        end: "2025-03-01",
        locale: "cs-CZ",
      },
      ...MODEL_EXAMPLE,
      curves: [
        { id: "demand", baseline: 1, segments: [] },
        { id: "late_prob", baseline: 0.1, segments: [] },
      ],
      storyPoints: [],
      expectations: [],
    });
    expect(res.ok ? [] : res.errors).toEqual([]);
  });

  it("is part of the A2 and A5 instructions", () => {
    for (const p of [A2_MODEL, A5_DETAIL]) expect(p).toContain('"delivery_check:then"');
  });
});
