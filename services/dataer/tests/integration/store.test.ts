import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "@s2d/test-utils";
import type { RunResult } from "@s2d/schema/run";
import { exportSandbox, openSandbox, openStore, writeRun } from "../../src/store/duckdb";
import { runExpectations } from "../../src/evidence/expectations";
import { runDetectiveSql } from "../../src/detective/tools";

const run: RunResult = {
  meta: { scenarioId: "t", seed: 42, scenarioHash: "abc", engineVersion: "0.1.0" },
  storyPoints: [
    {
      id: "sp1",
      phase: 1,
      title: "t",
      description: "d",
      entity: { name: "supplier", ids: ["SUP-002"] },
      start: "2025-03-01",
    },
  ],
  tables: [
    {
      name: "sale",
      visibility: "observed",
      rows: [
        { id: "SAL-1", date: "2025-01-10", amount: 100 },
        { id: "SAL-2", date: "2025-05-10", amount: 60 },
      ],
    },
    { name: "complaint", visibility: "observed", rows: [{ id: "c-1", type: "nedostupnost" }] },
    { name: "complaint", visibility: "observed", rows: [{ id: "c-2", type: "kvalita", sale_id: "SAL-1" }] },
    { name: "lost_sale", visibility: "ground_truth", rows: [{ id: "LOS-1", date: "2025-05-11" }] },
    { name: "empty_tbl", visibility: "observed", columns: ["id", "x"], rows: [] },
  ],
};

describe("DuckDB store", () => {
  let dir = "";
  let cleanup = () => {};
  beforeEach(() => {
    const tmp = makeTempDir();
    dir = tmp.dir;
    cleanup = tmp.cleanup;
  });
  afterEach(() => {
    cleanup();
  });

  it("writes observed to main, ground truth to truth, run_meta and story_points", async () => {
    const path = join(dir, "run.duckdb");
    await writeRun(path, run);
    const store = await openStore(path, { readOnly: true });
    try {
      expect(await store.query("SELECT count(*)::INT AS n FROM main.sale")).toEqual([{ n: 2 }]);
      expect(await store.query("SELECT count(*)::INT AS n FROM truth.lost_sale")).toEqual([{ n: 1 }]);
      expect(await store.query("SELECT seed FROM truth.run_meta")).toEqual([{ seed: "42" }]);
      expect(await store.query("SELECT id, entity_ids FROM truth.story_points")).toEqual([
        { id: "sp1", entity_ids: "SUP-002" },
      ]);
      expect(await store.query("SELECT typeof(date) AS t FROM main.sale LIMIT 1")).toEqual([{ t: "DATE" }]);
      // two processes writing `complaint` are merged, missing columns become NULL
      expect(await store.query("SELECT id, sale_id FROM main.complaint ORDER BY id")).toEqual([
        { id: "c-1", sale_id: null },
        { id: "c-2", sale_id: "SAL-1" },
      ]);
      // empty tables keep their declared columns
      expect(await store.query("SELECT count(*)::INT AS n, max(x) AS x FROM main.empty_tbl")).toEqual([
        { n: 0, x: null },
      ]);
    } finally {
      store.close();
    }
  });

  it("rewriting a run replaces the previous database", async () => {
    const path = join(dir, "run.duckdb");
    await writeRun(path, run);
    await writeRun(path, { ...run, tables: [run.tables[0]!] });
    const store = await openStore(path, { readOnly: true });
    try {
      expect(
        await store.query("SELECT count(*)::INT AS n FROM duckdb_tables() WHERE table_name = 'lost_sale'"),
      ).toEqual([{ n: 0 }]);
    } finally {
      store.close();
    }
  });

  it("read-only connections reject writes", async () => {
    const path = join(dir, "ro.duckdb");
    await writeRun(path, run);
    const store = await openStore(path, { readOnly: true });
    try {
      await expect(store.query("DELETE FROM main.sale")).rejects.toThrow();
    } finally {
      store.close();
    }
  });
});

describe("sandbox (security boundary for evidence and detective)", () => {
  let dir = "";
  let cleanup = () => {};
  let sandboxPath = "";
  const secret = () => join(dir, "secret.csv").replaceAll("\\", "/");

  beforeEach(async () => {
    const tmp = makeTempDir();
    dir = tmp.dir;
    cleanup = tmp.cleanup;
    await writeRun(join(dir, "run.duckdb"), run);
    sandboxPath = join(dir, "sandbox.duckdb");
    await exportSandbox(join(dir, "run.duckdb"), sandboxPath);
    writeFileSync(join(dir, "secret.csv"), "a\nTOP-SECRET\n");
  });
  afterEach(() => {
    cleanup();
  });

  it("contains main tables only", async () => {
    const sb = await openSandbox(sandboxPath);
    try {
      const tables = await sb.query("SELECT schema_name, table_name FROM duckdb_tables() ORDER BY 2");
      expect(tables.map((t) => t.table_name)).toEqual(["complaint", "empty_tbl", "sale"]);
      expect(tables.every((t) => t.schema_name === "main")).toBe(true);
    } finally {
      sb.close();
    }
  });

  it.each([
    ["truth via query()", "SELECT * FROM query('SELECT * FROM tr' || 'uth.story_points')"],
    ["truth via query_table()", "SELECT * FROM query_table('tr' || 'uth.lost_sale')"],
    ["local file by path", "SELECT * FROM '__SECRET__'"],
    ["read_csv", "SELECT * FROM read_csv('__SECRET__')"],
    ["re-enable external access", "SET enable_external_access = true"],
    ["write", "CREATE TABLE main.x AS SELECT 1"],
  ])("blocks %s", async (_name, sql) => {
    const sb = await openSandbox(sandboxPath);
    try {
      await expect(sb.query(sql.replace("__SECRET__", secret()))).rejects.toThrow();
    } finally {
      sb.close();
    }
  });

  it("detective tool limits rows and returns errors as data", async () => {
    const sb = await openSandbox(sandboxPath);
    try {
      const ok = await runDetectiveSql(sb, "SELECT * FROM range(1000)");
      expect(ok).toMatchObject({ ok: true, truncated: true });
      if (ok.ok) expect(ok.rows).toHaveLength(200);
      expect(await runDetectiveSql(sb, "SELECT * FROM truth.lost_sale")).toMatchObject({ ok: false });
    } finally {
      sb.close();
    }
  });

  it("runs expectations on the sandbox", async () => {
    const sb = await openSandbox(sandboxPath);
    try {
      const [r] = await runExpectations(sb, [
        {
          id: "e",
          storyPointId: "sp",
          description: "",
          sql: "SELECT CASE WHEN date < DATE '2025-03-01' THEN 'before' ELSE 'after' END AS period, SUM(amount)::DOUBLE AS value FROM main.sale GROUP BY 1",
          check: { kind: "decrease", minRelChange: 0.3 },
        },
      ]);
      expect(r).toMatchObject({ id: "e", pass: true, before: 100, after: 60 });
    } finally {
      sb.close();
    }
  });
});
