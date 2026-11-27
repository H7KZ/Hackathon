import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CausalMap, ProcessesPlan } from "@s2d/schema/artifacts";
import { runCascade } from "../../src/cascade";
import { checkCausalMap, findCycle } from "../../src/causal/map";
import { checkTrace, realizationsAt, resolvePointer } from "../../src/causal/trace";
import { causalMap, processesPlan } from "./causal_fixtures";
import { company, model, setup } from "./fixtures";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("03a causal map checks", () => {
  it("fixtures match the schema and pass", () => {
    expect(CausalMap.parse(causalMap)).toEqual(causalMap);
    expect(ProcessesPlan.parse(processesPlan)).toEqual(processesPlan);
    expect(checkCausalMap(causalMap)).toEqual([]);
  });

  it("flags unknown nodes, edges into levers, missing p and baselines, and cycles", () => {
    const bad = clone(causalMap);
    bad.edges.push(
      { id: "x1", from: "nope", to: "late_prob", type: "mechanical", sign: "positive", rationale: "" },
      { id: "x2", from: "complaint", to: "purchase", type: "probabilistic", sign: "positive", rationale: "" },
    );
    delete bad.nodes[0]!.baseline;
    const paths = checkCausalMap(bad).map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(["edges.9.from", "edges.9.to", "edges.10.p", "nodes.0.baseline", "edges"]),
    );
    expect(findCycle(bad.edges)).toEqual(expect.arrayContaining(["purchase", "complaint"]));
  });

  it("a map without levers is sent back", () => {
    const noLever = { ...causalMap, nodes: causalMap.nodes.map((n) => ({ ...n, kind: "event" as const })) };
    expect(checkCausalMap(noLever).some((e) => e.message.includes("no lever"))).toBe(true);
  });
});

describe("03b trace and coverage", () => {
  it("resolves pointers and classifies realizations", () => {
    expect(resolvePointer(processesPlan, "/processes/0/fields/is_late/gen")).toBe("bernoulli");
    expect(resolvePointer(processesPlan, "/processes/99")).toBeUndefined();
    expect([...realizationsAt(processesPlan, "/processes/3")]).toEqual(["derive"]);
    expect(realizationsAt(processesPlan, "/processes/0/fields/is_late/p").has("bernoulli")).toBe(true);
    expect(realizationsAt(processesPlan, "/processes/2/cond").has("flowCond")).toBe(true);
  });

  it("supplier_delay realizes every edge", () => {
    expect(checkTrace(processesPlan, causalMap)).toEqual([]);
  });

  it("flags a missing edge, a wrong realization kind, an untraced derive and a curve off a lever", () => {
    const bad = clone(processesPlan);
    delete bad.trace.e_sale_complaint; // leaves complaint_quality untraced
    bad.trace.e_lost_complaint = "/processes/3/fields/customer_id"; // a ref is not probabilistic
    bad.trace.e_ghost = "/processes/0";
    (bad.processes[3] as { p: unknown }).p = { curve: "complaint_prob" };
    const errors = checkTrace(bad, causalMap);
    const paths = errors.map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "trace.e_sale_complaint",
        "trace.e_lost_complaint",
        "trace.e_ghost",
        "processes.4",
        "curves",
      ]),
    );
    expect(errors.find((e) => e.path === "curves")?.message).toMatch(/complaint_prob.*not a lever/);
  });

  it("a lever edge must point at the lever's curve", () => {
    const bad = clone(processesPlan);
    bad.trace.e_late = "/processes/0/fields/delay_days"; // an if, not the late_prob bernoulli
    const errors = checkTrace(bad, causalMap).filter((e) => e.path === "trace.e_late");
    expect(errors.map((e) => e.message).join("\n")).toMatch(/\{"curve": "late_prob"\}/);
  });
});

describe("causal design in the cascade", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  it("writes 03a/03b, sending a bad map and an incomplete trace back first", async () => {
    const cyclic = clone(causalMap);
    cyclic.edges.push({
      id: "loop",
      from: "complaint",
      to: "purchase",
      type: "mechanical",
      sign: "negative",
      rationale: "",
    });
    const untraced = { ...processesPlan, trace: { ...processesPlan.trace, e_sale: undefined } };
    delete untraced.trace.e_sale;
    const t = setup([company, model, cyclic, causalMap, untraced, processesPlan]);
    cleanup = t.cleanup;
    const res = await runCascade(
      { story: "s", company: "c" },
      { llm: t.llm, runsDir: t.runsDir, runId: "c1", design: "causal", until: "03b_processes" },
    );
    expect(t.fake.calls.map((c) => c.schemaName)).toEqual([
      "01_company",
      "02_model",
      "03a_causal_map",
      "03a_causal_map",
      "03b_processes",
      "03b_processes",
    ]);
    expect(t.fake.calls[3]?.prompt).toContain("cycle");
    expect(t.fake.calls[5]?.prompt).toContain('Edge "e_sale"');
    expect(res.processes).toEqual(processesPlan);
    const dir = join(t.runsDir, "c1");
    expect(JSON.parse(readFileSync(join(dir, "03a_causal_map.json"), "utf8"))).toEqual(causalMap);
    expect(existsSync(join(dir, "03_influences.json"))).toBe(false);
  });

  it("rejects an until step the design does not have", async () => {
    const t = setup([]);
    cleanup = t.cleanup;
    await expect(
      runCascade(
        { story: "s", company: "c" },
        { llm: t.llm, runsDir: t.runsDir, runId: "c2", design: "causal", until: "03_influences" },
      ),
    ).rejects.toThrow(/no step 03_influences/);
  });
});
