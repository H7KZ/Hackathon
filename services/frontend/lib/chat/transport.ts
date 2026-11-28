/**
 * How the live source talks to a session: the real API over HTTP + SSE, or a recorded demo session
 * replayed in the browser (demoTransport.ts). Paths are API paths ("/sessions/<id>/…").
 */
import { apiUrl } from "../api";

export interface TransportResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface Transport {
  getJson<T>(path: string): Promise<T>;
  /** Commands (POST) and artifact edits (PUT). Rejects only when the server cannot be reached. */
  send(method: "POST" | "PUT", path: string, body: unknown): Promise<TransportResponse>;
  /** Server-sent events: `onMessage` gets each event's JSON text. Returns a function that closes it. */
  events(path: string, onMessage: (data: string) => void, onError: () => void): () => void;
  /** Starts a file download (dataset export). */
  download(path: string): void;
  /** Where the transport connects, for error messages ("http://localhost:4000"). */
  readonly where: string;
}

export const httpTransport: Transport = {
  async getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${apiUrl()}${path}`);
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${String(res.status)}`);
    return (await res.json()) as T;
  },
  send: (method, path, body) =>
    fetch(`${apiUrl()}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  events(path, onMessage, onError) {
    const source = new EventSource(`${apiUrl()}${path}`);
    source.onmessage = (m: MessageEvent<string>) => {
      onMessage(m.data);
    };
    source.onerror = onError;
    return () => {
      source.close();
    };
  },
  download(path) {
    if (typeof window !== "undefined") window.location.assign(`${apiUrl()}${path}`);
  },
  get where() {
    return apiUrl();
  },
};
