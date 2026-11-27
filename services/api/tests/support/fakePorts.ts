/** Test wrapper around the fake ports in src/adapters/fake.ts, seeded with the supplier_delay fixture. */
import { loadScenarioFixture } from "@s2d/test-utils";
import type { Scenario } from "@s2d/schema/scenario";
import { fakePorts as makeFakePorts, type FakeOptions } from "../../src/adapters/fake";

export function fakePorts(opts: Omit<FakeOptions, "scenario"> = {}) {
  return makeFakePorts({ scenario: loadScenarioFixture("supplier_delay") as Scenario, ...opts });
}
