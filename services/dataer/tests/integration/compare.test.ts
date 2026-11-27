import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "@s2d/test-utils";
import type { GeneratedTable, RunResult } from "@s2d/schema/run";
import { openStore, writeRun } from "../../src/store/duckdb";
import { collectMetrics, compareRuns } from "../../src/compare/metrics";

const runOf = (tables: GeneratedTable[]): RunResult => ({
  meta: { scenarioId: "t", seed: 1, scenarioHash: "h", engineVersion: "0" },
  storyPoints: [],
  tables,
});

const base = (): GeneratedTable[] => [
  {
    name: "sale",
    visibility: "observed",
    rows: [
      { id: "s1", date: "2025-01-01", store_id: 1, amount: 100, price: 1.5, note: "x" },
      { id: "s2", date: "2025-01-02", store_id: 2, amount: 50, price: null, note: "y" },
    ],
  },
  { name: "store", visibility: "observed", rows: [{ id: 1 }, { id: 2 }] },
  { name: "lost_sale", visibility: "ground_truth", rows: [{ id: "l1", qty: 9 }] },
];

const hash = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

describe("collectMetrics / compareRuns", () => {
  let dir = "";
  let cleanup = () => {};
  let a = "";
  beforeEach(async () => {
    ({ dir, cleanup } = makeTempDir());
    a = join(dir, "a.duckdb");
    await writeRun(a, runOf(base()));
  });
  afterEach(() => {
    cleanup();
  });

  it("row counts per main table and sums of numeric non-key columns only", async () => {
    const store = await openStore(a, { readOnly: true });
    try {
      expect(await collectMetrics(store)).toEqual({
        "sale.rows": 2,
        "sale.amount.sum": 150,
        "sale.price.sum": 1.5,
        "store.rows": 2,
      });
    } finally {
      store.close();
    }
  });

  it("identical runs: every delta is 0", async () => {
    const b = join(dir, "b.duckdb");
    await writeRun(b, runOf(base()));
    const diff = await compareRuns(a, b);
    expect(diff.length).toBe(4);
    expect(diff.every((d) => d.delta === 0 && d.relChange === 0)).toBe(true);
  });

  it("a changed amount gives the right delta and relChange", async () => {
    const tables = base();
    tables[0]!.rows[1]!.amount = 20; // 150 -> 120
    const b = join(dir, "b.duckdb");
    await writeRun(b, runOf(tables));
    const diff = await compareRuns(a, b);
    expect(diff.find((d) => d.metric === "sale.amount.sum")).toEqual({
      metric: "sale.amount.sum",
      a: 150,
      b: 120,
      delta: -30,
      relChange: -0.2,
    });
    expect(diff.find((d) => d.metric === "sale.rows")?.delta).toBe(0);
  });

  it("a table only in B has a = null", async () => {
    const tables = base();
    tables.push({ name: "complaint", visibility: "observed", rows: [{ id: "c1" }] });
    const b = join(dir, "b.duckdb");
    await writeRun(b, runOf(tables));
    expect((await compareRuns(a, b)).find((d) => d.metric === "complaint.rows")).toEqual({
      metric: "complaint.rows",
      a: null,
      b: 1,
      delta: null,
      relChange: null,
    });
  });

  it("does not modify either database and works with A == B", async () => {
    const b = join(dir, "b.duckdb");
    await writeRun(b, runOf(base()));
    const before = [hash(a), statSync(a).mtimeMs, hash(b), statSync(b).mtimeMs];
    await compareRuns(a, b);
    await compareRuns(a, a);
    expect([hash(a), statSync(a).mtimeMs, hash(b), statSync(b).mtimeMs]).toEqual(before);
  });

  it("a missing database is a readable error", async () => {
    await expect(compareRuns(a, join(dir, "nope.duckdb"))).rejects.toThrow(/nope\.duckdb/);
  });
});
