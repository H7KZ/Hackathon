import { describe, expect, it } from "vitest";
import { compileScenario } from "@s2d/noiser";
import { DataModel } from "@s2d/schema/artifacts";
import { MODEL_EXAMPLE } from "../../src/prompts/example";
import { A2_MODEL, A4_STORY, A5_DETAIL } from "../../src/prompts/index";

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

describe("story rule 3 (curves only on levers)", () => {
  it("A4 forbids curves on downstream probabilities and ratio expectations with constant p", async () => {
    const { A4_STORY } = await import("../../src/prompts/index");
    expect(A4_STORY).toMatch(/Downstream probabilities .* stay CONSTANT/);
    expect(A4_STORY).toMatch(/COUNTS or LEVELS/);
  });
});

describe("syntax the story depends on", () => {
  it("A2/A5 explain flows, effects and visibility; A4 explains curve scope", () => {
    for (const p of [A2_MODEL, A5_DETAIL]) {
      expect(p).toContain("Effect");
      expect(p).toContain("snapshot");
      expect(p).toContain('"ground_truth"');
    }
    expect(A4_STORY).toContain("scope");
  });

  it("A5 states the date range as the compiler and engine use it (end included)", () => {
    expect(A5_DETAIL).not.toContain("[start, end)");
    expect(A5_DETAIL).toContain("both days included");
  });

  it("v1 A5 and causal 4b share the calibration rules from the live runs", async () => {
    const { CALIBRATION } = await import("../../src/prompts/index");
    const { PROCESSES } = await import("../../src/prompts/causal");
    for (const p of [A5_DETAIL, PROCESSES]) expect(p).toContain(CALIBRATION);
    expect(CALIBRATION).toMatch(/topUp/);
  });
});
