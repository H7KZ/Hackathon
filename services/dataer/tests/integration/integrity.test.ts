import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "@s2d/test-utils";
import type { GeneratedTable, RunResult } from "@s2d/schema/run";
import { openStore, writeRun } from "../../src/store/duckdb";
import { checkIntegrity, storeRun } from "../../src/store/integrity";

const base: GeneratedTable[] = [
  { name: "store", visibility: "observed", rows: [{ id: "STO-001" }, { id: "STO-002" }] },
  { name: "customer", visibility: "observed", rows: [{ id: "CUS-001", home_store_id: "STO-002" }] },
  {
    name: "sale",
    visibility: "observed",
    rows: [
      { id: "sale-000001", customer_id: "CUS-001", store_id: "STO-001", amount: 10 },
      { id: "sale-000002", customer_id: "CUS-001", store_id: "STO-002", amount: 20 },
    ],
  },
];

const runOf = (tables: GeneratedTable[]): RunResult => ({
  meta: { scenarioId: "t", seed: 1, scenarioHash: "h", engineVersion: "0" },
  storyPoints: [],
  tables,
});

describe("FK integrity (value-based inference)", () => {
  let dir = "";
  let cleanup = () => {};
  beforeEach(() => {
    ({ dir, cleanup } = makeTempDir());
  });
  afterEach(() => {
    cleanup();
  });

  const violationsOf = async (tables: GeneratedTable[]) => {
    const path = join(dir, "run.duckdb");
    await writeRun(path, runOf(tables));
    const store = await openStore(path, { readOnly: true });
    try {
      return await checkIntegrity(store);
    } finally {
      store.close();
    }
  };

  it("a clean run has no violations; non-standard FK names resolve (home_store_id -> store)", async () => {
    expect(await violationsOf(base)).toEqual([]);
  });

  it("reports a dangling FK with table.column, count and examples", async () => {
    const tables = structuredClone(base);
    tables[2]!.rows.push(
      { id: "sale-000003", customer_id: "CUS-999", store_id: "STO-001" },
      { id: "sale-000004", customer_id: "CUS-998", store_id: "STO-001" },
      { id: "sale-000005", customer_id: "CUS-999", store_id: "STO-001" },
    );
    expect(await violationsOf(tables)).toEqual([
      {
        table: "sale",
        column: "customer_id",
        target: "customer",
        dangling: 2,
        examples: ["CUS-998", "CUS-999"],
      },
    ]);
  });

  it("caps examples at 5", async () => {
    const tables = structuredClone(base);
    for (let i = 0; i < 8; i++) tables[1]!.rows.push({ id: `CUS-9${i}`, home_store_id: `STO-9${i}` });
    const [v] = await violationsOf(tables);
    expect(v).toMatchObject({ table: "customer", column: "home_store_id", target: "store", dangling: 8 });
    expect(v?.examples).toHaveLength(5);
  });

  it("allows NULL FKs (noise `missing`)", async () => {
    const tables = structuredClone(base);
    tables[2]!.rows.push({ id: "sale-000003", customer_id: null, store_id: "STO-001" });
    expect(await violationsOf(tables)).toEqual([]);
  });

  it("an FK pointing into a truth table resolves", async () => {
    const tables = structuredClone(base);
    tables.push(
      { name: "purchase_attempt", visibility: "ground_truth", rows: [{ id: "purchase_attempt-000001" }] },
      {
        name: "lost_sale",
        visibility: "ground_truth",
        rows: [{ id: "lost_sale-000001", attempt_id: "purchase_attempt-000001" }],
      },
    );
    expect(await violationsOf(tables)).toEqual([]);
  });

  it("duplicated rows (noise) do not false-positive", async () => {
    const tables = structuredClone(base);
    tables[0]!.rows.push({ id: "STO-001" });
    tables[2]!.rows.push(structuredClone(tables[2]!.rows[0]!));
    expect(await violationsOf(tables)).toEqual([]);
  });

  it("values split across two tables: the majority target wins, the rest is dangling", async () => {
    const tables = structuredClone(base);
    tables[2]!.rows.push({ id: "sale-000003", customer_id: "STO-001", store_id: "STO-001" });
    expect(await violationsOf(tables)).toEqual([
      { table: "sale", column: "customer_id", target: "customer", dangling: 1, examples: ["STO-001"] },
    ]);
  });

  it("a column that resolves nowhere has target null", async () => {
    const tables = structuredClone(base);
    tables.push({ name: "note", visibility: "observed", rows: [{ id: "n1", order_id: "X-1" }] });
    expect(await violationsOf(tables)).toEqual([
      { table: "note", column: "order_id", target: null, dangling: 1, examples: ["X-1"] },
    ]);
  });

  it("numeric ids are compared as text", async () => {
    const tables: GeneratedTable[] = [
      { name: "a", visibility: "observed", rows: [{ id: 1 }, { id: 2 }] },
      { name: "b", visibility: "observed", rows: [{ id: "b1", a_id: 2 }] },
    ];
    expect(await violationsOf(tables)).toEqual([]);
  });

  it("storeRun writes the db and throws a readable error naming table.column", async () => {
    const path = join(dir, "bad.duckdb");
    const tables = structuredClone(base);
    tables[2]!.rows.push({ id: "sale-000003", customer_id: "CUS-999", store_id: "STO-001" });
    await expect(storeRun(path, runOf(tables))).rejects.toThrow(/sale\.customer_id.*1 dangling.*CUS-999/s);
    expect(existsSync(path)).toBe(true);
    await expect(storeRun(join(dir, "ok.duckdb"), runOf(base))).resolves.toBeUndefined();
    await expect(storeRun(join(dir, "empty.duckdb"), runOf([]))).resolves.toBeUndefined();
  });
});
