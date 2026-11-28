/**
 * Demo transport: replays a session recorded by `pnpm demo:record` (docs/demo-data.md) as if it came
 * from the API. Events are paced like a short real run, GETs are answered from the recording, and a
 * command plays the events that command produced when it was recorded. Only what was recorded can
 * be asked: other what-if questions are refused with the list of the prepared ones.
 */
import type { SessionCommand, SessionEvent, SessionState, SessionStatus } from "@s2d/schema/api";
import type { DemoBundle } from "@s2d/schema/demo";
import type { Transport, TransportResponse } from "./transport";

type Recorded = DemoBundle["draft"][number];

/** Pause before an event (ms at speed 1): long enough to follow, short enough to keep the demo moving. */
export function eventDelay(e: Recorded): number {
  switch (e.type) {
    case "status":
      return 250;
    case "dataset.ready":
      return 1800;
    case "detective.done":
      return 2600;
    case "error":
      return 200;
    case "cascade": {
      const c = e.event;
      if (c.type === "step.started") return 250;
      if (c.type === "step.done") return c.cached ? 40 : 1100;
      if (c.type === "loop.iteration") return 900;
      return 150;
    }
  }
}

const norm = (s: string) =>
  s
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[?!.]+$/, "")
    .toLowerCase();

const reply = (status: number, body: unknown): TransportResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});
const rejected = (message: string, path = "") => reply(422, { ok: false, errors: [{ path, message }] });

const quoteList = (xs: string[]) => xs.map((x) => `„${x}“`).join(", ");

export function createDemoTransport(
  bundle: DemoBundle,
  { speed = 1, sessionId = `demo-${bundle.id}` }: { speed?: number; sessionId?: string } = {},
): Transport & { readonly busy: boolean } {
  const base = `/sessions/${sessionId}`;
  let listener: ((data: string) => void) | null = null;
  let status: SessionStatus = "drafting";
  let seq = 0;
  const revealed = new Set<string>();
  const played = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let queue = 0;

  /** Plays `events` one after another; the transport is busy until the last one is out. */
  function play(events: readonly Recorded[]) {
    let at = 0;
    queue++;
    events.forEach((e, i) => {
      at += eventDelay(e) * speed;
      const t = setTimeout(() => {
        timers.delete(t);
        if (e.type === "status") status = e.status;
        if (e.type === "dataset.ready") revealed.add(e.datasetId);
        const out: SessionEvent = { ...e, seq: ++seq, at: Date.now() };
        listener?.(JSON.stringify(out));
        if (i === events.length - 1) queue--;
      }, at);
      timers.add(t);
    });
    if (events.length === 0) queue--;
  }

  const state = (): SessionState => ({
    id: sessionId,
    status,
    input: bundle.input,
    datasets: bundle.datasets.filter((d) => revealed.has(d.id)),
  });

  function respond(path: string): unknown {
    if (!path.startsWith(base)) return undefined;
    const rest = path.slice(base.length);
    if (rest === "") return state();
    const [route = "", query = ""] = rest.split("?");
    const params = new URLSearchParams(query);
    if (route === "/labels") {
      const d = params.get("dataset");
      return (d && bundle.responses[`/labels?dataset=${d}`]) ?? bundle.responses["/labels"];
    }
    const found = bundle.responses[route];
    const limit = Number(params.get("limit"));
    if (found && /^\/datasets\/[^/]+\/tables\/[^/]+$/.test(route) && limit > 0) {
      const preview = found as { rowsShown: unknown[] };
      return { ...preview, rowsShown: preview.rowsShown.slice(0, limit) };
    }
    return found;
  }

  function command(cmd: SessionCommand): TransportResponse {
    if (queue > 0 && cmd.type !== "cancel") return reply(409, { error: "busy" });
    switch (cmd.type) {
      case "approve":
        if (played.has("approve")) return rejected("Data z ukázky už jsou vygenerovaná.");
        played.add("approve");
        play(bundle.approve);
        return reply(202, { ok: true, seq });
      case "what_if": {
        const w = bundle.whatIfs.find((x) => norm(x.question) === norm(cmd.question));
        if (!w)
          return rejected(
            `V ukázce jsou připravené jen otázky ${quoteList(bundle.suggestions)}. Vlastní otázku zodpoví živý režim s jazykovým modelem.`,
            "question",
          );
        if (played.has(w.datasetId))
          return rejected(`Tahle varianta už je hotová jako ${w.datasetId}.`, "question");
        played.add(w.datasetId);
        play(w.events);
        return reply(202, { ok: true, seq });
      }
      case "detect": {
        const d = bundle.detect.find((x) => x.datasetId === cmd.datasetId);
        if (!d)
          return rejected(
            `V ukázce je detektiv připravený pro ${bundle.detect.map((x) => x.datasetId).join(", ")}.`,
            "datasetId",
          );
        play(d.events);
        return reply(202, { ok: true, seq });
      }
      case "cancel":
        return reply(202, { ok: true, seq });
      default:
        return rejected("V ukázce tenhle krok není. Vyzkoušejte ho v živém režimu.");
    }
  }

  return {
    where: "ukázka",
    get busy() {
      return queue > 0;
    },
    getJson<T>(path: string): Promise<T> {
      const found = respond(path);
      return found === undefined
        ? Promise.reject(new Error(`GET ${path}: HTTP 404`))
        : Promise.resolve(structuredClone(found) as T);
    },
    send(method, path, body) {
      if (method === "POST" && path === `${base}/commands`)
        return Promise.resolve(command(body as SessionCommand));
      return Promise.resolve(rejected("V ukázce je příběh pevný: data k němu už vygeneroval engine."));
    },
    events(path, onMessage) {
      listener = onMessage;
      // every connection (a remount, React StrictMode) starts the recorded session over
      for (const t of timers) clearTimeout(t);
      timers.clear();
      queue = 0;
      seq = 0;
      status = "drafting";
      revealed.clear();
      played.clear();
      if (path === `${base}/events`) play(bundle.draft);
      return () => {
        listener = null;
        for (const t of timers) clearTimeout(t);
        timers.clear();
        queue = 0;
      };
    },
    download(path) {
      const m = /\/datasets\/([^/]+)\/export\?format=(\w+)/.exec(path);
      const file = m ? bundle.exports[m[1] ?? ""]?.[m[2] ?? ""] : undefined;
      if (file && typeof window !== "undefined") window.location.assign(file);
    },
  };
}
