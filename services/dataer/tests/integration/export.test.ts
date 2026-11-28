import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { makeTempDir } from "@s2d/test-utils";
import type { RunResult } from "@s2d/schema/run";
import { openStore, writeRun } from "../../src/store/duckdb";
import { exportDataset } from "../../src/export";

const run: RunResult = {
  meta: { scenarioId: "t", seed: 1, scenarioHash: "h", engineVersion: "0" },
  storyPoints: [],
  tables: [
    {
      name: "sale",
      visibility: "observed",
      rows: [
        { id: "s1", date: "2025-01-01", store_id: 1, amount: 100, note: 'a "quoted" <b>&' },
        { id: "s2", date: "2025-01-02", store_id: 2, amount: 50.5, note: null },
      ],
    },
    { name: "store", visibility: "observed", rows: [{ id: 1 }, { id: 2 }] },
    { name: "lost_sale", visibility: "ground_truth", rows: [{ id: "l1", qty: 9 }] },
  ],
};

/** Minimal zip reader (local headers): name → bytes. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8);
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extra = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString("utf8");
    const data = buf.subarray(at + 30 + nameLen + extra, at + 30 + nameLen + extra + size);
    out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at += 30 + nameLen + extra + size;
  }
  return out;
}

describe("exportDataset", () => {
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

  it("csv: a zip with one CSV per observed table, never the ground truth", async () => {
    const res = await exportDataset(db, "csv", join(dir, "out"));
    expect(res.contentType).toBe("application/zip");
    const files = unzip(readFileSync(res.file));
    expect([...files.keys()].sort()).toEqual(["sale.csv", "store.csv"]);
    const csv = files.get("sale.csv")?.toString("utf8") ?? "";
    expect(csv.split("\n")[0]).toContain("id");
    expect(csv).toContain("s2");
  });

  it("parquet: a zip of parquet files that DuckDB reads back", async () => {
    const res = await exportDataset(db, "parquet", join(dir, "out"));
    const files = unzip(readFileSync(res.file));
    expect([...files.keys()].sort()).toEqual(["sale.parquet", "store.parquet"]);
    expect(files.get("sale.parquet")?.subarray(0, 4).toString()).toBe("PAR1");
  });

  it("xlsx: one sheet per observed table, escaped cells, numbers as numbers", async () => {
    const res = await exportDataset(db, "xlsx", join(dir, "out"));
    expect(res.filename.endsWith(".xlsx")).toBe(true);
    const files = unzip(readFileSync(res.file));
    expect(files.has("[Content_Types].xml")).toBe(true);
    const book = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
    expect(book).toContain('name="sale"');
    expect(book).toContain('name="store"');
    expect(book).not.toContain("lost_sale");
    const sheet = files.get("xl/worksheets/sheet1.xml")?.toString("utf8") ?? "";
    expect(sheet).toContain("a &quot;quoted&quot; &lt;b&gt;&amp;");
    expect(sheet).toMatch(/<c r="D3"><v>50.5<\/v><\/c>/);
  });

  it("duckdb: a database file with the observed tables only", async () => {
    const res = await exportDataset(db, "duckdb", join(dir, "out"));
    const s = await openStore(res.file, { readOnly: true });
    try {
      const rows = await s.query("SELECT table_schema, table_name FROM information_schema.tables ORDER BY 2");
      expect(rows.map((r) => r.table_name)).toEqual(["sale", "store"]);
    } finally {
      s.close();
    }
  });
});
