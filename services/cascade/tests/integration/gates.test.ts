import { afterEach, describe, expect, it } from "vitest";
import { loadScenarioFixture, makeTempDir } from "@s2d/test-utils";
import { Scenario } from "@s2d/schema/scenario";
import { expectationGate } from "../evals/gates";

describe("eval gate 3 (expectations on generated data)", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  it("supplier_delay passes at seed 42 and on >= 4/5 seeds", async () => {
    const tmp = makeTempDir();
    cleanup = tmp.cleanup;
    const gate = await expectationGate(Scenario.parse(loadScenarioFixture("supplier_delay")), tmp.dir);
    expect(gate.main.failed).toEqual([]);
    expect(gate.pass).toBe(true);
  }, 120_000);

  it("fails when an expectation contradicts the data", async () => {
    const tmp = makeTempDir();
    cleanup = tmp.cleanup;
    const s = Scenario.parse(loadScenarioFixture("supplier_delay"));
    const flipped = {
      ...s,
      expectations: s.expectations.map((e) => ({
        ...e,
        check: {
          ...e.check,
          kind: e.check.kind === "decrease" ? ("increase" as const) : ("decrease" as const),
        },
      })),
    };
    const gate = await expectationGate(flipped, tmp.dir);
    expect(gate.pass).toBe(false);
    expect(gate.main.failed.length).toBeGreaterThan(0);
  }, 120_000);
});
