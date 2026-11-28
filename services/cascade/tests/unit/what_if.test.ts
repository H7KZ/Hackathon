import { afterEach, describe, expect, it } from "vitest";
import { applyWhatIf, paramPointers, whatIf, WhatIfFailed } from "../../src/what_if";
import type { CascadeEvent } from "../../src/events";
import { base, setup } from "./fixtures";

const lateFromMay = base.curves.map((c) =>
  c.id === "late_prob"
    ? { ...c, segments: c.segments.map((s) => ({ ...s, start: "2025-05-01", end: "2025-06-15" })) }
    : c,
);
const firstParam = (() => {
  const i = base.processes.findIndex((p) => "rate" in p && p.rate !== undefined);
  return `/processes/${i}/rate`;
})();

describe("applyWhatIf", () => {
  it("replaces curves and patches an existing Param, keeping meta and structure", () => {
    const res = applyWhatIf(base, {
      curves: lateFromMay,
      params: [{ pointer: firstParam, value: 3 }],
      rationale: "r",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.scenario.meta).toEqual(base.meta);
    expect(res.scenario.curves).toEqual(lateFromMay);
    expect(res.scenario.processes.map((p) => p.id)).toEqual(base.processes.map((p) => p.id));
    expect(JSON.stringify(res.scenario)).toContain('"rate":3');
    expect(base.curves).not.toEqual(lateFromMay); // base untouched
  });

  it("rejects patches outside Params", () => {
    const res = applyWhatIf(base, {
      curves: base.curves,
      params: [
        { pointer: "/meta/seed", value: 1 },
        { pointer: "/processes/0/id", value: 1 },
        { pointer: "/processes/99/rate", value: 1 },
      ],
      rationale: "r",
    });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.errors.map((e) => e.path)).toEqual([
        "params.0.pointer",
        "params.1.pointer",
        "params.2.pointer",
      ]);
  });

  it("rejects numbers that are structure, not Params (array length, entity count, lag)", () => {
    const derive = base.processes.findIndex((p) => p.type === "derive" && p.lag !== undefined);
    const res = applyWhatIf(base, {
      curves: base.curves,
      params: [
        { pointer: "/processes/length", value: 0 },
        { pointer: "/entities/0/count", value: 1 },
        { pointer: `/processes/${derive}/lag/min`, value: 9 },
      ],
      rationale: "r",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors).toHaveLength(3);
    expect(base.processes.length).toBeGreaterThan(0);
  });

  it("lists Param slots of supplier_delay: rates, derive p and curve-driven generators", () => {
    const slots = paramPointers(base);
    expect(slots).toContain(firstParam);
    for (const [i, p] of base.processes.entries())
      if (p.type === "derive") expect(slots).toContain(`/processes/${i}/p`);
    expect([...slots].every((s) => /^\/(entities|flows|processes)\//.test(s))).toBe(true);
    expect([...slots].some((s) => s.endsWith("/count") || s.includes("/lag/"))).toBe(false);
  });
});

describe("whatIf", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  it("loops on errors, then returns a compiling scenario with the same seed", async () => {
    const t = setup([
      { curves: base.curves, params: [{ pointer: "/meta/seed", value: 7 }], rationale: "špatně" },
      { curves: lateFromMay, params: [], rationale: "zpoždění od května" },
    ]);
    cleanup = t.cleanup;
    const events: CascadeEvent[] = [];
    const s = await whatIf(t.llm, "Co kdyby od května?", base, { onEvent: (e) => events.push(e) });
    expect(s.meta.seed).toBe(base.meta.seed);
    expect(s.curves).toEqual(lateFromMay);
    expect(events.map((e) => e.type)).toEqual(["loop.iteration", "loop.iteration", "log"]);
    expect(t.fake.calls[1]?.prompt).toContain("/meta/seed");
  });

  it("the prompt does not depend on the session-derived meta.id, so a recorded what-if replays in any session", async () => {
    const edit = { curves: lateFromMay, params: [], rationale: "zpoždění od května" };
    const t = setup([edit, edit]);
    cleanup = t.cleanup;
    const a = await whatIf(t.llm, "Co kdyby od května?", {
      ...base,
      meta: { ...base.meta, id: "session-a" },
    });
    const b = await whatIf(t.llm, "Co kdyby od května?", {
      ...base,
      meta: { ...base.meta, id: "session-b" },
    });
    expect(t.fake.calls).toHaveLength(1); // the second call is a cache hit
    expect(t.fake.calls[0]?.prompt).not.toContain("session-a");
    expect([a.meta.id, b.meta.id]).toEqual(["session-a", "session-b"]);
  });

  it("sends back an edit that leaves a curve unused (story check), then accepts the fix", async () => {
    const latePtr = [...paramPointers(base)].find((p) => p.endsWith("/is_late/p"));
    expect(latePtr).toBeDefined();
    const t = setup([
      { curves: base.curves, params: [{ pointer: latePtr!, value: 0.05 }], rationale: "bez křivky" },
      { curves: lateFromMay, params: [], rationale: "zpoždění od května" },
    ]);
    cleanup = t.cleanup;
    const s = await whatIf(t.llm, "Co kdyby od května?", base);
    expect(s.curves).toEqual(lateFromMay);
    expect(t.fake.calls[1]?.prompt).toContain('Curve "late_prob"');
  });

  it("gives up after 3 iterations with WhatIfFailed", async () => {
    const bad = { curves: base.curves, params: [{ pointer: "/meta/seed", value: 7 }], rationale: "x" };
    const t = setup([bad, bad, bad]);
    cleanup = t.cleanup;
    await expect(whatIf(t.llm, "?", base)).rejects.toBeInstanceOf(WhatIfFailed);
    expect(t.fake.calls).toHaveLength(3);
  });
});
