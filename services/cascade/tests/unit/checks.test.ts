import { afterEach, describe, expect, it } from "vitest";
import { runCascade } from "../../src/cascade";
import { checkCurveCoverage, checkEntityIds, checkModelShape, checkStoryPlan } from "../../src/checks";
import type { CascadeEvent } from "../../src/events";
import { base, company, detail, influences, model, setup, story } from "./fixtures";

const arrivalOnly = { ...model, processes: base.processes.filter((p) => p.type === "arrival") };

describe("story checks", () => {
  it("supplier_delay passes both", () => {
    expect(checkModelShape(base)).toEqual([]);
    expect(checkCurveCoverage(base, base)).toEqual([]);
  });

  it("a model with fewer than 5 tables is sent back", () => {
    const tiny = {
      ...model,
      entities: base.entities.slice(0, 1),
      flows: [],
      processes: base.processes.slice(0, 1),
    };
    expect(checkModelShape(tiny).map((e) => e.path)).toContain("tables");
    expect(checkModelShape(model).map((e) => e.path)).not.toContain("tables");
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
    expect(t.fake.calls[1]?.prompt).toContain("## Story\ns"); // A2 sees the story, not only 01_company
    expect(t.fake.calls[2]?.prompt).toContain("no causal chain");
    expect(t.fake.calls[2]?.prompt).toContain("fails the story checks");
    expect(t.fake.calls[2]?.prompt).not.toContain("failed schema validation");
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

describe("expectation tables", () => {
  it("lists observed tables of supplier_delay (ground_truth excluded)", async () => {
    const { observedTables } = await import("../../src/checks");
    const t = observedTables(base);
    expect(t).toEqual(expect.arrayContaining(["delivery", "sale", "complaint", "stock_daily"]));
    expect(t).not.toContain("purchase_attempt");
    expect(t).not.toContain("lost_sale");
  });

  it("finds tables after FROM/JOIN, skipping CTEs and EXTRACT(... FROM col)", async () => {
    const { sqlTables } = await import("../../src/checks");
    expect(
      sqlTables(
        "WITH days AS (SELECT EXTRACT(day FROM date) d FROM main.sale) SELECT * FROM days JOIN main.complaint c ON true",
      ),
    ).toEqual(["sale", "complaint"]);
  });

  it("finds every table of a comma FROM list and skips table functions and subqueries", async () => {
    const { sqlTables } = await import("../../src/checks");
    expect(sqlTables('SELECT 1 FROM sale s, main.lost_sale AS l, "complaint" WHERE 1')).toEqual([
      "sale",
      "lost_sale",
      "complaint",
    ]);
    expect(
      sqlTables(
        "SELECT * FROM generate_series(DATE '2025-01-01', DATE '2025-02-01', INTERVAL 1 DAY) g(d), (SELECT 1 FROM delivery) x",
      ),
    ).toEqual(["delivery"]);
    expect(sqlTables("SELECT * FROM sale WHERE x IN (SELECT y FROM complaint)")).toEqual([
      "sale",
      "complaint",
    ]);
  });

  it("flags ground_truth and unknown tables, passes supplier_delay's own expectations", async () => {
    const { checkExpectationTables } = await import("../../src/checks");
    expect(checkExpectationTables(base.expectations, base)).toEqual([]);
    const bad = [
      {
        ...base.expectations[0]!,
        id: "a",
        sql: "SELECT 'before' period, 1.0 value FROM main.purchase_attempt",
      },
      { ...base.expectations[0]!, id: "b", sql: "SELECT 'before' period, 1.0 value FROM nope" },
    ];
    expect(checkExpectationTables(bad, base).map((e) => e.message)).toEqual([
      expect.stringMatching(/"purchase_attempt", a ground_truth table/),
      expect.stringMatching(/unknown table "nope"/),
    ]);
  });
});

describe("04_story coherence", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  it("supplier_delay's story plan and entity ids pass", () => {
    expect(checkStoryPlan(story)).toEqual([]);
    expect(checkEntityIds(story, base.entities)).toEqual([]);
  });

  it("flags unknown story point ids, a SQL without period/value and duplicate ids", () => {
    const bad = {
      ...story,
      curves: story.curves.map((c) => ({
        ...c,
        segments: c.segments.map((g) => ({ ...g, storyPointId: "nope" })),
      })),
      expectations: [
        { ...story.expectations[0]!, storyPointId: "nope", sql: "SELECT 1 FROM sale" },
        story.expectations[0]!,
        story.expectations[0]!,
      ],
    };
    const paths = checkStoryPlan(bad).map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "curves.0.segments.0.storyPointId",
        "expectations.0.storyPointId",
        "expectations.0.sql",
        "expectations.2.id",
      ]),
    );
  });

  it("flags curve scopes and story point entities that name rows A5 no longer generates", () => {
    const scoped = story.curves.find((c) => c.scope)!;
    const id = scoped.scope!.ids[0]!;
    const prefix = id.split("-")[0]!;
    const entities = base.entities.map((e) => (e.idPrefix === prefix ? { ...e, count: 1 } : e));
    const paths = checkEntityIds(story, entities).map((e) => e.path);
    expect(id).not.toBe(`${prefix}-001`); // supplier_delay scopes SUP-002
    expect(paths).toContain(`curves.${story.curves.indexOf(scoped)}.scope.ids.0`);
    const renamed = base.entities.map((e) => (e.idPrefix === prefix ? { ...e, idPrefix: "XYZ" } : e));
    expect(checkEntityIds(story, renamed).some((e) => e.message.includes("no entity has idPrefix"))).toBe(
      true,
    );
  });

  it("A4 with an unknown story point id is sent back before A5 runs", async () => {
    const broken = {
      ...story,
      expectations: story.expectations.map((e) => ({ ...e, storyPointId: "nope" })),
    };
    const t = setup([company, model, influences, broken, story]);
    cleanup = t.cleanup;
    await runCascade(
      { story: "s", company: "c" },
      { llm: t.llm, runsDir: t.runsDir, runId: "r3", until: "04_story" },
    );
    expect(t.fake.calls.map((c) => c.schemaName)).toEqual([
      "01_company",
      "02_model",
      "03_influences",
      "04_story",
      "04_story",
    ]);
    expect(t.fake.calls[4]?.prompt).toContain('Unknown story point "nope"');
    expect(t.fake.calls[2]?.prompt).toContain("## Story\ns"); // A3 sees the story too
  });
});
