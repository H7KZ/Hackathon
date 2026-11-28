/**
 * Noiser adapter, owned by the noiser team (docs/handoffs/noiser.md).
 * Change freely; keep `Ports["noiser"]` in ../ports.ts and tests/support/fakePorts.ts in sync.
 */
import { runScenarioInWorker } from "@s2d/noiser";
import type { Ports } from "../ports";

export function noiserPort(): Ports["noiser"] {
  return {
    run: (scenario, seed) => runScenarioInWorker(scenario, { seed }),
  };
}
