import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "@s2d/schema/api";
import { createLiveSource } from "../../lib/chat/liveSource";
import type { SourceEvent } from "../../lib/chat/types";

type NewEvent = SessionEvent extends infer E ? (E extends SessionEvent ? Omit<E, "seq"> : never) : never;

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

function start(state: Record<string, unknown> = { status: "ready", datasets: [] }) {
  vi.stubGlobal("EventSource", FakeEventSource);
  const requests: { url: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const raw = typeof init?.body === "string" ? init.body : undefined;
      requests.push({ url, ...(raw ? { body: JSON.parse(raw) as unknown } : {}) });
      const body = url.endsWith("/commands")
        ? { ok: true, seq: 1 }
        : url.includes("/artifacts/")
          ? { value: {} }
          : state;
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: url.endsWith("/commands") ? 202 : 200 }),
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
  it("the generation card lists only its own steps, not the cached A1–A4 replay", () => {
    const { es, events, stop } = start();
    es.push({ type: "status", status: "generating" }, 1);
    for (const step of ["01_company", "02_model", "03_influences", "04_story"] as const) {
      es.push({ type: "cascade", event: { type: "step.started", step } }, 2);
      es.push({ type: "cascade", event: { type: "step.done", step, cached: true } }, 3);
    }
    es.push({ type: "cascade", event: { type: "step.started", step: "05_scenario" } }, 4);
    expect(steps(events, "progress-1").map((s) => s.id)).toEqual(["05_scenario", "engine", "evidence"]);
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
    expect(events.some((e) => e.type === "say" && e.text.includes("živý jazykový model"))).toBe(true);
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
  it("a running step gets a start time and a plain-words hint; a failed attempt names the next try", () => {
    const { es, events, stop } = start();
    es.push({ type: "status", status: "generating" }, 1);
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
    s = steps(events, "progress-1");
    expect(s[0]).toMatchObject({
      state: "running",
      detail: "pokus 1: agent opravuje 1 chybu ve scénáři",
      attempt: { n: 2, max: 5 },
    });
    stop();
  });

  it("the detective card runs (timer + what the detective does) as soon as detecting starts", () => {
    const { es, events, stop } = start();
    es.push({ type: "status", status: "detecting" }, 1);
    const s = steps(events, "progress-1") as { state: string; hint?: string }[];
    expect(s[0]?.state).toBe("running");
    expect(s[0]?.hint).toMatch(/scénář nezná/);
    stop();
  });
});
