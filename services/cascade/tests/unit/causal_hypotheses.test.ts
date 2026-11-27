import { afterEach, describe, expect, it } from "vitest";
import { ExpectationsPlan } from "@s2d/schema/artifacts";
import { compileScenario } from "@s2d/noiser";
import { runCascade } from "../../src/cascade";
import { deriveHypotheses, netSign, pathsFrom } from "../../src/causal/hypotheses";
import { causalStory, checkQueries } from "../../src/causal/sql";
import { causalMap, overlay, processesPlan, queries } from "./causal_fixtures";
import { company, model, setup } from "./fixtures";

const input = { story: "s", company: "c" };
const summary = (hs: ReturnType<typeof deriveHypotheses>) =>
  hs.map((h) => `${h.id}:${h.direction}${h.focus ? `:${h.focus.mode}` : ""}`);

describe("hypotheses from map + overlay (D3)", () => {
  it("follows edge signs from the moved lever; scoped metrics get an out-of-scope control", () => {
    const hs = deriveHypotheses(causalMap, overlay, processesPlan);
    expect(summary(hs)).toEqual([
      "sp1_late_delivery:increase:only", // rare event (probabilistic edge): no stable control
      "sp1_stock:decrease:only",
      "sp1_stock_outside:stable:exclude",
      "sp1_sale:decrease:only",
      "sp1_sale_outside:stable:exclude",
      "sp1_complaint:increase:only",
    ]);
    // ground_truth tables (purchase_attempt, lost_sale) are not measurable
    expect(hs.some((h) => h.table === "lost_sale" || h.table === "purchase_attempt")).toBe(false);
    const [first] = hs;
    expect(first?.focus).toEqual({ entity: "supplier", ids: ["SUP-002"], mode: "only" });
    expect(first?.before).toEqual({ start: "2025-01-01", end: "2025-03-01" });
    expect(first?.after).toEqual({ start: "2025-03-01", end: "2025-09-01" });
    expect(hs.find((h) => h.id === "sp1_complaint")?.path).toEqual([
      "e_late",
      "e_late_stock",
      "e_stock",
      "e_lost",
      "e_lost_complaint",
    ]);
  });

  it("a dominant path decides between opposite signs; equal strengths are ambiguous", () => {
    const toComplaint = pathsFrom(causalMap, "late_prob").get("complaint") ?? [];
    expect(toComplaint.map((p) => p.sign).sort()).toEqual([-1, 1]);
    expect(netSign(toComplaint)).toMatchObject({ sign: 1 });
    expect(
      netSign([
        { sign: 1, strength: 0.2, edges: [] },
        { sign: -1, strength: 0.15, edges: [] },
      ]),
    ).toBe("ambiguous");
  });

  it("a metric on no path from the moved lever is a stable control; unmoved levers yield nothing", () => {
    const map = {
      ...causalMap,
      nodes: [
        ...causalMap.nodes,
        { id: "customers", kind: "event" as const, description: "zákazníci", table: "customer" },
      ],
    };
    expect(summary(deriveHypotheses(map, overlay, processesPlan))).toContain("sp1_customers_control:stable");
    const flat = {
      ...overlay,
      levers: [{ lever: "late_prob", values: [{ storyPointId: "sp1", value: 0.05 }] }],
    };
    expect(deriveHypotheses(causalMap, flat, processesPlan)).toEqual([]);
  });

  it("a lever moving down flips every direction", () => {
    const down = {
      ...overlay,
      levers: [{ ...overlay.levers[0]!, values: [{ storyPointId: "sp1", value: 0.01 }] }],
    };
    const hs = deriveHypotheses(causalMap, down, processesPlan);
    expect(hs.find((h) => h.id === "sp1_sale")?.direction).toBe("increase");
    expect(hs.find((h) => h.id === "sp1_complaint")?.direction).toBe("decrease");
  });
});

describe("04b SQL checks", () => {
  const hs = deriveHypotheses(causalMap, overlay, processesPlan);

  it("the fixture queries pass", () => {
    expect(checkQueries(hs, queries, processesPlan)).toEqual([]);
  });

  it("flags missing, unknown, wrong-table and ground_truth queries", () => {
    const bad = [
      ...queries
        .slice(1)
        .map((q) =>
          q.hypothesisId === "sp1_sale"
            ? { ...q, sql: "SELECT 'before' period, 1.0 value FROM main.complaint" }
            : q,
        ),
      { hypothesisId: "nope", sql: "SELECT 'x' period, 1 value FROM main.sale" },
      {
        hypothesisId: "sp1_stock",
        sql: "SELECT 'x' period, 1 value FROM main.stock_daily JOIN main.lost_sale ON true",
      },
    ];
    const msgs = checkQueries(hs, bad, processesPlan)
      .map((e) => e.message)
      .join("\n");
    expect(msgs).toMatch(/No query for hypothesis "sp1_late_delivery"/);
    expect(msgs).toMatch(/Unknown hypothesis "nope"/);
    expect(msgs).toMatch(/"sp1_sale" measures table "sale"/);
    expect(msgs).toMatch(/Second query for "sp1_stock"/);
    expect(msgs).toMatch(/"lost_sale", a ground_truth table/);
  });
});

describe("causal design end to end (fake LLM)", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  it("05_scenario is assembled by code: curves from the matrix, expectations from the hypotheses", async () => {
    const missing = { queries: queries.slice(1) };
    const t = setup([company, model, causalMap, processesPlan, overlay, missing, { queries }]);
    cleanup = t.cleanup;
    const res = await runCascade(input, { llm: t.llm, runsDir: t.runsDir, runId: "c4", design: "causal" });
    expect(t.fake.calls.map((c) => c.schemaName)).toEqual([
      "01_company",
      "02_model",
      "03a_causal_map",
      "03b_processes",
      "04a_overlay",
      "04b_expectations",
      "04b_expectations",
    ]);
    expect(t.fake.calls.at(-1)?.prompt).toContain('No query for hypothesis "sp1_late_delivery"');
    expect(ExpectationsPlan.parse(res.expectations).queries).toEqual(queries);
    expect(res.story).toEqual(causalStory(causalMap, overlay, res.expectations!));
    const compiled = compileScenario(res.scenario);
    expect(compiled.ok).toBe(true);
    expect(res.scenario?.curves.find((c) => c.id === "late_prob")?.segments).toHaveLength(1);
    expect(res.scenario?.expectations.map((e) => e.check.kind)).toContain("stable");
    expect(res.scenario?.meta.start).toBe(overlay.start);
  });

  it("runs the injected story gate on the assembled 05_scenario; a failure stops the step", async () => {
    const answers = [company, model, causalMap, processesPlan, overlay, { queries }];
    const ok = setup(answers);
    const seen: string[] = [];
    await runCascade(input, {
      llm: ok.llm,
      runsDir: ok.runsDir,
      runId: "c5",
      design: "causal",
      verify: (s) => {
        seen.push(s.meta.id);
        return Promise.resolve([]);
      },
    });
    ok.cleanup();
    expect(seen).toEqual(["c5"]);
    const bad = setup(answers);
    cleanup = bad.cleanup;
    await expect(
      runCascade(input, {
        llm: bad.llm,
        runsDir: bad.runsDir,
        runId: "c6",
        design: "causal",
        verify: () => Promise.resolve([{ path: "expectations[0]", message: "too weak" }]),
      }),
    ).rejects.toThrow(/too weak/);
  });
});
