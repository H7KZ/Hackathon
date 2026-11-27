import { describe, expect, it } from "vitest";
import { loadScenarioFixture } from "@s2d/test-utils";
import { storyGate } from "../../src/gate";

type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- fixture surgery
const fixture = () => loadScenarioFixture("supplier_delay") as Mutable;

describe("storyGate (engine + DuckDB + expectations, seed 42)", () => {
  it("passes supplier_delay", async () => {
    expect(await storyGate(fixture())).toEqual([]);
  }, 60_000);

  it("reports failing expectations when the story curve does not move", async () => {
    const s = fixture();
    s.curves[0].segments[0].to = 0.05; // late probability stays at the baseline
    const errors = await storyGate(s);
    expect(errors.map((e) => e.path)).toContain("expectations[0]");
    expect(errors.find((e) => e.path === "expectations[0]")?.message).toMatch(/"e1".*before.*after/);
  }, 60_000);

  it("reports a baseline drift when stock drains before the story (restocking below demand)", async () => {
    const s = fixture();
    s.flows[0].initial = { gen: "const", value: 20 };
    s.processes[0].fields.quantity.target = 1; // weekly top-up to 1 unit: stock drains from 20
    const errors = await storyGate(s);
    expect(
      errors.some((e) => e.path.startsWith("tables.") && /before the story starts/.test(e.message)),
    ).toBe(true);
  }, 60_000);
});
