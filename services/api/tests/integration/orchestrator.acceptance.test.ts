/**
 * Goal loops of the API orchestrator (docs/api-orchestrator.md). Written before the implementation.
 * Each `describe` is one loop: its goal is the assertion, its stop condition the awaited state.
 */
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "@s2d/test-utils";
import { BusyError, createOrchestrator, type Orchestrator } from "../../src/orchestrator";
import { fakePorts } from "../support/fakePorts";

const PROMPT = { story: "Dodavatel začal dodávat pozdě.", company: "Síť 5 prodejen." };

let tmp: ReturnType<typeof makeTempDir>;
beforeEach(() => {
  tmp = makeTempDir("s2d-orch-");
});
afterEach(() => {
  tmp.cleanup();
});

function setup(opts: Parameters<typeof fakePorts>[0] = {}) {
  const fake = fakePorts(opts);
  const orch = createOrchestrator({ ports: fake.ports, runsDir: tmp.dir });
  return { ...fake, orch };
}

async function drafted(orch: Orchestrator) {
  const { sessionId } = await orch.create(PROMPT);
  await orch.idle(sessionId);
  return sessionId;
}

async function generated(orch: Orchestrator) {
  const id = await drafted(orch);
  orch.command(id, { type: "approve" });
  await orch.idle(id);
  return id;
}

describe("L1 draft: prompt → timeline awaiting refinement", () => {
  it("runs the cascade until 04_story and pauses", async () => {
    const { orch, calls } = setup();
    const id = await drafted(orch);
    expect(orch.get(id).status).toBe("awaiting_refinement");
    expect(calls.produced).toEqual(["01_company", "02_model", "03_influences", "04_story"]);
    expect(existsSync(join(tmp.dir, id, "04_story.json"))).toBe(true);
  });

  it("the fake Firma card names actors, not entity ids (run 6: 'SUP-002' shown as an actor)", async () => {
    const { orch } = setup();
    const id = await drafted(orch);
    const company = orch.artifact(id, "01_company") as { actors: { name: string }[] };
    expect(company.actors.every((a) => !/^[A-Z]+-\d+$/.test(a.name))).toBe(true);
  });

  it("forwards cascade events to the session stream", async () => {
    const { orch } = setup();
    const id = await drafted(orch);
    const steps = orch
      .events(id)
      .flatMap((e) =>
        e.type === "cascade" ? [`${e.event.type}:${"step" in e.event ? e.event.step : ""}`] : [],
      );
    expect(steps).toContain("step.done:04_story");
  });

  it("ends in failed with an error event when the cascade throws", async () => {
    const { orch } = setup({ failAt: "02_model" });
    const id = await drafted(orch);
    expect(orch.get(id).status).toBe("failed");
    expect(orch.events(id).some((e) => e.type === "error")).toBe(true);
  });
});

describe("L2 refinement ⟲: edit an artifact → only later steps recompute", () => {
  it("keeps earlier artifacts, recomputes later ones, pauses again", async () => {
    const { orch, calls, scenario } = setup();
    const id = await drafted(orch);
    const company = join(tmp.dir, id, "01_company.json");
    const before = statSync(company).mtimeMs;

    const story = {
      storyPoints: scenario.storyPoints,
      curves: scenario.curves,
      expectations: scenario.expectations,
    };
    orch.command(id, { type: "edit_artifact", name: "03_influences", value: { edges: [] } });
    await orch.idle(id);
    // invalid 03 (edges.min(1)) is rejected before anything runs
    expect(orch.events(id).at(-1)?.type).toBe("error");

    calls.produced.length = 0;
    orch.command(id, { type: "edit_artifact", name: "04_story", value: story });
    await orch.idle(id);
    expect(orch.get(id).status).toBe("awaiting_refinement");
    expect(statSync(company).mtimeMs).toBe(before);
    expect(calls.produced).toEqual([]); // 04 edited by user, nothing after it until approve
  });

  it("an edited 04_story gets the curve's scope as entity on a point added in the editor (user run: A5 failed 5× on it)", async () => {
    const { orch, scenario } = setup();
    const id = await drafted(orch);
    const [first, ...rest] = scenario.storyPoints;
    if (!first) throw new Error("fixture has story points");
    const { entity: _drop, ...added } = first;
    const story = {
      storyPoints: [added, ...rest],
      curves: scenario.curves,
      expectations: scenario.expectations,
    };
    const res = orch.command(id, { type: "edit_artifact", name: "04_story", value: story });
    expect(res.errors).toBeUndefined();
    await orch.idle(id);
    const saved = JSON.parse(readFileSync(join(tmp.dir, id, "04_story.json"), "utf8")) as typeof story;
    const scope = scenario.curves.find((c) => c.segments.some((s) => s.storyPointId === first.id))?.scope;
    expect(saved.storyPoints[0]).toMatchObject({ entity: { name: "supplier", ids: scope?.ids } });
  });

  it("rejects an edited 04_story whose story refs cannot compile before any LLM call", async () => {
    const { orch, scenario } = setup();
    const id = await drafted(orch);
    const [first, ...rest] = scenario.storyPoints;
    if (!first) throw new Error("fixture has story points");
    const story = {
      storyPoints: [{ ...first, entity: { name: "supplier", ids: ["SUP-042"] } }, ...rest],
      curves: scenario.curves,
      expectations: scenario.expectations,
    };
    const res = orch.command(id, { type: "edit_artifact", name: "04_story", value: story });
    expect(res.errors?.map((e) => e.path)).toContain("storyPoints[0].entity.ids[0]");
    expect(orch.get(id).status).toBe("awaiting_refinement");
  });

  it("an edit of 02_model deletes 03 and 04 and recomputes them", async () => {
    const { orch, calls } = setup();
    const id = await drafted(orch);
    calls.produced.length = 0;
    const model = JSON.parse(readFileSync(join(tmp.dir, id, "02_model.json"), "utf8")) as unknown;
    orch.command(id, { type: "edit_artifact", name: "02_model", value: model });
    await orch.idle(id);
    expect(calls.produced).toEqual(["03_influences", "04_story"]);
  });
});

describe("L3 generation: approve → dataset dat1 ready", () => {
  it("runs cascade to 05, noiser, store and evidence", async () => {
    const { orch, calls } = setup();
    const id = await generated(orch);
    const s = orch.get(id);
    expect(s.status).toBe("ready");
    expect(s.datasets).toEqual([expect.objectContaining({ id: "dat1", parent: null, seed: 42 })]);
    expect(calls.noiserSeeds).toEqual([42]);
    expect(orch.events(id).some((e) => e.type === "dataset.ready" && e.datasetId === "dat1")).toBe(true);
    expect(await orch.evidence(id, "dat1")).toBeTruthy();
  });
});

describe("L4 counterfactual ⟲: what-if / direct edit → new dataset + compare", () => {
  it("text question goes through cascade.whatIf, same seed, compared with parent", async () => {
    const { orch, calls } = setup();
    const id = await generated(orch);
    orch.command(id, { type: "what_if", question: "Co kdyby od května?", from: "dat1" });
    await orch.idle(id);
    expect(calls.whatIf).toEqual(["Co kdyby od května?"]);
    expect(orch.get(id).datasets.at(-1)).toEqual(
      expect.objectContaining({ id: "dat2", parent: "dat1", seed: 42 }),
    );
    expect(await orch.compare(id, "dat2", "dat1")).toHaveLength(1);
  });

  it("direct scenario edit skips the LLM", async () => {
    const { orch, calls, scenario } = setup();
    const id = await generated(orch);
    orch.command(id, { type: "edit_scenario", from: "dat1", scenario });
    await orch.idle(id);
    expect(calls.whatIf).toEqual([]);
    expect(orch.get(id).datasets.map((d) => d.id)).toEqual(["dat1", "dat2"]);
  });

  it("an invalid scenario is rejected and no dataset is created", async () => {
    const { orch } = setup();
    const id = await generated(orch);
    orch.command(id, { type: "edit_scenario", from: "dat1", scenario: { meta: {} } });
    await orch.idle(id);
    expect(orch.get(id).datasets).toHaveLength(1);
    expect(orch.get(id).status).toBe("ready");
  });
});

describe("L5 detective on demand", () => {
  it("runs only when asked and stores the result", async () => {
    const { orch, calls } = setup();
    const id = await generated(orch);
    expect(calls.detective).toBe(0);
    orch.command(id, { type: "detect", datasetId: "dat1" });
    await orch.idle(id);
    expect(calls.detective).toBe(1);
    expect(await orch.detective(id, "dat1")).toEqual(expect.objectContaining({ score: expect.anything() }));
  });
});

describe("L6 control: busy, cancel, interrupt, resume", () => {
  it("rejects a second command while a job runs", async () => {
    let open!: () => void;
    const { orch } = setup({ gate: new Promise((r) => (open = r)) });
    const { sessionId: id } = await orch.create(PROMPT);
    expect(() => orch.command(id, { type: "approve" })).toThrow(BusyError);
    open();
    await orch.idle(id);
  });

  it("cancel during drafting ends in cancelled (no stable state yet)", async () => {
    let open!: () => void;
    const { orch } = setup({ gate: new Promise((r) => (open = r)) });
    const { sessionId: id } = await orch.create(PROMPT);
    orch.command(id, { type: "cancel" });
    open();
    await orch.idle(id);
    expect(orch.get(id).status).toBe("cancelled");
  });

  it("restart marks busy sessions interrupted; resume finishes without redoing done steps", async () => {
    const pending = new Promise<void>(() => {}); // never resolves: simulates a crash mid-job
    const first = setup({ gate: pending });
    const { sessionId: id } = await first.orch.create(PROMPT);

    const second = setup();
    second.orch.recover();
    expect(second.orch.get(id).status).toBe("interrupted");
    second.orch.command(id, { type: "resume" });
    await second.orch.idle(id);
    expect(second.orch.get(id).status).toBe("awaiting_refinement");
  });
});

describe("L6b recovery after a failed or cancelled draft", () => {
  it("resume re-runs a failed draft, reusing the artifacts it already wrote", async () => {
    const first = setup({ failAt: "03_influences" });
    const id = await drafted(first.orch);
    expect(first.orch.get(id).status).toBe("failed");
    const second = setup();
    second.orch.command(id, { type: "resume" });
    await second.orch.idle(id);
    expect(second.orch.get(id).status).toBe("awaiting_refinement");
    expect(second.calls.produced).toEqual(["03_influences", "04_story"]);
  });

  it("resume continues a cancelled draft", async () => {
    let open!: () => void;
    const { orch } = setup({ gate: new Promise((r) => (open = r)) });
    const { sessionId: id } = await orch.create(PROMPT);
    orch.command(id, { type: "cancel" });
    open();
    await orch.idle(id);
    expect(orch.get(id).status).toBe("cancelled");
    orch.command(id, { type: "resume" });
    await orch.idle(id);
    expect(orch.get(id).status).toBe("awaiting_refinement");
  });

  it("a failed approve can be retried with resume, keeping its settings (user: let me rerun it)", async () => {
    const first = setup({ failAt: "05_scenario" });
    const id = await drafted(first.orch);
    first.orch.command(id, { type: "approve", settings: { seed: 7 } });
    await first.orch.idle(id);
    expect(first.orch.get(id)).toMatchObject({ status: "awaiting_refinement", error: expect.any(String) });
    const second = setup();
    expect(second.orch.command(id, { type: "resume" }).errors).toBeUndefined();
    await second.orch.idle(id);
    expect(second.orch.get(id).status).toBe("ready");
    expect(second.orch.get(id).datasets[0]?.seed).toBe(7);
    // once it succeeded there is nothing left to retry
    expect(second.orch.command(id, { type: "resume" }).errors?.[0]?.message).toMatch(/Není co obnovit/);
  });

  it("a failed generation of an older session (no job kept) is retried as approve", async () => {
    const first = setup({ failAt: "05_scenario" });
    const id = await drafted(first.orch);
    first.orch.command(id, { type: "approve" });
    await first.orch.idle(id);
    rmSync(join(tmp.dir, id, "job.json"), { force: true });
    const second = setup();
    expect(second.orch.command(id, { type: "resume" }).errors).toBeUndefined();
    await second.orch.idle(id);
    expect(second.orch.get(id).status).toBe("ready");
  });

  it("every event carries the server time, so a reloaded UI shows true elapsed times", async () => {
    const { orch } = setup();
    const before = Date.now();
    const id = await drafted(orch);
    for (const e of orch.events(id)) expect(e.at).toBeGreaterThanOrEqual(before);
  });

  it("a finished job leaves nothing to resume", async () => {
    const { orch } = setup();
    const id = await drafted(orch);
    expect(orch.command(id, { type: "resume" }).errors?.[0]?.message).toMatch(/Není co obnovit/);
  });
});

describe("L3b approve with UI settings", () => {
  it("applies seed, kept hypotheses and noise to the dataset scenario, not to 05_scenario", async () => {
    const { orch, calls, scenario } = setup();
    const id = await drafted(orch);
    const keep = scenario.expectations.slice(0, 2).map((e) => e.id);
    orch.command(id, {
      type: "approve",
      settings: { seed: 7, expectations: keep, noise: { missing: 2, duplicates: 1, hourJitter: true } },
    });
    await orch.idle(id);
    expect(orch.get(id)).toMatchObject({ status: "ready", datasets: [{ id: "dat1", seed: 7 }] });
    expect(calls.noiserSeeds).toEqual([7]);
    const used = JSON.parse(
      readFileSync(join(tmp.dir, id, "datasets/dat1/scenario.json"), "utf8"),
    ) as typeof scenario;
    expect(used.expectations.map((e) => e.id)).toEqual(keep);
    expect(used.noise?.hourJitter).toBe(true);
    expect(Object.keys(used.noise?.duplicates ?? {}).length).toBeGreaterThan(0);
    const designed = JSON.parse(
      readFileSync(join(tmp.dir, id, "05_scenario.json"), "utf8"),
    ) as typeof scenario;
    expect(designed.meta.seed).toBe(scenario.meta.seed);
  });

  it("a hypothesis switched off in the editor does not fail the A5 gate (run-6 item 2)", async () => {
    const { orch, calls, scenario } = setup({ gateFails: ["e2"] });
    const all = scenario.expectations.map((e) => e.id);
    expect(all).toContain("e2");
    const failing = await drafted(orch);
    orch.command(failing, { type: "approve" });
    await orch.idle(failing);
    expect(orch.get(failing).status).toBe("awaiting_refinement");
    expect(orch.get(failing).error).toMatch(/e2/);

    const id = await drafted(orch);
    const keep = all.filter((x) => x !== "e2");
    orch.command(id, { type: "approve", settings: { expectations: keep } });
    await orch.idle(id);
    expect(orch.get(id).status).toBe("ready");
    expect(calls.keptExpectations.at(-1)).toEqual(keep);
  });

  it("rejects an approve that switches off every hypothesis before any cascade call", async () => {
    const { orch, calls } = setup();
    const id = await drafted(orch);
    const before = calls.produced.length;
    const res = orch.command(id, { type: "approve", settings: { expectations: [] } });
    expect(res.errors?.[0]?.path).toBe("settings.expectations");
    expect(res.errors?.[0]?.message).toMatch(/hypotéz/);
    expect(orch.get(id).status).toBe("awaiting_refinement");
    expect(calls.produced.length).toBe(before);
  });

  it("applies a user period that contains the story", async () => {
    const { orch } = setup();
    const id = await drafted(orch);
    orch.command(id, { type: "approve", settings: { period: { start: "2024-06-01", end: "2026-06-30" } } });
    await orch.idle(id);
    expect(orch.get(id).status).toBe("ready");
    expect(orch.scenario(id, "dat1").meta).toMatchObject({ start: "2024-06-01", end: "2026-06-30" });
  });

  it("rejects a period that cuts the story off before any cascade call", async () => {
    const { orch, calls } = setup();
    const id = await drafted(orch);
    const before = calls.produced.length;
    const res = orch.command(id, {
      type: "approve",
      settings: { period: { start: "2030-01-01", end: "2030-12-31" } },
    });
    expect(res.errors?.[0]?.path).toBe("settings.period");
    expect(orch.get(id).status).toBe("awaiting_refinement");
    expect(calls.produced.length).toBe(before);
  });
});

describe("L7 event log", () => {
  it("seq strictly increases and replay after a seq returns exactly the later events", async () => {
    const { orch } = setup();
    const id = await generated(orch);
    const all = orch.events(id);
    const seqs = all.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    const mid = seqs[Math.floor(seqs.length / 2)] ?? 0;
    expect(orch.events(id, mid)).toEqual(all.filter((e) => e.seq > mid));
  });

  it("the log survives a restart (read from events.jsonl)", async () => {
    const { orch } = setup();
    const id = await drafted(orch);
    const again = setup();
    expect(again.orch.events(id)).toEqual(orch.events(id));
  });
});

describe("entity labels (user: nobody knows what STO-001 means)", () => {
  it("names entity ids before any data (02_model, default seed) and per dataset (its seed)", async () => {
    const { orch } = setup();
    const id = await drafted(orch);
    const draft = orch.labels(id);
    expect(draft["SUP-001"]).toEqual(expect.any(String));
    orch.command(id, { type: "approve", settings: { seed: 42 } });
    await orch.idle(id);
    expect(orch.labels(id, "dat1")["SUP-001"]).toBe(draft["SUP-001"]);
  });
});
