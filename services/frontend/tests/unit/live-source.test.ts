import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "@s2d/schema/api";
import { createLiveSource } from "../../lib/chat/liveSource";
import type { SourceEvent } from "../../lib/chat/types";

type NewEvent = SessionEvent extends infer E
  ? E extends SessionEvent
    ? Omit<E, "seq" | "at"> & { at?: number }
    : never
  : never;

/** Minimal EventSource stand-in: the test pushes SessionEvents by hand. */
class FakeEventSource {
  static last: FakeEventSource | undefined;
  onmessage: ((m: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  push(e: NewEvent, seq: number) {
    this.onmessage?.({ data: JSON.stringify({ ...e, seq }) } as MessageEvent<string>);
  }
  close() {}
}

const steps = (events: SourceEvent[], surfaceId: string) => {
  let list: { id: string; state: string }[] = [];
  for (const e of events) {
    if (e.type !== "a2ui") continue;
    const m = e.message;
    if ("createSurface" in m && m.createSurface.surfaceId === surfaceId)
      list = (m.createSurface.dataModel as { steps: typeof list }).steps;
    if (
      "updateDataModel" in m &&
      m.updateDataModel.surfaceId === surfaceId &&
      m.updateDataModel.path === "/steps"
    )
      list = m.updateDataModel.value as typeof list;
  }
  return list;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function start(
  state: Record<string, unknown> = { status: "ready", datasets: [] },
  artifacts: Record<string, unknown> = {},
  routes: Record<string, unknown> = {},
  commandStatus = 202,
) {
  vi.stubGlobal("EventSource", FakeEventSource);
  const requests: { url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const raw = typeof init?.body === "string" ? init.body : undefined;
      requests.push({ url, ...(raw ? { body: JSON.parse(raw) as unknown } : {}) });
      const route = Object.keys(routes).find((k) => url.includes(k));
      const body = route
        ? routes[route]
        : url.endsWith("/commands")
          ? { ok: true, seq: 1 }
          : url.includes("/artifacts/")
            ? { value: artifacts[url.split("/artifacts/")[1] ?? ""] ?? {} }
            : state;
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: url.endsWith("/commands") ? commandStatus : 200 }),
      );
    }),
  );
  const events: SourceEvent[] = [];
  const source = createLiveSource("11111111-1111-1111-1111-111111111111");
  const stop = source.start((e) => events.push(e));
  const es = FakeEventSource.last;
  if (!es) throw new Error("no EventSource");
  return { source, stop, es, events, requests };
}

describe("live source", () => {
  it("the generation card lists only its own steps, not the cached A1–A4 replay", async () => {
    const { es, events, stop } = start();
    es.push({ type: "status", status: "generating" }, 1);
    for (const step of ["01_company", "02_model", "03_influences", "04_story"] as const) {
      es.push({ type: "cascade", event: { type: "step.started", step } }, 2);
      es.push({ type: "cascade", event: { type: "step.done", step, cached: true } }, 3);
    }
    es.push({ type: "cascade", event: { type: "step.started", step: "05_scenario" } }, 4);
    await vi.waitFor(() => {
      expect(steps(events, "progress-1").map((s) => s.id)).toEqual(["05_scenario", "engine", "evidence"]);
    });
    stop();
  });

  it("the draft card takes steps of the causal design as they start and drops unused ones", async () => {
    const { es, events, stop } = start({ status: "awaiting_refinement", datasets: [] });
    es.push({ type: "status", status: "drafting" }, 1);
    for (const step of ["01_company", "02_model", "03a_causal_map", "03b_processes", "04_story"] as const) {
      es.push({ type: "cascade", event: { type: "step.started", step } }, 2);
      es.push({ type: "cascade", event: { type: "step.done", step, cached: false } }, 3);
    }
    es.push({ type: "status", status: "awaiting_refinement" }, 4);
    await vi.waitFor(() => {
      expect(steps(events, "progress-1").map((s) => s.id)).toEqual([
        "01_company",
        "02_model",
        "03a_causal_map",
        "03b_processes",
        "04_story",
      ]);
    });
    stop();
  });

  it("cancel sends the cancel command; an error event becomes a readable message", async () => {
    const { source, es, events, requests, stop } = start();
    source.cancel?.();
    await vi.waitFor(() => {
      expect(
        requests.some((r) => r.url.endsWith("/commands") && (r.body as { type: string }).type === "cancel"),
      ).toBe(true);
    });
    es.push({ type: "error", message: "LLM_OFFLINE=1 and no cache entry for what_if (key x)" }, 9);
    es.push({ type: "status", status: "ready" }, 10);
    await vi.waitFor(() => {
      expect(JSON.stringify(events)).toContain("živý jazykový model");
    });
    stop();
  });

  it("an interrupted session offers a resume card that sends resume", async () => {
    const { source, es, events, requests, stop } = start({ status: "interrupted", datasets: [] });
    es.push({ type: "status", status: "interrupted" }, 1);
    await vi.waitFor(() => {
      expect(
        events.some(
          (e) =>
            e.type === "a2ui" &&
            "createSurface" in e.message &&
            e.message.createSurface.surfaceId === "recover-1",
        ),
      ).toBe(true);
    });
    source.send({
      kind: "action",
      action: {
        name: "resume",
        surfaceId: "recover-1",
        sourceComponentId: "go",
        timestamp: "",
        context: { surfaceId: "recover-1" },
      },
    });
    await vi.waitFor(() => {
      expect(requests.some((r) => (r.body as { type?: string } | undefined)?.type === "resume")).toBe(true);
    });
    stop();
  });
});

describe("live source: progress feedback (run-4 follow-up)", () => {
  it("a running step gets a start time and a plain-words hint; a failed attempt names the next try", async () => {
    const { es, events, stop } = start();
    es.push({ type: "status", status: "generating" }, 1);
    await vi.waitFor(() => {
      expect(steps(events, "progress-1")).not.toEqual([]);
    });
    let s = steps(events, "progress-1") as { id: string; state: string; startedAt?: number; hint?: string }[];
    expect(s[0]).toMatchObject({ id: "05_scenario", state: "running" });
    expect(typeof s[0]?.startedAt).toBe("number");
    expect(s[0]?.hint).toMatch(/minutu/);
    es.push(
      {
        type: "cascade",
        event: {
          type: "loop.iteration",
          step: "05_scenario",
          n: 1,
          ok: false,
          feedback: [{ path: "x", message: "broken" }],
        },
      },
      2,
    );
    await vi.waitFor(() => {
      expect(steps(events, "progress-1")[0]).toHaveProperty("attempt");
    });
    s = steps(events, "progress-1");
    expect(s[0]).toMatchObject({
      state: "running",
      detail: "pokus 1: agent opravuje 1 chybu ve scénáři",
      attempt: { n: 2, max: 5 },
    });
    stop();
  });

  it("the detective card runs (timer + what the detective does) as soon as detecting starts", async () => {
    const { es, events, stop } = start();
    es.push({ type: "status", status: "detecting" }, 1);
    await vi.waitFor(() => {
      expect(steps(events, "progress-1")).not.toEqual([]);
    });
    const s = steps(events, "progress-1") as { state: string; hint?: string }[];
    expect(s[0]?.state).toBe("running");
    expect(s[0]?.hint).toMatch(/scénář nezná/);
    stop();
  });
});

const created = (events: SourceEvent[]) =>
  events.flatMap((e) =>
    e.type === "a2ui" && "createSurface" in e.message ? [e.message.createSurface.surfaceId] : [],
  );
const COMPANY = { industry: "obuv", size: "4 prodejny", actors: [], keyProcesses: [] };
const STORY = { storyPoints: [], curves: [], expectations: [] };

describe("live source: reload keeps the timeline (user: refresh lost the timer, error landed on top)", () => {
  it("cards that need a fetch keep their place: Firma before the generation card, error card last", async () => {
    const { es, events, stop } = start(
      { status: "awaiting_refinement", datasets: [], error: "Scenario does not compile:\n- a\n- b" },
      { "01_company": COMPANY, "04_story": STORY },
    );
    es.push({ type: "status", status: "drafting" }, 1);
    es.push({ type: "cascade", event: { type: "step.started", step: "01_company" } }, 2);
    es.push({ type: "cascade", event: { type: "step.done", step: "01_company", cached: false } }, 3);
    es.push({ type: "status", status: "generating" }, 4);
    es.push({ type: "error", message: "Scenario does not compile:\n- a\n- b" }, 5);
    es.push({ type: "status", status: "awaiting_refinement" }, 6);
    await vi.waitFor(() => {
      expect(created(events)).toEqual(["progress-1", "company", "progress-2", "story", "recover-1"]);
    });
    stop();
  });

  it("a running step's timer starts at the server time of its event, not at the reload", () => {
    const { es, events, stop } = start();
    const at = Date.now() - 95_000;
    es.push({ type: "status", status: "generating", at }, 1);
    return vi
      .waitFor(() => {
        const s = steps(events, "progress-1") as { startedAt?: number }[];
        expect(s[0]?.startedAt).toBe(at);
      })
      .finally(stop);
  });

  it("a failed generation offers Zkusit znovu (resume) in plain Czech; a later run locks the card", async () => {
    const { source, es, events, requests, stop } = start({
      status: "awaiting_refinement",
      datasets: [],
      error: "x",
    });
    es.push({ type: "status", status: "generating" }, 1);
    es.push({ type: "error", message: "Scenario does not compile:\n- storyPoints[3].entity: x\n- y" }, 2);
    es.push({ type: "status", status: "awaiting_refinement" }, 3);
    await vi.waitFor(() => {
      expect(created(events)).toContain("recover-1");
    });
    const card = events.find(
      (e) =>
        e.type === "a2ui" &&
        "createSurface" in e.message &&
        e.message.createSurface.surfaceId === "recover-1",
    );
    const json = JSON.stringify(card);
    expect(json).toContain("Zkusit znovu");
    expect(json).not.toContain("does not compile");
    expect(events.some((e) => e.type === "say" && e.text.includes("does not compile"))).toBe(false);
    source.send({
      kind: "action",
      action: {
        name: "resume",
        surfaceId: "recover-1",
        sourceComponentId: "go",
        timestamp: "",
        context: { surfaceId: "recover-1" },
      },
    });
    await vi.waitFor(() => {
      expect(requests.some((r) => (r.body as { type?: string } | undefined)?.type === "resume")).toBe(true);
    });
    es.push({ type: "status", status: "generating" }, 4);
    await vi.waitFor(() => {
      expect(
        events.some(
          (e) =>
            e.type === "a2ui" &&
            "updateDataModel" in e.message &&
            e.message.updateDataModel.surfaceId === "recover-1" &&
            e.message.updateDataModel.value === true,
        ),
      ).toBe(true);
    });
    stop();
  });
});

describe("live source: a dataset whose hypotheses do not all hold", () => {
  it("says how many fail and where to look", async () => {
    const evidence = {
      expectations: [
        { id: "e1", description: "a", pass: true, before: 1, after: 2, relChange: 1 },
        { id: "e2", description: "b", pass: false, before: 1, after: 1, relChange: 0 },
      ],
      series: [],
    };
    const { es, events, stop } = start(
      { status: "ready", datasets: [{ id: "dat1", parent: null, seed: 42, origin: "approve" }] },
      { "04_story": { storyPoints: [], curves: [], expectations: [] } },
      {
        "/evidence": evidence,
        "/tables": { tables: [] },
        "/scenario": { scenario: null },
        "/labels": { labels: {} },
      },
    );
    es.push({ type: "dataset.ready", datasetId: "dat1" }, 1);
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "say" && e.text.includes("1 hypotéza v nich neplatí (z 2)"))).toBe(
        true,
      );
    });
    stop();
  });
});

describe("live source: a rejected approve (run-6 follow-up)", () => {
  const story = {
    storyPoints: [],
    curves: [],
    expectations: [
      {
        id: "e1",
        storyPointId: "sp1",
        description: "a",
        sql: "SELECT 1",
        check: { kind: "increase", minRelChange: 0.1 },
      },
    ],
  };
  const lockValues = (events: SourceEvent[]) =>
    events.flatMap((e) =>
      e.type === "a2ui" &&
      "updateDataModel" in e.message &&
      e.message.updateDataModel.surfaceId === "story" &&
      e.message.updateDataModel.path === "/locked"
        ? [e.message.updateDataModel.value]
        : [],
    );
  const approve = (context: Record<string, unknown>) => ({
    kind: "action" as const,
    action: { name: "approve", surfaceId: "story", sourceComponentId: "generate", timestamp: "", context },
  });

  it("all hypotheses off: says so in Czech and sends no approve", async () => {
    const { source, es, events, requests, stop } = start(
      { status: "awaiting_refinement", datasets: [] },
      {
        "04_story": story,
      },
    );
    es.push({ type: "status", status: "awaiting_refinement" }, 1);
    await vi.waitFor(() => {
      expect(created(events)).toContain("story");
    });
    source.send(approve({ expectations: [{ id: "e1", description: "a", enabled: false }] }));
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "say" && e.text.includes("aspoň jednu"))).toBe(true);
    });
    expect(requests.some((r) => (r.body as { type?: string } | undefined)?.type === "approve")).toBe(false);
    expect(lockValues(events).at(-1) ?? false).toBe(false);
    stop();
  });

  it("an approve the API rejects unlocks the editor again and says why", async () => {
    const { source, es, events, stop } = start(
      { status: "awaiting_refinement", datasets: [] },
      { "04_story": story },
      { "/commands": { errors: [{ path: "settings.period", message: "Období musí obsahovat příběh." }] } },
      422,
    );
    es.push({ type: "status", status: "awaiting_refinement" }, 1);
    await vi.waitFor(() => {
      expect(created(events)).toContain("story");
    });
    source.send(approve({ expectations: [{ id: "e1", description: "a", enabled: true }] }));
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "say" && e.text.includes("Období musí obsahovat příběh"))).toBe(
        true,
      );
      expect(lockValues(events)).toEqual([true, false]);
    });
    stop();
  });
});

describe("live source: a step that gave up (run 7 review)", () => {
  it("says it failed after N attempts, not that the agent is still repairing", async () => {
    const { es, events, stop } = start({ status: "failed", datasets: [] });
    es.push({ type: "status", status: "drafting" }, 1);
    es.push({ type: "cascade", event: { type: "step.started", step: "04_story" } }, 2);
    for (const n of [1, 2, 3])
      es.push(
        {
          type: "cascade",
          event: { type: "loop.iteration", step: "04_story", n, ok: false, feedback: ["x"] },
        },
        2 + n,
      );
    es.push({ type: "error", message: "LLM output for 04_story failed validation" }, 6);
    es.push({ type: "status", status: "failed" }, 7);
    await vi.waitFor(() => {
      const story = steps(events, "progress-1").find((s) => s.id === "04_story") as
        { state: string; detail?: string } | undefined;
      expect(story?.state).toBe("failed");
      expect(story?.detail).toBe("selhalo po 3 pokusech");
    });
    stop();
  });
});

describe("live source: edit the curves of a finished dataset (user: the chart stayed locked)", () => {
  const story = {
    storyPoints: [{ id: "sp1", phase: 1, title: "Zpoždění", description: "", start: "2026-03-02" }],
    curves: [
      {
        id: "late_prob",
        baseline: 0.05,
        segments: [{ kind: "ramp", start: "2026-03-02", to: 0.4, storyPointId: "sp1" }],
      },
    ],
    expectations: [{ id: "e1", description: "a" }],
  };
  // the dataset's own scenario: a what-if moved the curve, and it carries what 04_story does not
  const scenario = {
    ...story,
    meta: { start: "2026-01-01", end: "2026-06-30", seed: 42 },
    processes: [{ id: "orders" }],
    curves: [
      {
        id: "late_prob",
        baseline: 0.05,
        segments: [{ kind: "ramp", start: "2026-03-02", to: 0.3, storyPointId: "sp1" }],
      },
    ],
  };
  const ready = { status: "ready", datasets: [{ id: "dat1", parent: null, seed: 42, origin: "approve" }] };
  const routes = {
    "/evidence": { expectations: [], series: [] },
    "/tables": { tables: [] },
    "/scenario": { scenario },
    "/labels": { labels: {} },
  };
  const send = (name: string, context: Record<string, unknown>) => ({
    kind: "action" as const,
    action: { name, surfaceId: "x", sourceComponentId: "b", timestamp: "", context },
  });
  const storyData = (events: SourceEvent[], key: string) =>
    events.flatMap((e) =>
      e.type === "a2ui" &&
      "updateDataModel" in e.message &&
      e.message.updateDataModel.surfaceId === "story" &&
      e.message.updateDataModel.path === "/"
        ? [(e.message.updateDataModel.value as Record<string, unknown>)[key]]
        : [],
    );
  const commands = (requests: { url: string; body?: unknown }[]) =>
    requests.flatMap((r) =>
      r.url.endsWith("/commands") ? [r.body as { type: string } & Record<string, unknown>] : [],
    );

  async function finished() {
    const s = start(ready, { "04_story": story }, routes);
    s.es.push({ type: "status", status: "awaiting_refinement" }, 1);
    await vi.waitFor(() => {
      expect(created(s.events)).toContain("story");
    });
    s.es.push({ type: "status", status: "generating" }, 2);
    s.es.push({ type: "dataset.ready", datasetId: "dat1" }, 3);
    s.es.push({ type: "status", status: "ready" }, 4);
    await vi.waitFor(() => {
      expect(created(s.events)).toContain("ready-dat1");
    });
    return s;
  }

  it("the ready card offers Upravit křivky, which opens the story editor for that dataset", async () => {
    const { events, stop } = await finished();
    const card = events.find(
      (e) =>
        e.type === "a2ui" &&
        "createSurface" in e.message &&
        e.message.createSurface.surfaceId === "ready-dat1",
    );
    expect(JSON.stringify(card)).toContain('"label":"Upravit křivky"');
    expect(JSON.stringify(card)).toContain('"context":{"surfaceId":"story","regenFrom":"dat1"}');
    stop();
  });

  it("unlocks the editor with the dataset's curves; Generovat data sends edit_scenario from it", async () => {
    const { source, events, requests, stop } = await finished();
    source.send(send("open_canvas", { surfaceId: "story", regenFrom: "dat1" }));
    await vi.waitFor(() => {
      expect(storyData(events, "locked").at(-1)).toBe(false);
    });
    const points = storyData(events, "points").at(-1) as { id: string; level: number }[];
    expect(points[0]).toMatchObject({ id: "sp1", level: 0.3 }); // the dataset's value, not 04_story's 0.4
    const pt = points[0];
    if (!pt) throw new Error("no point");
    source.send(
      send("approve", {
        points: [{ ...pt, level: 0.6 }],
        config: { curve: { baseline: 0.05 } },
        expectations: [{ id: "e1", description: "a", enabled: true }],
      }),
    );
    await vi.waitFor(() => {
      expect(commands(requests).map((c) => c.type)).toContain("edit_scenario");
    });
    const cmd = commands(requests).find((c) => c.type === "edit_scenario") as unknown as {
      from: string;
      scenario: typeof scenario;
    };
    expect(cmd.from).toBe("dat1");
    expect(cmd.scenario.curves[0]?.segments[0]?.to).toBe(0.6);
    // everything else of the dataset's scenario goes back as it was
    expect(cmd.scenario.meta).toEqual(scenario.meta);
    expect(cmd.scenario.processes).toEqual(scenario.processes);
    expect(commands(requests).some((c) => c.type === "approve")).toBe(false);
    stop();
  });

  it("Generovat data without a change sends nothing and says so", async () => {
    const { source, events, requests, stop } = await finished();
    source.send(send("open_canvas", { surfaceId: "story", regenFrom: "dat1" }));
    await vi.waitFor(() => {
      expect(storyData(events, "locked").at(-1)).toBe(false);
    });
    const points = storyData(events, "points").at(-1);
    source.send(send("approve", { points, config: { curve: { baseline: 0.05 } }, expectations: [] }));
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "say" && e.text.includes("nezměnil"))).toBe(true);
    });
    expect(commands(requests).filter((c) => c.type !== "cancel")).toEqual([]);
    stop();
  });
});
