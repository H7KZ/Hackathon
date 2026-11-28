import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLlm } from "@s2d/llm";
import { fakeGenerate, loadScenarioFixture, makeTempDir } from "@s2d/test-utils";
import type { Scenario } from "@s2d/schema/scenario";
import { runCascade } from "../../src/cascade";

const company = {
  industry: "maloobchod",
  size: "5 prodejen",
  actors: [{ kind: "supplier", name: "Dodavatel B", description: "dodává kuchyňské potřeby" }],
  keyProcesses: ["zásobování", "prodej"],
};

describe("runCascade", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  function setup(responses: unknown[]) {
    const tmp = makeTempDir();
    cleanup = tmp.cleanup;
    const fake = fakeGenerate(responses);
    const llm = createLlm({
      generate: fake.generate,
      cacheDir: join(tmp.dir, "cache"),
      offline: false,
      model: "anthropic:test",
    });
    return { llm, fake, runsDir: join(tmp.dir, "runs") };
  }

  it("A1 writes a validated 01_company.json and the input", async () => {
    const { llm, fake, runsDir } = setup([company]);
    const res = await runCascade(
      { story: "pozdní dodávky", company: "síť prodejen" },
      { llm, runsDir, runId: "r1", until: "01_company" },
    );
    expect(res.company).toEqual(company);
    expect(JSON.parse(readFileSync(join(runsDir, "r1", "01_company.json"), "utf8"))).toEqual(company);
    expect(existsSync(join(runsDir, "r1", "00_input.json"))).toBe(true);
    expect(fake.calls.map((c) => c.schemaName)).toEqual(["01_company"]);
  });

  it("reuses an existing (hand-edited) artifact instead of calling the agent", async () => {
    const { llm, fake, runsDir } = setup([]);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(runsDir, "r2"), { recursive: true });
    writeFileSync(join(runsDir, "r2", "01_company.json"), JSON.stringify({ ...company, size: "upraveno" }));
    const events: unknown[] = [];
    const res = await runCascade(
      { story: "s", company: "c" },
      { llm, runsDir, runId: "r2", until: "01_company", onEvent: (e) => events.push(e) },
    );
    expect(res.company.size).toBe("upraveno");
    expect(fake.calls).toHaveLength(0);
    expect(events).toEqual([{ type: "step.done", step: "01_company", cached: true }]);
  });

  it("fails loudly when the agent output still misses the schema after 3 attempts", async () => {
    const bad = { industry: "x" };
    const { llm, fake, runsDir } = setup([bad, bad, bad]);
    await expect(
      runCascade({ story: "s", company: "c" }, { llm, runsDir, runId: "r3", until: "01_company" }),
    ).rejects.toThrow(/01_company failed validation/);
    expect(fake.calls).toHaveLength(3);
  });

  it("re-asks with the zod issues when the answer misses the schema", async () => {
    const { llm, fake, runsDir } = setup([{ industry: "x" }, company]);
    const events: unknown[] = [];
    const res = await runCascade(
      { story: "s", company: "c" },
      { llm, runsDir, runId: "r5", until: "01_company", onEvent: (e) => events.push(e) },
    );
    expect(res.company).toEqual(company);
    expect(fake.calls[1]?.prompt).toMatch(
      /failed schema validation[\s\S]*Previous answer\n\{"industry":"x"\}[\s\S]*keyProcesses/,
    );
    expect(events).toEqual([
      { type: "step.started", step: "01_company" },
      { type: "loop.iteration", step: "01_company", n: 1, ok: false, feedback: [expect.any(String)] },
      { type: "loop.iteration", step: "01_company", n: 2, ok: true, feedback: [] },
      { type: "step.done", step: "01_company", cached: false },
    ]);
  });

  it("refuses to reuse a run dir created for a different story", async () => {
    const { llm, runsDir } = setup([company]);
    await runCascade({ story: "a", company: "c" }, { llm, runsDir, runId: "r4", until: "01_company" });
    await expect(
      runCascade({ story: "b", company: "c" }, { llm, runsDir, runId: "r4", until: "01_company" }),
    ).rejects.toThrow(/different story/);
  });

  describe("an edited 04_story before A5 (user run: a point added in the editor had no entity, A5 failed 5×)", () => {
    function seed(runsDir: string, runId: string, edit: (s: Scenario) => Scenario["storyPoints"]) {
      const s = loadScenarioFixture("supplier_delay") as Scenario;
      const dir = join(runsDir, runId);
      mkdirSync(dir, { recursive: true });
      const write = (name: string, v: unknown) => {
        writeFileSync(join(dir, `${name}.json`), JSON.stringify(v));
      };
      write("01_company", company);
      write("02_model", { entities: s.entities, flows: s.flows, processes: s.processes });
      write("03_influences", {
        edges: [
          { from: "delay", to: "stock", direction: "negative", weight: 0.7, delayDays: 7, rationale: "x" },
        ],
      });
      write("04_story", { storyPoints: edit(s), curves: s.curves, expectations: s.expectations });
      return s;
    }

    it("fails fast without an LLM call when its story refs cannot compile", async () => {
      const { llm, fake, runsDir } = setup([]);
      seed(runsDir, "e1", (s) =>
        s.storyPoints.map((p, i) => (i === 0 ? { ...p, entity: { name: "supplier", ids: ["SUP-042"] } } : p)),
      );
      await expect(
        runCascade({ story: "s", company: "c" }, { llm, runsDir, runId: "e1", until: "05_scenario" }),
      ).rejects.toThrow(/04_story[\s\S]*SUP-042/);
      expect(fake.calls).toHaveLength(0);
    });

    it("completes a missing entity from the curve scope and goes on to A5", async () => {
      const { llm, fake, runsDir } = setup([]);
      seed(runsDir, "e2", (s) =>
        s.storyPoints.map(({ entity, ...p }, i) => (i === 0 ? p : { ...p, entity })),
      );
      await expect(
        runCascade({ story: "s", company: "c" }, { llm, runsDir, runId: "e2", until: "05_scenario" }),
      ).rejects.not.toThrow(/04_story/);
      expect(fake.calls.map((c) => c.schemaName)).toContain("05_scenario");
      const saved = JSON.parse(readFileSync(join(runsDir, "e2", "04_story.json"), "utf8")) as Scenario;
      expect(saved.storyPoints[0]?.entity).toEqual({ name: "supplier", ids: ["SUP-002"] });
    });
  });

  it.todo("A2–A4 chain passes previous artifacts into the prompt");
});
