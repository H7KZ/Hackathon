// Worker entry for the engine (services/noiser/src/worker/pool.ts). Plain JS so Node can start it
// without a TypeScript loader. It always registers the tsx ESM hook: the parent's loader is not
// inherited (tsx CLI passes only its CJS preflight; vitest passes none). One message in = one
// `generate` = one message out.
import { parentPort } from "node:worker_threads";

const { register } = await import("tsx/esm/api");
register();
const { generate } = await import("../generate.ts");

parentPort.on("message", ({ id, input, opts }) => {
  try {
    parentPort.postMessage({ id, ok: true, result: generate(input, opts) });
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    parentPort.postMessage({ id, ok: false, name: e.name, message: e.message, stack: e.stack });
  }
});
parentPort.postMessage({ ready: true });
