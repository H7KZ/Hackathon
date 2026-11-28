import { describe, expect, it } from "vitest";
import { compileScenario } from "@s2d/noiser";
import { loadScenarioFixture } from "@s2d/test-utils";
import type { Scenario } from "@s2d/schema/scenario";
import { applySettings } from "../../src/settings";

const base = loadScenarioFixture("supplier_delay") as Scenario;

describe("applySettings", () => {
  it("no settings = the same scenario", () => {
    expect(applySettings(base, undefined)).toBe(base);
  });

  it("noise maps to value columns of observed process tables and still compiles", () => {
    const s = applySettings(base, { noise: { missing: 5, duplicates: 2, hourJitter: true } });
    const res = compileScenario(s);
    expect(res.ok ? [] : res.errors).toEqual([]);
    const cols = Object.keys(s.noise?.missing ?? {});
    expect(cols.length).toBeGreaterThan(0);
    expect(cols.every((c) => !/(\.id|_id|\.date|\.ts)$/.test(c))).toBe(true);
    expect(Object.values(s.noise?.duplicates ?? {}).every((p) => p === 0.02)).toBe(true);
  });

  it("zero noise removes the noise block; scale 1 removes meta.scale; curves never change", () => {
    const s = applySettings(
      { ...base, meta: { ...base.meta, scale: 2 } },
      { scale: 1, noise: { missing: 0, duplicates: 0, hourJitter: false } },
    );
    expect(s.noise).toBeUndefined();
    expect(s.meta.scale).toBeUndefined();
    expect(s.curves).toEqual(base.curves);
    expect(base.meta.seed).toBe(42); // input untouched
  });
});

describe("period setting", () => {
  it("replaces meta.start / meta.end and still compiles", () => {
    const s = applySettings(base, { period: { start: "2024-10-01", end: "2025-12-31" } });
    expect(s.meta.start).toBe("2024-10-01");
    expect(s.meta.end).toBe("2025-12-31");
    const res = compileScenario(s);
    expect(res.ok ? [] : res.errors).toEqual([]);
    expect(base.meta.start).toBe("2025-01-01"); // input untouched
  });

  it("periodErrors names the story dates outside the period, in Czech", async () => {
    const { periodErrors } = await import("../../src/settings");
    expect(periodErrors(base, { start: "2024-10-01", end: "2025-12-31" })).toEqual([]);
    const errors = periodErrors(base, { start: "2025-03-15", end: "2025-12-31" });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe("settings.period");
    expect(errors[0]?.message).toMatch(/2025-03-01/);
    expect(errors[0]?.message).toMatch(/období/);
  });
});
