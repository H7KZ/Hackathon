/** Real ports, one file per owning team so parallel edits don't conflict. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Scenario } from "@s2d/schema/scenario";
import type { ApiConfig } from "../config";
import type { Ports } from "../ports";
import { cascadePort } from "./cascade";
import { dataerPort } from "./dataer";
import { fakePorts } from "./fake";
import { noiserPort } from "./noiser";

export function realPorts(cfg?: Pick<ApiConfig, "cascadeDesign">): Ports {
  return { cascade: cascadePort(cfg?.cascadeDesign), noiser: noiserPort(), dataer: dataerPort() };
}

/**
 * Real ports, with the services listed in API_FAKE swapped for fakes seeded from
 * scenarios/supplier_delay.json (400 ms per step so a UI can show progress).
 */
export function portsFor(cfg: ApiConfig): Ports {
  const real = realPorts(cfg);
  if (!cfg.fake.length) return real;
  const raw: unknown = JSON.parse(readFileSync(join(cfg.scenariosDir, "supplier_delay.json"), "utf8"));
  const fake = fakePorts({ scenario: Scenario.parse(raw), delayMs: 400 }).ports;
  const pick = <K extends keyof Ports>(k: K): Ports[K] => (cfg.fake.includes(k) ? fake[k] : real[k]);
  return { cascade: pick("cascade"), noiser: pick("noiser"), dataer: pick("dataer") };
}
