import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { makeTempDir } from "@s2d/test-utils";
import type { RunResult } from "@s2d/schema/run";
import { exportSandbox, openSandbox, openStore, writeRun } from "../../src/store/duckdb";
import { dailySeries, type DailySeries } from "../../src/evidence/series";

const stock = (day: string, product: string, value: number) => ({
  id: `stock_daily-${day}-${product}`,
  date: day,
  store_id: 7, // numeric FK: must not get a sum series
  product_id: product,
  value,
});

const run: RunResult = {
  meta: { scenarioId: "t", seed: 1, scenarioHash: "h", engineVersion: "0" },
  storyPoints: [],
  tables: [
    {
      name: "stock_daily",
      visibility: "observed",
      rows: [
        stock("2025-03-01", "P1", 50),
        stock("2025-03-01", "P2", 50),
        stock("2025-03-02", "P1", 40),
        stock("2025-03-02", "P2", 30),
        stock("2025-03-03", "P1", 10),
        stock("2025-03-03", "P2", 5),
      ],
    },
    {
      name: "delivery",
      visibility: "observed",
      rows: [
        { id: "d1", planned_date: "2025-03-01", actual_date: "2025-03-01", qty: 5 },
        { id: "d2", planned_date: "2025-03-01", actual_date: "2025-03-04", qty: 7 },
        { id: "d3", planned_date: "2025-03-02", actual_date: null, qty: null },
      ],
    },
    {
      name: "sale",
      visibility: "observed",
      rows: [
        { id: "s1", ts: "2025-03-01T09:30:00", amount: 1.5 },
        { id: "s2", ts: "2025-03-01T18:00:00", amount: 2.25 },
        { id: "s3", ts: "2025-03-04T08:00:00", amount: 4 },
      ],
    },
    { name: "supplier", visibility: "observed", rows: [{ id: "SUP-001", rating: 3 }] },
    { name: "empty_tbl", visibility: "observed", columns: ["id", "x"], rows: [] },
    { name: "lost_sale", visibility: "ground_truth", rows: [{ id: "l1", date: "2025-03-01", qty: 1 }] },
  ],
};

const find = (s: DailySeries[], table: string, dateColumn: string, metric: string) =>
  s.find((x) => x.table === table && x.dateColumn === dateColumn && x.metric === metric);
const values = (x: DailySeries | undefined) => x?.points.map((p) => p.value);

describe("dailySeries", () => {
  let dir = "";
  let cleanup = () => {};
  let series: DailySeries[] = [];
  beforeEach(async () => {
    ({ dir, cleanup } = makeTempDir());
    await writeRun(join(dir, "run.duckdb"), run);
    await exportSandbox(join(dir, "run.duckdb"), join(dir, "sb.duckdb"));
    const sb = await openSandbox(join(dir, "sb.duckdb"));
    try {
      series = await dailySeries(sb);
    } finally {
      sb.close();
    }
  });
  afterEach(() => {
    cleanup();
  });

  it("snapshot table: the rows series is flat while the value sum drops", () => {
    const rows = find(series, "stock_daily", "date", "rows");
    expect(rows?.points).toEqual([
      { day: "2025-03-01", value: 2 },
      { day: "2025-03-02", value: 2 },
      { day: "2025-03-03", value: 2 },
    ]);
    expect(values(find(series, "stock_daily", "date", "value.sum"))).toEqual([100, 70, 15]);
  });

  it("numeric id / *_id columns get no sum series", () => {
    expect(series.filter((s) => s.table === "stock_daily").map((s) => s.metric)).toEqual([
      "rows",
      "value.sum",
    ]);
  });

  it("one series set per date column, gaps zero-filled, NULL dates skipped", () => {
    expect(find(series, "delivery", "planned_date", "rows")?.points).toEqual([
      { day: "2025-03-01", value: 2 },
      { day: "2025-03-02", value: 1 },
    ]);
    expect(find(series, "delivery", "actual_date", "rows")?.points).toEqual([
      { day: "2025-03-01", value: 1 },
      { day: "2025-03-02", value: 0 },
      { day: "2025-03-03", value: 0 },
      { day: "2025-03-04", value: 1 },
    ]);
    // NULL numeric values count as 0 in the sum
    expect(values(find(series, "delivery", "planned_date", "qty.sum"))).toEqual([12, 0]);
    expect(values(find(series, "delivery", "actual_date", "qty.sum"))).toEqual([5, 0, 0, 7]);
  });

  it("TIMESTAMP columns are bucketed per day; sums keep decimals", () => {
    expect(find(series, "sale", "ts", "rows")?.points.map((p) => [p.day, p.value])).toEqual([
      ["2025-03-01", 2],
      ["2025-03-02", 0],
      ["2025-03-03", 0],
      ["2025-03-04", 1],
    ]);
    expect(values(find(series, "sale", "ts", "amount.sum"))).toEqual([3.75, 0, 0, 4]);
  });

  it("skips tables without a date column, empty tables, and never shows truth tables", () => {
    expect([...new Set(series.map((s) => s.table))]).toEqual(["delivery", "sale", "stock_daily"]);
  });

  it("is deterministic and sorted (table, date column order, rows first)", () => {
    expect(series.map((s) => `${s.table}.${s.dateColumn}.${s.metric}`)).toEqual([
      "delivery.planned_date.rows",
      "delivery.planned_date.qty.sum",
      "delivery.actual_date.rows",
      "delivery.actual_date.qty.sum",
      "sale.ts.rows",
      "sale.ts.amount.sum",
      "stock_daily.date.rows",
      "stock_daily.date.value.sum",
    ]);
  });

  it("reads only schema main even when given the full database", async () => {
    const full = await openStore(join(dir, "run.duckdb"), { readOnly: true });
    try {
      expect((await dailySeries(full)).some((s) => s.table === "lost_sale")).toBe(false);
    } finally {
      full.close();
    }
  });
});
