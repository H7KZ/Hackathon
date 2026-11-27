import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { createLlm } from "@s2d/llm";
import { fakeGenerate, makeTempDir } from "@s2d/test-utils";
import type { RunResult } from "@s2d/schema/run";
import type { DetectiveReport } from "@s2d/schema/detective";
import { writeRun, type Store } from "../../src/store/duckdb";
import { withSandbox } from "../../src/store/sandbox";
import { runDetective, type DetectiveEvent } from "../../src/detective/loop";
import { detective } from "../../src/detective/index";

const run: RunResult = {
  meta: { scenarioId: "t", seed: 1, scenarioHash: "h", engineVersion: "0" },
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
      name: "delivery",
      visibility: "observed",
      rows: [
        { id: "d1", supplier_id: "SUP-002", planned_date: "2025-02-01", delay_days: 0 },
        { id: "d2", supplier_id: "SUP-002", planned_date: "2025-03-05", delay_days: 9 },
      ],
    },
    { name: "supplier", visibility: "observed", rows: [{ id: "SUP-002", name: "Dodavatel" }] },
    { name: "lost_sale", visibility: "ground_truth", rows: [{ id: "l1" }] },
  ],
};

const report: DetectiveReport = {
  narrative: "Dodavatel SUP-002 od března zpožďuje dodávky.",
  findings: [
    {
      claim: "Zpoždění dodávek SUP-002",
      entities: ["SUP-002"],
      start: "2025-03-05",
      supportingSql: "SELECT * FROM delivery",
    },
  ],
};

const act = (action: unknown) => ({ action });

describe("detective tool loop", () => {
  let dir = "";
  let cleanup = () => {};
  let db = "";
  beforeEach(async () => {
    ({ dir, cleanup } = makeTempDir());
    db = join(dir, "run.duckdb");
    await writeRun(db, run);
  });
  afterEach(() => {
    cleanup();
  });

  const llmWith = (responses: unknown[]) => {
    const fake = fakeGenerate(responses);
    const llm = createLlm({
      generate: fake.generate,
      cacheDir: join(dir, "cache"),
      offline: false,
      model: "test:model",
    });
    return { llm, calls: fake.calls };
  };

  const loop = (
    responses: unknown[],
    opts: { maxSteps?: number; signal?: AbortSignal; onSandbox?: (sb: Store) => void } = {},
  ) => {
    const { llm, calls } = llmWith(responses);
    const events: DetectiveEvent[] = [];
    const result = withSandbox(db, (sandbox) => {
      opts.onSandbox?.(sandbox);
      return runDetective({
        sandbox,
        llm,
        onEvent: (e) => events.push(e),
        ...(opts.signal && { signal: opts.signal }),
        ...(opts.maxSteps !== undefined && { maxSteps: opts.maxSteps }),
      });
    });
    return { result, calls, events };
  };

  it("happy path: tools run, results reach the next prompt, report is returned", async () => {
    const { result, calls, events } = loop([
      act({ tool: "list_tables" }),
      act({ tool: "describe_table", table: "delivery" }),
      act({ tool: "run_sql", sql: "SELECT supplier_id, sum(delay_days) AS d FROM delivery GROUP BY 1" }),
      act({ tool: "report", report }),
    ]);
    expect(await result).toEqual(report);
    expect(calls.map((c) => c.schemaName)).toEqual([
      "detective_step",
      "detective_step",
      "detective_step",
      "detective_step",
    ]);
    // list_tables shows main tables only (never truth) with row counts
    expect(calls[1]?.prompt).toMatch(/delivery/);
    expect(calls[1]?.prompt).toMatch(/supplier/);
    expect(calls[1]?.prompt).not.toMatch(/lost_sale/);
    // describe_table shows column types
    expect(calls[2]?.prompt).toMatch(/delay_days/);
    expect(calls[2]?.prompt).toMatch(/BIGINT/);
    // run_sql result is in the transcript
    expect(calls[3]?.prompt).toMatch(/SUP-002/);
    expect(calls[3]?.prompt).toMatch(/"d":\s*"?9/);
    expect(events).toEqual([
      { type: "log", message: "SQL: SELECT supplier_id, sum(delay_days) AS d FROM delivery GROUP BY 1" },
    ]);
  });

  it("SQL errors and guard rejections are fed back to the model, the loop continues", async () => {
    const { result, calls, events } = loop([
      act({ tool: "run_sql", sql: "SELECT nope FROM delivery" }),
      act({ tool: "run_sql", sql: "DELETE FROM delivery" }),
      act({ tool: "describe_table", table: "lost_sale" }),
      act({ tool: "report", report }),
    ]);
    expect(await result).toEqual(report);
    expect(calls[1]?.prompt).toMatch(/error/i);
    expect(calls[1]?.prompt).toMatch(/nope/);
    expect(calls[2]?.prompt).toMatch(/read queries/);
    expect(calls[3]?.prompt).toMatch(/Unknown table 'lost_sale'/);
    expect(events.map((e) => e.message)).toEqual([
      "SQL: SELECT nope FROM delivery",
      "SQL: DELETE FROM delivery",
    ]);
  });

  it("truth is unreachable through run_sql", async () => {
    const { result, calls } = loop([
      act({ tool: "run_sql", sql: "SELECT * FROM truth.story_points" }),
      act({ tool: "report", report }),
    ]);
    await result;
    expect(calls[1]?.prompt).not.toMatch(/sp1/);
    expect(calls[1]?.prompt).toMatch(/error/i);
  });

  it("step cap: exactly maxSteps tool calls, then one forced final report", async () => {
    const { result, calls } = loop(
      [act({ tool: "list_tables" }), act({ tool: "list_tables" }), act({ tool: "list_tables" }), report],
      { maxSteps: 3 },
    );
    expect(await result).toEqual(report);
    expect(calls.map((c) => c.schemaName)).toEqual([
      "detective_step",
      "detective_step",
      "detective_step",
      "detective_report",
    ]);
    expect(calls[3]?.prompt).toMatch(/final report/i);
  });

  it("abort stops before the next LLM call", async () => {
    const controller = new AbortController();
    const { llm, calls } = llmWith([act({ tool: "list_tables" }), act({ tool: "report", report })]);
    const p = withSandbox(db, (sandbox) =>
      runDetective({
        sandbox,
        llm: {
          object: async (req) => {
            const out = await llm.object(req);
            controller.abort(new Error("cancelled"));
            return out;
          },
        },
        onEvent: () => {},
        signal: controller.signal,
      }),
    );
    await expect(p).rejects.toThrow("cancelled");
    expect(calls).toHaveLength(1);
  });

  it("an already aborted signal makes no LLM call", async () => {
    const { result, calls } = loop([act({ tool: "report", report })], { signal: AbortSignal.abort() });
    await expect(result).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("an invalid action surfaces the zod error", async () => {
    const { result } = loop([act({ tool: "drop_table", table: "delivery" })]);
    await expect(result).rejects.toThrow(/detective_step.*failed validation/s);
  });

  it("a report with an invalid date surfaces the zod error", async () => {
    const bad = { ...report, findings: [{ ...report.findings[0], start: "březen" }] };
    const { result } = loop([act({ tool: "report", report: bad })]);
    await expect(result).rejects.toThrow(/failed validation/);
  });

  it("long results are truncated in the transcript", async () => {
    const { result, calls } = loop([
      act({ tool: "run_sql", sql: "SELECT repeat('x', 100) AS s FROM range(1000)" }),
      act({ tool: "report", report }),
    ]);
    await result;
    expect(calls[1]?.prompt.length).toBeLessThan(12_000);
    expect(calls[1]?.prompt).toMatch(/truncated/);
  });
});

describe("detective(dbPath)", () => {
  it("runs on a sandbox and scores against truth.story_points from the full db", async () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const db = join(dir, "run.duckdb");
      await writeRun(db, run);
      const fake = fakeGenerate([act({ tool: "report", report })]);
      const llm = createLlm({
        generate: fake.generate,
        cacheDir: join(dir, "cache"),
        offline: false,
        model: "test:model",
      });
      const events: DetectiveEvent[] = [];
      const result = await detective(db, { llm, onEvent: (e) => events.push(e) });
      expect(result).toEqual({
        report,
        score: { recall: 1, precision: 1, matched: [{ storyPointId: "sp1", findingIndex: 0 }] },
      });

      const wrong = fakeGenerate([
        act({
          tool: "report",
          report: { ...report, findings: [{ ...report.findings[0]!, entities: ["X"] }] },
        }),
      ]);
      const r2 = await detective(db, {
        llm: createLlm({ generate: wrong.generate, cacheDir: join(dir, "c2"), offline: false, model: "m" }),
      });
      expect(r2.score.recall).toBe(0);
    } finally {
      cleanup();
    }
  });
});
