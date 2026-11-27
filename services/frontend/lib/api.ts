/**
 * REST client for services/api: plain fetch, typed with the shared contract (@s2d/schema).
 * Only TYPE imports from the backend, so none of its code reaches the bundle.
 */
import type { SessionInput } from "@s2d/api";
import type { Health } from "@s2d/schema/api";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const OVERRIDE_KEY = "jojo.api";

/**
 * Only a local http(s) API may be chosen at runtime: a crafted `?api=` link must never be able to
 * send a user's stories to someone else's server. Returns the normalized origin or null.
 */
export function localOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return local && (u.protocol === "http:" || u.protocol === "https:") ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * API base URL. Dev-only override without a rebuild: `?api=http://localhost:4100` (localhost only,
 * remembered in localStorage; `?api=` clears it). Production builds always use NEXT_PUBLIC_API_URL.
 */
export function apiUrl(): string {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") return API_URL;
  try {
    const param = new URLSearchParams(window.location.search).get("api");
    if (param !== null) {
      const origin = localOrigin(param);
      if (origin) localStorage.setItem(OVERRIDE_KEY, origin);
      else localStorage.removeItem(OVERRIDE_KEY);
    }
    // re-validated on every read, so a value planted in storage some other way is ignored too
    return localOrigin(localStorage.getItem(OVERRIDE_KEY)) ?? API_URL;
  } catch {
    return API_URL;
  }
}

export async function getHealth(): Promise<Health> {
  const res = await fetch(`${apiUrl()}/health`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Health;
}

export type CreateResult =
  { ok: true; sessionId: string } | { ok: false; message: string; field?: keyof SessionInput };

/** POST /sessions (docs/api-orchestrator.md). Failures come back as a Czech message for the form. */
export async function createSession(input: SessionInput): Promise<CreateResult> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, message: "API je nedostupné. Zkontrolujte, že běží, a zkuste to znovu." };
  }
  const body = (await res.json().catch(() => null)) as {
    sessionId?: unknown;
    errors?: { path: string; message: string }[];
  } | null;
  if (res.status === 201 && typeof body?.sessionId === "string") {
    return { ok: true, sessionId: body.sessionId };
  }
  const error = body?.errors?.[0];
  if (!error) return { ok: false, message: `Odeslání se nezdařilo (HTTP ${res.status}).` };
  const field = error.path === "company" || error.path === "story" ? error.path : undefined;
  return { ok: false, message: error.message, ...(field && { field }) };
}
