import { afterEach, describe, expect, it } from "vitest";
import { runCascade } from "../../src/cascade";
import { checkCurvesOnRoots, checkInfluenceRefs, curveParamRefs } from "../../src/checks";
import type { CascadeEvent } from "../../src/events";
import { base, company, detail, influences, model, setup, story } from "./fixtures";

describe("03_influences references", () => {
  it("accepts processes, process params/fields, tables, entity fields and flows of the model", () => {
    expect(checkInfluenceRefs(influences, model)).toEqual([]);
    const edges = [
      { ...influences.edges[0]!, from: "purchase_attempt.rate", to: "fulfil.cond" },
      { ...influences.edges[0]!, from: "product.supplier_id", to: "complaint_oos.p" },
      { ...influences.edges[0]!, from: "sale", to: "stock_daily" },
    ];
    expect(checkInfluenceRefs({ edges }, model)).toEqual([]);
  });

  it("flags endpoints that name nothing in 02_model and lists the valid names", () => {
    const edges = [{ ...influences.edges[0]!, from: "late_prob", to: "delivery.nope" }];
    const errors = checkInfluenceRefs({ edges }, model);
    expect(errors.map((e) => e.path)).toEqual(["edges.0.from", "edges.0.to"]);
    expect(errors[0]?.message).toMatch(/"late_prob".*delivery\.is_late/s);
  });
});

describe("curves only on roots of the map", () => {
  it("names the Param each curve drives", () => {
    expect(curveParamRefs(base)).toEqual(
      expect.arrayContaining([
        { curve: "late_prob", ref: "delivery.is_late", path: expect.stringContaining("processes.0") },
        { curve: "demand", ref: "purchase_attempt.rate", path: expect.any(String) },
      ]),
    );
  });

  it("supplier_delay drives only roots", () => {
    expect(checkCurvesOnRoots(base, influences)).toEqual([]);
  });

  it("a curve on a param with an incoming edge is reported", () => {
    const onDownstream = JSON.parse(
      JSON.stringify(base).replace('"p":0.25', '"p":{"curve":"late_prob"}'),
    ) as typeof base;
    const errors = checkCurvesOnRoots(onDownstream, influences);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/complaint_oos.*lost_sale/s);
  });
});

describe("in the cascade", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  it("03_influences with an unknown endpoint is sent back to A3", async () => {
    const bad = { edges: [{ ...influences.edges[0]!, from: "late_prob" }] };
    const t = setup([company, model, bad, influences]);
    cleanup = t.cleanup;
    await runCascade(
      { story: "s", company: "c" },
      { llm: t.llm, runsDir: t.runsDir, runId: "r1", until: "03_influences" },
    );
    expect(t.fake.calls.map((c) => c.schemaName)).toEqual([
      "01_company",
      "02_model",
      "03_influences",
      "03_influences",
    ]);
    expect(t.fake.calls[3]?.prompt).toContain('"late_prob"');
  });

  it("A5 driving a downstream param with a curve is sent back", async () => {
    const onDownstream = JSON.parse(
      JSON.stringify(detail).replace('"p":0.25', '"p":{"curve":"late_prob"}'),
    ) as typeof detail;
    const t = setup([company, model, influences, story, onDownstream, detail]);
    cleanup = t.cleanup;
    const events: CascadeEvent[] = [];
    await runCascade(
      { story: "s", company: "c" },
      { llm: t.llm, runsDir: t.runsDir, runId: "r2", onEvent: (e) => events.push(e) },
    );
    const loops = events.filter((e) => e.type === "loop.iteration" && e.step === "05_scenario");
    expect(loops.map((e) => e.type === "loop.iteration" && e.ok)).toEqual([false, true]);
    expect(JSON.stringify(loops[0])).toContain("complaint_oos.p");
  });
});
