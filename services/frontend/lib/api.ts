/**
 * REST client for services/api: plain fetch, typed with the shared contract (@s2d/schema).
 * Only TYPE imports from the backend, so none of its code reaches the bundle.
 */
import type { SessionInput } from "@s2d/api";
import type { Health } from "@s2d/schema/api";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function getHealth(): Promise<Health> {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Health;
}

export type CreateResult =
  { ok: true; sessionId: string } | { ok: false; message: string; field?: keyof SessionInput };

/** POST /sessions (docs/api-orchestrator.md). Failures come back as a Czech message for the form. */
export async function createSession(input: SessionInput): Promise<CreateResult> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/sessions`, {
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
