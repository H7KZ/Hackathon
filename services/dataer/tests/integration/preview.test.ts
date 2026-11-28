import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { makeTempDir } from "@s2d/test-utils";
import type { RunResult } from "@s2d/schema/run";
import { writeRun } from "../../src/store/duckdb";
import { listTables, previewTable } from "../../src/preview/tables";

const run: RunResult = {
  meta: { scenarioId: "t", seed: 1, scenarioHash: "h", engineVersion: "0" },
  storyPoints: [],
  tables: [
    {
      name: "sale",
      visibility: "observed",
      rows: [
        { id: "s1", date: "2025-01-01", store_id: 1, amount: 100 },
        { id: "s2", date: "2025-01-02", store_id: 2, amount: 50 },
        { id: "s3", date: "2025-01-03", store_id: 1, amount: 70 },
      ],
    },
    { name: "store", visibility: "observed", rows: [{ id: 1 }, { id: 2 }] },
    { name: "empty", visibility: "observed", columns: ["id", "x"], rows: [] },
    { name: "lost_sale", visibility: "ground_truth", rows: [{ id: "l1", qty: 9 }] },
  ],
};

describe("listTables / previewTable", () => {
  let dir = "";
  let cleanup = () => {};
  let db = "";
  beforeEach(async () => {
    ({ dir, cleanup } = makeTempDir());
    db = join(dir, "db.duckdb");
    await writeRun(db, run);
  });
  afterEach(() => {
    cleanup();
  });

  it("lists only observed tables with row counts and typed columns", async () => {
    const tables = await listTables(db);
    expect(tables.map((t) => [t.name, t.rows])).toEqual([
      ["empty", 0],
      ["sale", 3],
      ["store", 2],
    ]);
    const sale = tables.find((t) => t.name === "sale");
    expect(sale?.columns.map((c) => c.name)).toEqual(["id", "date", "store_id", "amount"]);
    expect(sale?.columns.find((c) => c.name === "date")?.type).toBe("DATE");
  });

  it("previews the first rows in id order with JSON-safe values", async () => {
    const p = await previewTable(db, "sale", 2);
    expect(p.rows).toBe(3);
    expect(p.rowsShown).toEqual([
      { id: "s1", date: "2025-01-01", store_id: 1, amount: 100 },
      { id: "s2", date: "2025-01-02", store_id: 2, amount: 50 },
    ]);
  });

  it("refuses ground-truth and unknown tables (no SQL is built from the name)", async () => {
    await expect(previewTable(db, "lost_sale", 5)).rejects.toThrow(/Tabulka "lost_sale" neexistuje/);
    await expect(previewTable(db, 'sale"; DROP TABLE sale; --', 5)).rejects.toThrow(/neexistuje/);
  });

  it("clamps the limit to 1..200", async () => {
    expect((await previewTable(db, "sale", 0)).rowsShown).toHaveLength(1);
    expect((await previewTable(db, "sale", 10_000)).rowsShown).toHaveLength(3);
  });
});
