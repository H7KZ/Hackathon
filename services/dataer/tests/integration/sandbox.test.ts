import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "@s2d/test-utils";
import type { RunResult } from "@s2d/schema/run";
import { writeRun } from "../../src/store/duckdb";
import { withSandbox } from "../../src/store/sandbox";
import { readTruthPoints } from "../../src/store/truth";

const run: RunResult = {
  meta: { scenarioId: "t", seed: 1, scenarioHash: "h", engineVersion: "0" },
  storyPoints: [
    { id: "sp2", phase: 2, title: "t", description: "d", start: "2025-04-01" },
    {
      id: "sp1",
      phase: 1,
      title: "t",
      description: "d",
      entity: { name: "supplier", ids: ["SUP-002", "SUP-003"] },
      start: "2025-03-01",
    },
  ],
  tables: [
    { name: "sale", visibility: "observed", rows: [{ id: "s1", amount: 1 }] },
    { name: "lost_sale", visibility: "ground_truth", rows: [{ id: "l1" }] },
  ],
};

describe("withSandbox", () => {
  let dir = "";
  let tmpRoot = "";
  let db = "";
  let cleanup = () => {};
  beforeEach(async () => {
    ({ dir, cleanup } = makeTempDir());
    tmpRoot = join(dir, "tmp");
    mkdirSync(tmpRoot);
    db = join(dir, "data", "run.duckdb");
    await writeRun(db, run);
  });
  afterEach(() => {
    cleanup();
  });

  const tablesIn = (sb: { query: (sql: string) => Promise<Record<string, unknown>[]> }) =>
    sb.query("SELECT schema_name || '.' || table_name AS t FROM duckdb_tables() ORDER BY 1");

  it("gives fn a main-only read-only copy, returns its result and leaves no files behind", async () => {
    const tables = await withSandbox(db, tablesIn, { tmpRoot });
    expect(tables).toEqual([{ t: "main.sale" }]);
    expect(readdirSync(tmpRoot)).toEqual([]);
    expect(readdirSync(join(dir, "data"))).toEqual(["run.duckdb"]);
  });

  it("cleans up when fn throws and rethrows the error", async () => {
    await expect(
      withSandbox(
        db,
        async (sb) => {
          await sb.query("SELECT 1");
          throw new Error("boom");
        },
        { tmpRoot },
      ),
    ).rejects.toThrow("boom");
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("cleans up when the export fails", async () => {
    await expect(withSandbox(join(dir, "nope.duckdb"), tablesIn, { tmpRoot })).rejects.toThrow(/No database/);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("two concurrent sandboxes of the same db both succeed", async () => {
    const [a, b] = await Promise.all([
      withSandbox(db, tablesIn, { tmpRoot }),
      withSandbox(db, tablesIn, { tmpRoot }),
    ]);
    expect(a).toEqual(b);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("the sandbox is read-only", async () => {
    await expect(withSandbox(db, (sb) => sb.query("DELETE FROM main.sale"), { tmpRoot })).rejects.toThrow();
  });
});

describe("readTruthPoints (full db, scoring only)", () => {
  it("reads findable story points only: phase >= 1 with an entity (live run #2: a baseline capped recall)", async () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const db = join(dir, "run.duckdb");
      const baseline = {
        id: "sp0",
        phase: 0,
        title: "Běžný provoz",
        description: "d",
        entity: { name: "supplier", ids: ["SUP-001"] },
        start: "2025-01-01",
      };
      await writeRun(db, { ...run, storyPoints: [...run.storyPoints, baseline] });
      expect(await readTruthPoints(db)).toEqual([
        { id: "sp1", entityIds: ["SUP-002", "SUP-003"], start: "2025-03-01" },
      ]);
      await writeRun(db, { ...run, storyPoints: [] });
      expect(await readTruthPoints(db)).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
