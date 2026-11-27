/**
 * Shared test helpers. Never import from src/ of any workspace (enforced by dependency-cruiser).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Raw (unparsed) JSON of scenarios/<id>.json — a fresh copy each call, safe to mutate. */
export function loadScenarioFixture(id: string): unknown {
  return JSON.parse(readFileSync(join(REPO_ROOT, "scenarios", `${id}.json`), "utf8"));
}

/** Temporary directory removed by the returned cleanup function. */
export function makeTempDir(prefix = "s2d-"): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface FakeLlmCall {
  schemaName: string;
  prompt: string;
}

/**
 * Fake structured-output generator: returns queued responses in order and records calls.
 * Matches the `Generate` signature of @s2d/llm without importing it.
 */
export function fakeGenerate(responses: unknown[]) {
  const calls: FakeLlmCall[] = [];
  const queue = [...responses];
  const generate = (req: { schemaName: string; prompt: string }): Promise<unknown> => {
    calls.push({ schemaName: req.schemaName, prompt: req.prompt });
    if (queue.length === 0)
      return Promise.reject(new Error(`fakeGenerate: no response queued for ${req.schemaName}`));
    return Promise.resolve(queue.shift());
  };
  return { generate, calls };
}
