/** Cascade artifacts cut out of scenarios/supplier_delay.json, so A5/whatIf tests compile a real scenario. */
import { join } from "node:path";
import { createLlm } from "@s2d/llm";
import { fakeGenerate, loadScenarioFixture, makeTempDir } from "@s2d/test-utils";
import { Scenario } from "@s2d/schema/scenario";

export const base = Scenario.parse(loadScenarioFixture("supplier_delay"));

export const company = {
  industry: "maloobchod",
  size: "5 prodejen",
  actors: [{ kind: "supplier", name: "Dodavatel B", description: "dodává kuchyňské potřeby" }],
  keyProcesses: ["zásobování", "prodej"],
};
export const model = { entities: base.entities, flows: base.flows, processes: base.processes };
export const influences = {
  edges: [
    {
      from: "delivery.is_late",
      to: "stock",
      direction: "negative",
      weight: 0.8,
      delayDays: 7,
      rationale: "r",
    },
    { from: "stock", to: "fulfil", direction: "positive", weight: 0.9, delayDays: 0, rationale: "r" },
    {
      from: "lost_sale",
      to: "complaint_oos",
      direction: "positive",
      weight: 0.5,
      delayDays: 1,
      rationale: "r",
    },
  ],
};
export const story = { storyPoints: base.storyPoints, curves: base.curves, expectations: base.expectations };
export const detail = {
  name: base.meta.name,
  start: base.meta.start,
  end: base.meta.end,
  entities: base.entities,
  flows: base.flows,
  processes: base.processes,
};
/** Valid against the schema, but references a curve that does not exist -> compile error. */
export const brokenDetail = JSON.parse(
  JSON.stringify(detail).replaceAll('"curve":"late_prob"', '"curve":"missing_curve"'),
) as typeof detail;

export function setup(responses: unknown[]) {
  const tmp = makeTempDir();
  const fake = fakeGenerate(responses);
  const llm = createLlm({
    generate: fake.generate,
    cacheDir: join(tmp.dir, "cache"),
    offline: false,
    model: "anthropic:test",
  });
  return { llm, fake, runsDir: join(tmp.dir, "runs"), cleanup: tmp.cleanup };
}
