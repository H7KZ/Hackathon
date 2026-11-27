import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createLlm } from "@s2d/llm";
import { fakeGenerate, makeTempDir } from "@s2d/test-utils";
import { cascade, getRun, listRuns, newRunId, saveArtifact } from "../../src/access";

const company = {
  industry: "maloobchod",
  size: "5 prodejen",
  actors: [{ kind: "supplier", name: "Dodavatel B", description: "dodává kuchyňské potřeby" }],
  keyProcesses: ["zásobování", "prodej"],
};
const influences = {
  edges: [
    {
      from: "late_prob",
      to: "stock",
      direction: "negative",
      weight: 0.8,
      delayDays: 3,
      rationale: "pozdní dodávky",
    },
  ],
};
const input = { story: "pozdní dodávky", company: "síť prodejen" };

describe("cascade access functions", () => {
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

  it("cascade() returns the run with its artifacts", async () => {
    const { llm, runsDir } = setup([company]);
    const res = await cascade(input, { llm, runsDir, runId: "r1", until: "01_company" });
    expect(res).toEqual({ ok: true, run: { runId: "r1", input, artifacts: { "01_company": company } } });
  });

  it("cascade() reports an invalid agent output as an error of that step instead of throwing", async () => {
    const { llm, runsDir } = setup([{ industry: "x" }, { industry: "x" }, { industry: "x" }]);
    const res = await cascade(input, { llm, runsDir, runId: "r2", until: "01_company" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]?.path).toBe("01_company");
    expect(res.errors[0]?.message).toMatch(/failed validation/);
  });

  it("cascade() rejects an unsafe runId and an empty story", async () => {
    const { llm, fake, runsDir } = setup([]);
    const bad = await cascade(input, { llm, runsDir, runId: "../x" });
    expect(bad).toMatchObject({ ok: false, errors: [{ path: "runId" }] });
    const empty = await cascade({ story: " ", company: "c" }, { llm, runsDir, runId: "r3" });
    expect(empty).toMatchObject({ ok: false, errors: [{ path: "story" }] });
    expect(fake.calls).toHaveLength(0);
  });

  it("cascade() reports reusing a run for a different story as a runId error", async () => {
    const { llm, runsDir } = setup([company]);
    await cascade(input, { llm, runsDir, runId: "r4", until: "01_company" });
    const res = await cascade({ ...input, story: "jiný příběh" }, { llm, runsDir, runId: "r4" });
    expect(res).toMatchObject({ ok: false, errors: [{ path: "runId" }] });
  });

  it("getRun() and listRuns() read runs from disk", async () => {
    const { llm, runsDir } = setup([company]);
    expect(listRuns(runsDir)).toEqual([]);
    await cascade(input, { llm, runsDir, runId: "r5", until: "01_company" });
    expect(listRuns(runsDir)).toEqual(["r5"]);
    expect(getRun(runsDir, "r5")).toMatchObject({ ok: true, run: { artifacts: { "01_company": company } } });
    expect(getRun(runsDir, "missing")).toMatchObject({ ok: false, errors: [{ path: "runId" }] });
  });

  it("saveArtifact() validates the edit and invalidates the later steps", async () => {
    const { llm, runsDir } = setup([company]);
    await cascade(input, { llm, runsDir, runId: "r6", until: "01_company" });
    const dir = join(runsDir, "r6");
    expect(saveArtifact(runsDir, "r6", "03_influences", influences)).toEqual({ ok: true, invalidated: [] });

    const bad = saveArtifact(runsDir, "r6", "01_company", { ...company, keyProcesses: [] });
    expect(bad).toMatchObject({ ok: false, errors: [{ path: "01_company.keyProcesses" }] });

    const edited = { ...company, size: "upraveno" };
    expect(saveArtifact(runsDir, "r6", "01_company", edited)).toEqual({
      ok: true,
      invalidated: ["03_influences"],
    });
    expect(JSON.parse(readFileSync(join(dir, "01_company.json"), "utf8"))).toEqual(edited);
    expect(existsSync(join(dir, "03_influences.json"))).toBe(false);

    expect(saveArtifact(runsDir, "r6", "99_nope", {})).toMatchObject({
      ok: false,
      errors: [{ path: "name" }],
    });
  });

  it("newRunId() gives a runId the access functions accept", async () => {
    const id = newRunId(new Date("2026-11-27T20:30:00.000Z"));
    expect(id).toBe("run-2026-11-27T20-30-00-000Z");
    const { llm, runsDir } = setup([company]);
    expect((await cascade(input, { llm, runsDir, runId: id, until: "01_company" })).ok).toBe(true);
  });
});
