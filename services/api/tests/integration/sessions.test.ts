import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testClient } from "hono/testing";
import { REPO_ROOT, makeTempDir } from "@s2d/test-utils";
import { createApp } from "../../src/app";
import { loadConfig } from "../../src/config";
import { createOrchestrator, type Orchestrator } from "../../src/orchestrator";
import { fakePorts } from "../support/fakePorts";

const PROMPT = { story: "Dodavatel začal dodávat pozdě.", company: "Síť 5 prodejen." };

let tmp: ReturnType<typeof makeTempDir>;
beforeEach(() => {
  tmp = makeTempDir("s2d-routes-");
});
afterEach(() => {
  tmp.cleanup();
});

function setup(opts: Parameters<typeof fakePorts>[0] = {}) {
  const orch: Orchestrator = createOrchestrator({ ports: fakePorts(opts).ports, runsDir: tmp.dir });
  const app = createApp(loadConfig({}, REPO_ROOT), { orchestrator: orch });
  return { orch, app, client: testClient(app) };
}

async function create(client: ReturnType<typeof setup>["client"], orch: Orchestrator) {
  const res = await client.sessions.$post({ json: PROMPT });
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`);
  const { sessionId } = await res.json();
  await orch.idle(sessionId);
  return sessionId;
}

/** Reads SSE frames until `until` matches, then closes the stream. */
async function readSse(res: Response, until: (frame: string) => boolean): Promise<string[]> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const frames: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    frames.push(...parts.filter((p) => p.includes("data:")));
    if (frames.some(until)) break;
  }
  await reader.cancel();
  return frames;
}

describe("sessions REST", () => {
  it("POST /sessions → draft → GET state and the 04_story timeline", async () => {
    const { client, orch } = setup();
    const id = await create(client, orch);
    const state = await (await client.sessions[":id"].$get({ param: { id } })).json();
    expect(state).toMatchObject({ id, status: "awaiting_refinement" });
    const art = await client.sessions[":id"].artifacts[":name"].$get({ param: { id, name: "04_story" } });
    expect(art.status).toBe(200);
  });

  it("POST /sessions rejects an empty prompt with 400", async () => {
    const { client } = setup();
    const res = await client.sessions.$post({ json: { story: "", company: "x" } });
    expect(res.status).toBe(400);
  });

  it("PUT an invalid artifact → 422 with {path,message}[]", async () => {
    const { client, orch } = setup();
    const id = await create(client, orch);
    const res = await client.sessions[":id"].artifacts[":name"].$put(
      { param: { id, name: "03_influences" } },
      {
        init: { body: JSON.stringify({ edges: [] }), headers: { "content-type": "application/json" } },
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { path: string; message: string }[] };
    expect(body.errors[0]).toEqual({ path: expect.any(String), message: expect.any(String) });
  });

  it("approve via /commands → 202, dataset evidence readable", async () => {
    const { client, orch } = setup();
    const id = await create(client, orch);
    const res = await client.sessions[":id"].commands.$post({ param: { id }, json: { type: "approve" } });
    expect(res.status).toBe(202);
    await orch.idle(id);
    const ev = await client.sessions[":id"].datasets[":d"].evidence.$get({ param: { id, d: "d1" } });
    expect(ev.status).toBe(200);
  });

  it("a command while busy → 409, cancel always accepted", async () => {
    let open!: () => void;
    const { client, orch } = setup({ gate: new Promise((r) => (open = r)) });
    const created = await client.sessions.$post({ json: PROMPT });
    if (created.status !== 201) throw new Error("create failed");
    const { sessionId: id } = await created.json();
    const busy = await client.sessions[":id"].commands.$post({ param: { id }, json: { type: "approve" } });
    expect(busy.status).toBe(409);
    const cancel = await client.sessions[":id"].commands.$post({ param: { id }, json: { type: "cancel" } });
    expect(cancel.status).toBe(202);
    open();
    await orch.idle(id);
  });

  it("unknown or unsafe ids → 404", async () => {
    const { client, app, orch } = setup();
    expect((await client.sessions[":id"].$get({ param: { id: "nope" } })).status).toBe(404);
    expect((await app.request("/sessions/..%2F..%2Fpackage")).status).toBe(404);
    const id = await create(client, orch);
    const res = await client.sessions[":id"].datasets[":d"].evidence.$get({ param: { id, d: "..%2Fx" } });
    expect(res.status).toBe(404);
  });

  it("GET /events replays after Last-Event-ID as SSE frames", async () => {
    const { client, orch, app } = setup();
    const id = await create(client, orch);
    const all = orch.events(id);
    const res = await app.request(`/sessions/${id}/events`, { headers: { "Last-Event-ID": "2" } });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const lastSeq = all.at(-1)?.seq ?? 0;
    const frames = await readSse(res, (f) => f.includes(`id: ${lastSeq}`));
    expect(frames[0]).toContain("id: 3");
    expect(frames).toHaveLength(all.length - 2);
  });

  it("GET /events streams live events after replay", async () => {
    const { client, orch, app } = setup();
    const id = await create(client, orch);
    const res = await app.request(`/sessions/${id}/events?after=${orch.events(id).at(-1)?.seq ?? 0}`);
    const reading = readSse(res, (f) => f.includes("dataset.ready"));
    orch.command(id, { type: "approve" });
    const frames = await reading;
    expect(frames.some((f) => f.includes('"type":"dataset.ready"'))).toBe(true);
    // unnamed events, so EventSource.onmessage receives them
    expect(frames.every((f) => !f.includes("event:"))).toBe(true);
    await orch.idle(id);
  });
});
