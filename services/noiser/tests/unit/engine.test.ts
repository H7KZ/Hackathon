/**
 * Engine TDD backlog (AGENTS.md "Required tests"). Turn each todo into a real test, then make it pass.
 * Order follows the Must list: entities -> arrival -> flows -> branch/derive -> snapshot -> truth.
 */
import { describe, expect, it } from "vitest";
import { Scenario } from "@s2d/schema/scenario";
import { loadScenarioFixture } from "@s2d/test-utils";
import { runScenario } from "../../src/engine/run";

describe("runScenario", () => {
  it("is not implemented yet (delete this test when the first real one passes)", () => {
    const s = Scenario.parse(loadScenarioFixture("supplier_delay"));
    expect(() => runScenario(s, { seed: 42 })).toThrow(/not implemented/);
  });

  it.todo("generates entities with ids `<idPrefix>-001` and declared fields");
  it.todo("arrival(schedule): one delivery per [store, product] every 7 days");
  it.todo("arrival(rate): Poisson count per stream scales with the curve");
  it.todo("flow effects apply on the `on` date and respect `min: 0`");
  it.todo("branch(flowGt): sale when stock > 0, lost_sale otherwise");
  it.todo("derive: child rows carry FK to source and respect lag");
  it.todo("snapshot: stock_daily has one row per [store, product, day]");
  it.todo("visibility: ground_truth tables are returned separately from observed");
  it.todo("scale: 0.2 shrinks entity counts and rates");
});
