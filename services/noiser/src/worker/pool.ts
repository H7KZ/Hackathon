/**
 * The engine off the main thread. One lazily started `worker_threads` worker runs `generate`
 * (compile + engine) for every request, so an API process keeps answering HTTP and SSE while a large
 * scenario generates (live run 3: 1–10 s, 409 097 rows). Same code, same seed → same tables as the
 * in-process call. The worker is unref'd: it never keeps a CLI or test process alive.
 */
import { Worker } from "node:worker_threads";
import type { RunResult } from "@s2d/schema/run";
import type { Scenario } from "@s2d/schema/scenario";
import { EngineError } from "../engine/errors";
import type { RunOptions } from "../engine/run";
import type { GenerateResult } from "../generate";

type Reply =
  | { ready: true }
  | { id: number; ok: true; result: GenerateResult }
  | { id: number; ok: false; name: string; message: string; stack?: string };

interface Pending {
  resolve: (r: GenerateResult) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(err: Error): void {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
  worker = null;
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./engine.worker.mjs", import.meta.url));
  w.unref();
  w.on("message", (msg: Reply) => {
    if ("ready" in msg) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (pending.size === 0) w.unref();
    if (msg.ok) p.resolve(msg.result);
    else p.reject(Object.assign(new Error(msg.message), { name: msg.name, stack: msg.stack }));
  });
  w.on("error", (err) => {
    failAll(err);
  });
  w.on("exit", (code) => {
    if (worker === w) failAll(new Error(`Engine worker exited with code ${code}.`));
  });
  worker = w;
  return w;
}

/** `generate` in the worker: compiles and runs; compiler and engine errors come back as `{ok:false}`. */
export function generateInWorker(input: unknown, opts: RunOptions = {}): Promise<GenerateResult> {
  const w = getWorker();
  const id = nextId++;
  // Keep the process alive only while a request is in flight.
  w.ref();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, input, opts });
  });
}

/** `runScenario` in the worker for an already compiled scenario; throws `EngineError` like the sync call. */
export async function runScenarioInWorker(scenario: Scenario, opts: RunOptions = {}): Promise<RunResult> {
  const res = await generateInWorker(scenario, opts);
  if (res.ok) return res.run;
  const first = res.errors[0];
  throw new EngineError(first?.path ?? "", res.errors.map((e) => e.message).join("; "));
}

/** Stops the worker (tests, graceful shutdown). The next call starts a new one. */
export async function stopEngineWorker(): Promise<void> {
  const w = worker;
  worker = null;
  failAll(new Error("Engine worker stopped."));
  if (w) await w.terminate();
}
