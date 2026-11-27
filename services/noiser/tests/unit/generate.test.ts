import { describe, expect, it } from "vitest";
import { loadScenarioFixture } from "@s2d/test-utils";
import { generate } from "../../src/index";

describe("generate", () => {
  it("returns compiler errors for invalid input instead of throwing", () => {
    const result = generate({ meta: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toEqual({ path: expect.any(String), message: expect.any(String) });
    }
  });

  it("returns reference errors with a path the A5 agent can act on", () => {
    const raw = loadScenarioFixture("supplier_delay") as { processes: { source?: string }[] };
    raw.processes[2] = { ...raw.processes[2], source: "nope" };
    const result = generate(raw);
    expect(result).toMatchObject({ ok: false, errors: [{ path: "processes[2].source" }] });
  });

  it("rejects invalid run options with an actionable error", () => {
    const raw = loadScenarioFixture("supplier_delay");
    expect(generate(raw, { seed: 1.5 })).toMatchObject({ ok: false, errors: [{ path: "options.seed" }] });
    expect(generate(raw, { scale: 0 })).toMatchObject({ ok: false, errors: [{ path: "options.scale" }] });
  });
});
