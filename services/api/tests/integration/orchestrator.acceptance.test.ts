/**
 * Goal loops of the API orchestrator (docs/api-orchestrator.md). Written before the implementation.
 * Each `describe` is one loop: its goal is the assertion, its stop condition the awaited state.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
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

describe("L3 generation: approve → dataset d1 ready", () => {
  it("runs cascade to 05, noiser, store and evidence", async () => {
    const { orch, calls } = setup();
    const id = await generated(orch);
    const s = orch.get(id);
    expect(s.status).toBe("ready");
    expect(s.datasets).toEqual([expect.objectContaining({ id: "d1", parent: null, seed: 42 })]);
    expect(calls.noiserSeeds).toEqual([42]);
    expect(orch.events(id).some((e) => e.type === "dataset.ready" && e.datasetId === "d1")).toBe(true);
    expect(await orch.evidence(id, "d1")).toBeTruthy();
  });
});

describe("L4 counterfactual ⟲: what-if / direct edit → new dataset + compare", () => {
  it("text question goes through cascade.whatIf, same seed, compared with parent", async () => {
    const { orch, calls } = setup();
    const id = await generated(orch);
    orch.command(id, { type: "what_if", question: "Co kdyby od května?", from: "d1" });
    await orch.idle(id);
    expect(calls.whatIf).toEqual(["Co kdyby od května?"]);
    expect(orch.get(id).datasets.at(-1)).toEqual(
      expect.objectContaining({ id: "d2", parent: "d1", seed: 42 }),
    );
    expect(await orch.compare(id, "d2", "d1")).toHaveLength(1);
  });

  it("direct scenario edit skips the LLM", async () => {
    const { orch, calls, scenario } = setup();
    const id = await generated(orch);
    orch.command(id, { type: "edit_scenario", from: "d1", scenario });
    await orch.idle(id);
    expect(calls.whatIf).toEqual([]);
    expect(orch.get(id).datasets.map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("an invalid scenario is rejected and no dataset is created", async () => {
    const { orch } = setup();
    const id = await generated(orch);
    orch.command(id, { type: "edit_scenario", from: "d1", scenario: { meta: {} } });
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
    orch.command(id, { type: "detect", datasetId: "d1" });
    await orch.idle(id);
    expect(calls.detective).toBe(1);
    expect(await orch.detective(id, "d1")).toEqual(expect.objectContaining({ score: expect.anything() }));
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
