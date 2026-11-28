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

  it("runs single-threaded, so LLM SQL without ORDER BY returns rows in a replayable order (live run 4)", async () => {
    const threads = await withSandbox(db, (sb) => sb.query("SELECT current_setting('threads') AS t"), {
      tmpRoot,
    });
    expect(Number(threads[0]?.t)).toBe(1);
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
      const segment = {
        id: "sp2",
        phase: 1,
        title: "Kampaň",
        description: "d",
        segment: { field: "customer.segment", values: ["kampaň", "jaro, léto"] },
        start: "2025-03-15",
      };
      await writeRun(db, { ...run, storyPoints: [...run.storyPoints, segment] });
      expect(await readTruthPoints(db)).toEqual([
        { id: "sp1", entityIds: ["SUP-002", "SUP-003"], start: "2025-03-01" },
        { id: "sp2", entityIds: [], segmentValues: ["kampaň", "jaro, léto"], start: "2025-03-15" },
      ]);
      await writeRun(db, { ...run, storyPoints: [] });
      expect(await readTruthPoints(db)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("a segment on an entity attribute also matches the few entity rows it denotes (run 7: 'problémový' supplier = SUP-001)", async () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const db = join(dir, "run.duckdb");
      const supplier = {
        name: "supplier",
        visibility: "observed" as const,
        rows: [
          { id: "SUP-001", supplier_profile: "problémový" },
          { id: "SUP-002", supplier_profile: "spolehlivý" },
          { id: "SUP-003", supplier_profile: "spolehlivý" },
        ],
      };
      // a broad group (most rows of an entity) stays a group: naming one product is not finding the category
      const product = {
        name: "product",
        visibility: "observed" as const,
        rows: Array.from({ length: 30 }, (_, i) => ({
          id: `PRO-${String(i + 1).padStart(3, "0")}`,
          category: i < 12 ? "sportovní" : "ostatní",
        })),
      };
      const late = {
        id: "sp1",
        phase: 1,
        title: "t",
        description: "d",
        segment: { field: "self.supplier_profile", values: ["problémový"] },
        start: "2025-03-01",
      };
      const sport = {
        id: "sp2",
        phase: 2,
        title: "t",
        description: "d",
        segment: { field: "product.category", values: ["sportovní"] },
        start: "2025-04-01",
      };
      await writeRun(db, {
        ...run,
        storyPoints: [late, sport],
        tables: [...run.tables, supplier, product],
      });
      expect(await readTruthPoints(db)).toEqual([
        { id: "sp1", entityIds: ["SUP-001"], segmentValues: ["problémový"], start: "2025-03-01" },
        { id: "sp2", entityIds: [], segmentValues: ["sportovní"], start: "2025-04-01" },
      ]);
      // live v1 eval: the attribute sits on the record table next to the entity id (entity column "profile")
      const order = {
        name: "purchase_order",
        visibility: "observed" as const,
        rows: [
          {
            id: "purchase_order-000001",
            supplier_id: "SUP-002",
            product_id: "PRO-001",
            supplier_profile: "spolehlivý",
          },
          {
            id: "purchase_order-000002",
            supplier_id: "SUP-001",
            product_id: "PRO-002",
            supplier_profile: "problémový",
          },
          {
            id: "purchase_order-000003",
            supplier_id: "SUP-003",
            product_id: "PRO-003",
            supplier_profile: "spolehlivý",
          },
        ],
      };
      const renamed = {
        ...supplier,
        rows: supplier.rows.map(({ supplier_profile, ...r }) => ({ ...r, profile: supplier_profile })),
      };
      await writeRun(db, { ...run, storyPoints: [late], tables: [...run.tables, renamed, order] });
      expect(await readTruthPoints(db)).toEqual([
        { id: "sp1", entityIds: ["SUP-001"], segmentValues: ["problémový"], start: "2025-03-01" },
      ]);
    } finally {
      cleanup();
    }
  });
});
