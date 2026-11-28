/** The engine in a worker thread gives the same tables as the in-process call (golden hashes hold). */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { GeneratedTable } from "@s2d/schema/run";
import type { Scenario } from "@s2d/schema/scenario";
import { loadScenarioFixture } from "@s2d/test-utils";
import { EngineError, compileScenario, generate } from "../../src/index";
import { generateInWorker, runScenarioInWorker, stopEngineWorker } from "../../src/worker/pool";

const GOLDEN = JSON.parse(
  readFileSync(join(import.meta.dirname, "../golden/supplier_delay.hashes.json"), "utf8"),
) as Record<string, string>;

function hashes(tables: readonly GeneratedTable[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [...new Set(tables.map((t) => t.name))].sort()) {
    const rows = tables.filter((t) => t.name === name).flatMap((t) => t.rows);
    out[name] = createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
  }
  return out;
}

afterAll(() => stopEngineWorker());

describe("engine worker", () => {
  it("generateInWorker matches the golden hashes and the in-process run", async () => {
    const raw = loadScenarioFixture("supplier_delay");
    const res = await generateInWorker(raw, { seed: 42 });
    if (!res.ok) throw new Error(JSON.stringify(res.errors));
    const local = generate(raw, { seed: 42 });
    if (!local.ok) throw new Error("local run failed");
    expect(hashes(res.run.tables)).toEqual(hashes(local.run.tables));
    for (const [name, h] of Object.entries(GOLDEN)) expect(hashes(res.run.tables)[name], name).toBe(h);
    expect(res.run.meta).toEqual(local.run.meta);
  });

  it("serves concurrent requests in order of their ids", async () => {
    const raw = loadScenarioFixture("supplier_delay");
    const [a, b] = await Promise.all([
      generateInWorker(raw, { seed: 1 }),
      generateInWorker(raw, { seed: 2 }),
    ]);
    expect(a.ok && a.run.meta.seed).toBe(1);
    expect(b.ok && b.run.meta.seed).toBe(2);
  });

  it("returns compile errors as data and engine errors as EngineError", async () => {
    const bad = await generateInWorker({ nope: true });
    expect(bad.ok).toBe(false);
    const compiled = compileScenario(loadScenarioFixture("supplier_delay"));
    if (!compiled.ok) throw new Error("fixture does not compile");
    const s: Scenario = { ...compiled.scenario, processes: [] };
    await expect(runScenarioInWorker(s)).rejects.toBeInstanceOf(EngineError);
  });
});
