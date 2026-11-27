import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fakeGenerate, loadScenarioFixture, makeTempDir } from "../../src/index";

describe("test-utils", () => {
  it("loads a fresh copy of a scenario fixture", () => {
    const a = loadScenarioFixture("supplier_delay") as { meta: { id: string } };
    const b = loadScenarioFixture("supplier_delay") as { meta: { id: string } };
    a.meta.id = "mutated";
    expect(b.meta.id).toBe("supplier_delay");
  });

  it("creates and cleans a temp dir", () => {
    const { dir, cleanup } = makeTempDir();
    expect(existsSync(dir)).toBe(true);
    cleanup();
    expect(existsSync(dir)).toBe(false);
  });

  it("fakeGenerate replays responses in order and records calls", async () => {
    const { generate, calls } = fakeGenerate([1, 2]);
    expect(await generate({ schemaName: "a", prompt: "p" })).toBe(1);
    expect(await generate({ schemaName: "b", prompt: "q" })).toBe(2);
    await expect(generate({ schemaName: "c", prompt: "r" })).rejects.toThrow(/no response/);
    expect(calls.map((c) => c.schemaName)).toEqual(["a", "b", "c"]);
  });
});
