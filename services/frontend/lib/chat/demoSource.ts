/**
 * Demo mode (`/chat?demo=<case>`): a session recorded by `pnpm demo:record` (docs/demo-data.md),
 * replayed through the same presenter as a live session. No API and no LLM: the bundles are static
 * files in public/demo.
 */
import type { SessionInput } from "@s2d/schema/api";
import type { DemoBundle, DemoIndexEntry } from "@s2d/schema/demo";
import { createDemoTransport } from "./demoTransport";
import { createLiveSource } from "./liveSource";
import type { ChatSource } from "./types";

export const DEMO_DIR = "/demo";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
  return (await res.json()) as T;
}

let index: Promise<DemoIndexEntry[]> | null = null;
/** The picker's list (public/demo/index.json), fetched once per page. */
export function loadDemoIndex(): Promise<DemoIndexEntry[]> {
  index ??= getJson<{ cases: DemoIndexEntry[] }>(`${DEMO_DIR}/index.json`).then((r) => r.cases);
  index.catch(() => (index = null));
  return index;
}

const bundles = new Map<string, Promise<DemoBundle>>();
export function loadDemoBundle(id: string): Promise<DemoBundle> {
  if (!/^[a-z][a-z0-9_]*$/.test(id)) return Promise.reject(new Error(`Neznámá ukázka „${id}“`));
  let p = bundles.get(id);
  if (!p) {
    // a static file of our own: checked for being the right case, not parsed with zod (keeps zod out of the page)
    p = getJson<Partial<DemoBundle>>(`${DEMO_DIR}/${id}.json`).then((b) => {
      if (b.id !== id || !Array.isArray(b.draft)) throw new Error("neplatný soubor ukázky");
      return b as DemoBundle;
    });
    p.catch(() => bundles.delete(id));
    bundles.set(id, p);
  }
  return p;
}

const words = (s: string) =>
  new Set(
    s
      .toLocaleLowerCase("cs-CZ")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 3),
  );

/** The case closest to what was typed on the landing page in demo mode (most shared words; ties: first). */
export function pickCase(cases: readonly DemoIndexEntry[], input: SessionInput): DemoIndexEntry | undefined {
  const typed = words(`${input.company} ${input.story}`);
  let best = cases[0];
  let score = 0;
  for (const c of cases) {
    const own = words(`${c.title} ${c.summary} ${c.tags.join(" ")} ${c.input.company} ${c.input.story}`);
    const n = [...typed].filter((w) => own.has(w)).length;
    if (n > score) {
      best = c;
      score = n;
    }
  }
  return best;
}

/** A recorded session as a chat source (speed < 1 replays faster; tests use 0). */
export function sourceFromBundle(bundle: DemoBundle, { speed = 1 } = {}): ChatSource {
  return createLiveSource(`demo-${bundle.id}`, {
    transport: createDemoTransport(bundle, { speed }),
    demo: true,
    suggestions: bundle.suggestions,
    exports: Object.fromEntries(Object.entries(bundle.exports).map(([d, files]) => [d, Object.keys(files)])),
  });
}

/** Loads the case on start (the chat frame shows right away) and then replays it. */
export function createDemoSource(
  caseId: string,
  {
    speed = 1,
    load = loadDemoBundle,
    note,
  }: {
    speed?: number;
    load?: (id: string) => Promise<DemoBundle>;
    /** agent line shown before the replay (e.g. why this case was picked) */
    note?: string;
  } = {},
): ChatSource {
  let inner: ChatSource | null = null;
  return {
    demo: true,
    start(emit) {
      let stopped = false;
      let stopInner: (() => void) | undefined;
      emit({ type: "busy", step: "Načítám ukázku" });
      load(caseId)
        .then((bundle) => {
          if (stopped) return;
          if (note) emit({ type: "say", role: "agent", text: note });
          emit({ type: "say", role: "user", text: `**${bundle.input.company}**\n${bundle.input.story}` });
          inner = sourceFromBundle(bundle, { speed });
          stopInner = inner.start(emit);
        })
        .catch((err: unknown) => {
          if (stopped) return;
          emit({ type: "busy", step: null });
          emit({
            type: "say",
            role: "agent",
            text: `Ukázku se nepodařilo načíst (${err instanceof Error ? err.message : String(err)}). Vyberte jinou přes „Ukázky s demo daty“ v postranním panelu.`,
          });
        });
      return () => {
        stopped = true;
        stopInner?.();
      };
    },
    send(input) {
      inner?.send(input);
    },
  };
}
