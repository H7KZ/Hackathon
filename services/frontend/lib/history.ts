/** Chat history in localStorage (the API has no session list). Newest first, max 20. */

export type HistoryEntry = {
  id: string;
  company: string;
  story: string;
  createdAt: string;
  demo: boolean;
  /** which recorded demo case it replays (public/demo/<case>.json) */
  demoCase?: string;
};

const KEY = "jojo.sessions";
const MAX = 20;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadHistory(): HistoryEntry[] {
  const raw = storage()?.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]).filter((e) => typeof e.id === "string") : [];
  } catch {
    return [];
  }
}

export function remember(entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...loadHistory().filter((e) => e.id !== entry.id)].slice(0, MAX);
  storage()?.setItem(KEY, JSON.stringify(next));
  return next;
}

export function findEntry(id: string): HistoryEntry | undefined {
  return loadHistory().find((e) => e.id === id);
}

/** URL of a chat: demo sessions replay their recorded case, real ones reconnect to the API. */
export const chatHref = (e: Pick<HistoryEntry, "id" | "demo" | "demoCase">) =>
  e.demo
    ? `/chat?demo=${encodeURIComponent(e.demoCase ?? "1")}&s=${encodeURIComponent(e.id)}`
    : `/chat?s=${encodeURIComponent(e.id)}`;
