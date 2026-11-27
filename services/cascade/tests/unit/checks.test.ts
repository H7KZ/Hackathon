import { afterEach, describe, expect, it } from "vitest";
import { runCascade } from "../../src/cascade";
import { checkCurveCoverage, checkModelShape } from "../../src/checks";
import type { CascadeEvent } from "../../src/events";
import { base, company, detail, influences, model, setup, story } from "./fixtures";

const arrivalOnly = { ...model, processes: base.processes.filter((p) => p.type === "arrival") };

describe("story checks", () => {
  it("supplier_delay passes both", () => {
    expect(checkModelShape(base)).toEqual([]);
    expect(checkCurveCoverage(base, base)).toEqual([]);
  });

  it("a model without branch/derive has no causal chain", () => {
    expect(checkModelShape(arrivalOnly).map((e) => e.path)).toEqual(["processes"]);
  });

  it("a 04_story curve that no Param references is reported (its own definition does not count)", () => {
    const unwired = JSON.parse(JSON.stringify(base).replaceAll('{"curve":"late_prob"}', "0.05")) as unknown;
    expect(checkCurveCoverage(unwired, base).map((e) => e.path)).toEqual(["curves.late_prob"]);
  });
});

describe("checks in the cascade", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  it("02_model without a chain is sent back, then accepted", async () => {
    const t = setup([company, arrivalOnly, model]);
    cleanup = t.cleanup;
    await runCascade(
      { story: "s", company: "c" },
      { llm: t.llm, runsDir: t.runsDir, runId: "r1", until: "02_model" },
    );
    expect(t.fake.calls.map((c) => c.schemaName)).toEqual(["01_company", "02_model", "02_model"]);
    expect(t.fake.calls[2]?.prompt).toContain("no causal chain");
  });

  it("A5 with an unused story curve is sent back even though it compiles", async () => {
    const unwired = JSON.parse(
      JSON.stringify(detail).replaceAll('{"curve":"late_prob"}', "0.05"),
    ) as typeof detail;
    const t = setup([company, model, influences, story, unwired, detail]);
    cleanup = t.cleanup;
    const events: CascadeEvent[] = [];
    await runCascade(
      { story: "s", company: "c" },
      { llm: t.llm, runsDir: t.runsDir, runId: "r2", onEvent: (e) => events.push(e) },
    );
    const loops = events.filter((e) => e.type === "loop.iteration" && e.step === "05_scenario");
    expect(loops.map((e) => e.type === "loop.iteration" && e.ok)).toEqual([false, true]);
    expect(JSON.stringify(loops[0])).toContain("curves.late_prob");
  });
});
