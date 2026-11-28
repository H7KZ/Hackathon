/**
 * Golden tests for the demo scenarios (scenarios/demo/*.json → scenarios/<id>.json, docs/demo-data.md):
 * determinism, stream isolation, referential integrity by value and pinned table hashes at seed 42.
 * The recorded UI bundles were generated from exactly these tables, so a hash change means the demo
 * bundles must be re-recorded (`pnpm demo:record`). Regenerate: `UPDATE_GOLDEN=1 pnpm vitest run tests/golden`.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GeneratedTable, RunResult } from "@s2d/schema/run";
import { loadScenarioFixture } from "@s2d/test-utils";
import { generate } from "../../src/index";

const HASHES = join(import.meta.dirname, "demo_cases.hashes.json");

type Raw = {
  curves: { id: string; segments: { to: number }[] }[];
  processes: { id: string; table?: string; then?: { table: string }; else?: { table: string } }[];
};

/** Each case, its story curve and tables that do not depend on that curve (stream isolation). */
const CASES = [
  {
    id: "eshop_carrier",
    curve: "late_prob",
    moves: "shipment",
    unrelated: ["carrier", "product", "customer"],
  },
  {
    id: "isp_firmware",
    curve: "outage_prob",
    moves: "outage",
    unrelated: ["agent", "technician", "customer", "line_check", "invoice"],
  },
  { id: "card_fraud", curve: "fraud_rate", moves: "card_test", unrelated: ["customer", "card", "merchant"] },
] as const;

function run(raw: unknown, seed = 42): RunResult {
  const result = generate(raw, { seed });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.run;
}

function hashes(tables: readonly GeneratedTable[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [...new Set(tables.map((t) => t.name))].sort()) {
    const rows = tables.filter((t) => t.name === name).flatMap((t) => t.rows);
    out[name] = createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
  }
  return out;
}

const runs = Object.fromEntries(CASES.map((c) => [c.id, run(loadScenarioFixture(c.id))]));

describe.each(CASES)("golden: $id@42", ({ id, curve, moves, unrelated }) => {
  const base = runs[id] as RunResult;

  it("determinism: two runs produce identical table hashes", () => {
    expect(hashes(run(loadScenarioFixture(id)).tables)).toEqual(hashes(base.tables));
  });

  it("stream isolation: changing the story curve leaves unrelated tables identical", () => {
    const raw = loadScenarioFixture(id) as Raw;
    const seg = raw.curves.find((c) => c.id === curve)?.segments[0];
    if (!seg) throw new Error("fixture changed");
    seg.to = seg.to / 2;
    const changed = hashes(run(raw).tables);
    const before = hashes(base.tables);
    for (const t of unrelated) expect(changed[t], t).toBe(before[t]);
    expect(changed[moves]).not.toBe(before[moves]);
  });

  it("integrity: every *_id value names a row of some table; ids are unique per process", () => {
    const ids = new Set(base.tables.flatMap((t) => t.rows.map((r) => r.id)));
    for (const t of base.tables) {
      for (const col of Object.keys(t.rows[0] ?? {})) {
        if (!col.endsWith("_id")) continue;
        const dangling = t.rows.filter((r) => r[col] !== null && !ids.has(r[col] ?? null));
        expect(dangling.length, `${t.name}.${col}`).toBe(0);
      }
      expect(new Set(t.rows.map((r) => r.id)).size, t.name).toBe(t.rows.length);
    }
  });
});

describe("golden: demo hashes", () => {
  it("pinned hashes match tests/golden/demo_cases.hashes.json", () => {
    const actual = Object.fromEntries(CASES.map((c) => [c.id, hashes((runs[c.id] as RunResult).tables)]));
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(HASHES, `${JSON.stringify(actual, null, 2)}\n`);
    expect(actual).toEqual(JSON.parse(readFileSync(HASHES, "utf8")));
  });
});
