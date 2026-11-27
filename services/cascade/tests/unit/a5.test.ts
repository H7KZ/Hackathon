import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compileScenario } from "@s2d/noiser";
import { runCascade } from "../../src/cascade";
import type { CascadeEvent } from "../../src/events";
import { brokenDetail, company, detail, influences, model, setup, story } from "./fixtures";

const input = { story: "pozdní dodávky", company: "síť prodejen" };
const ALL = [company, model, influences, story];

describe("runCascade A1–A5", () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
  });

  function run(
    responses: unknown[],
    extra: { signal?: AbortSignal; until?: "04_story" | "05_scenario" } = {},
  ) {
    const t = setup(responses);
    cleanup = t.cleanup;
    const events: CascadeEvent[] = [];
    const promise = runCascade(input, {
      llm: t.llm,
      runsDir: t.runsDir,
      runId: "r1",
      onEvent: (e) => events.push(e),
      ...extra,
    });
    return { ...t, events, promise, dir: join(t.runsDir, "r1") };
  }

  it("emits started/done per step and a loop.iteration for A5, in order", async () => {
    const r = run([...ALL, detail]);
    await r.promise;
    expect(
      r.events.map((e) =>
        e.type === "loop.iteration" ? `loop:${e.n}:${e.ok}` : `${e.type}:${"step" in e ? e.step : ""}`,
      ),
    ).toEqual([
      "step.started:01_company",
      "step.done:01_company",
      "step.started:02_model",
      "step.done:02_model",
      "step.started:03_influences",
      "step.done:03_influences",
      "step.started:04_story",
      "step.done:04_story",
      "step.started:05_scenario",
      "loop:1:true",
      "step.done:05_scenario",
    ]);
    const written: unknown = JSON.parse(readFileSync(join(r.dir, "05_scenario.json"), "utf8"));
    const compiled = compileScenario(written);
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.scenario.meta).toMatchObject({
        id: "r1",
        seed: 42,
        company: input.company,
        story: input.story,
      });
      expect(compiled.scenario.curves).toEqual(story.curves);
      expect(compiled.scenario.expectations).toEqual(story.expectations);
    }
  });

  it("until 04_story stops before A5; the second call reuses 01–04 and runs only A5", async () => {
    const r = run([...ALL, detail], { until: "04_story" });
    await r.promise;
    expect(existsSync(join(r.dir, "05_scenario.json"))).toBe(false);
    r.events.length = 0;
    await runCascade(input, {
      llm: r.llm,
      runsDir: r.runsDir,
      runId: "r1",
      onEvent: (e) => r.events.push(e),
    });
    expect(r.fake.calls.map((c) => c.schemaName)).toEqual([
      "01_company",
      "02_model",
      "03_influences",
      "04_story",
      "05_scenario",
    ]);
    expect(r.events.filter((e) => e.type === "step.done").map((e) => e.cached)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("feeds compile errors back to the agent and succeeds on the next iteration", async () => {
    const r = run([...ALL, brokenDetail, detail]);
    await r.promise;
    const loops = r.events.filter((e) => e.type === "loop.iteration");
    expect(loops.map((e) => [e.n, e.ok])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(JSON.stringify(loops[0]?.feedback)).toContain("missing_curve");
    expect(r.fake.calls[5]?.prompt).toContain("missing_curve");
    expect(r.fake.calls[5]?.prompt).toContain("Compiler errors");
  });

  it("treats a schema-invalid agent answer as feedback, not a crash", async () => {
    const r = run([...ALL, { name: "x" }, detail]);
    await r.promise;
    const loops = r.events.filter((e) => e.type === "loop.iteration");
    expect(loops.map((e) => e.ok)).toEqual([false, true]);
    expect(typeof loops[0]?.feedback[0]).toBe("string");
    expect(r.fake.calls[5]?.prompt).toContain('"name": "x"'); // the rejected answer is shown back
    expect(loops[0]?.feedback[0]).toBe(
      "Your answer had top-level keys [name]; put the fields directly at the top level.",
    );
  });

  it("stops A5 after 3 iterations, logs it and writes no 05_scenario", async () => {
    const r = run([...ALL, brokenDetail, brokenDetail, brokenDetail, detail]);
    await expect(r.promise).rejects.toThrow(/does not compile/);
    expect(r.events.filter((e) => e.type === "loop.iteration")).toHaveLength(3);
    expect(r.events.at(-1)).toMatchObject({ type: "log" });
    expect(r.fake.calls).toHaveLength(4 + 3);
    expect(existsSync(join(r.dir, "05_scenario.json"))).toBe(false);
    expect([1, 2, 3].map((n) => existsSync(join(r.dir, `05_scenario.rejected-${n}.json`)))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("an aborted signal stops the run between steps", async () => {
    const ctrl = new AbortController();
    const t = setup(ALL);
    cleanup = t.cleanup;
    const events: CascadeEvent[] = [];
    const promise = runCascade(input, {
      llm: t.llm,
      runsDir: t.runsDir,
      runId: "r1",
      signal: ctrl.signal,
      onEvent: (e) => {
        events.push(e);
        if (e.type === "step.done" && e.step === "02_model") ctrl.abort();
      },
    });
    await expect(promise).rejects.toThrow(/abort/i);
    expect(t.fake.calls.map((c) => c.schemaName)).toEqual(["01_company", "02_model"]);
    expect(existsSync(join(t.runsDir, "r1", "03_influences.json"))).toBe(false);
  });
});
