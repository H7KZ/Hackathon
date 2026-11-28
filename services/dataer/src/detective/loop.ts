/**
 * Blind detective tool loop (SPEC §3.E). Gets ONLY a sandbox store (main tables, read-only).
 *
 * `@s2d/llm` has no tool calling, so each turn is one `llm.object()` call returning an action
 * (list_tables | describe_table | run_sql | report). The transcript of earlier actions and their results
 * is part of the prompt, so the disk cache replays a whole investigation deterministically offline.
 * After `maxSteps` actions without a report, one final call forces the report.
 * The action schema is a dataer-internal protocol, not a contract type.
 */
import { z } from "zod";
import type { Llm } from "@s2d/llm";
import { DetectiveReport } from "@s2d/schema/detective";
import type { Store } from "../store/duckdb";
import { mainTables, quoteIdent } from "../store/columns";
import { runDetectiveSql } from "./tools";

export type DetectiveEvent = { type: "log"; message: string };

export const DETECTIVE_MAX_STEPS = 15;
const MAX_RESULT_CHARS = 4_000;

export const DetectiveStep = z.object({
  action: z.discriminatedUnion("tool", [
    z.object({ tool: z.literal("list_tables") }),
    z.object({ tool: z.literal("describe_table"), table: z.string() }),
    z.object({ tool: z.literal("run_sql"), sql: z.string() }),
    z.object({ tool: z.literal("report"), report: DetectiveReport }),
  ]),
});
type Action = z.infer<typeof DetectiveStep>["action"];

const INSTRUCTIONS = `You are a data analyst investigating an unknown company's relational dataset in DuckDB.
Find the business story hidden in the data: which entities (e.g. a supplier, store or product) changed
behaviour, when it started, and what it caused downstream. You know nothing about the company in advance.

Each turn, return exactly one action:
- {"tool":"list_tables"}: table names with row counts
- {"tool":"describe_table","table":"<name>"}: columns, types and 3 sample rows
- {"tool":"run_sql","sql":"<one read-only DuckDB SELECT>"}: at most 200 rows are returned
- {"tool":"report","report":{...}}: your final answer; ends the investigation

Compare periods (e.g. per week or month) and entities; look for a change point.
In the report, each finding lists in "entities" the concrete entity ids exactly as they appear in the data
(or, when the change concerns a group of records, the category values that define it, e.g. a customer
segment or channel), the ISO date (YYYY-MM-DD) the change started, and the SQL that supports it. Write narrative and claims in Czech.`;

async function runTool(sandbox: Store, action: Exclude<Action, { tool: "report" }>): Promise<unknown> {
  switch (action.tool) {
    case "list_tables": {
      const tables = await mainTables(sandbox);
      const out = [];
      for (const t of tables) {
        const [row] = await sandbox.query(`SELECT count(*)::DOUBLE AS n FROM main.${quoteIdent(t.table)}`);
        out.push({ table: t.table, rows: Number(row?.n ?? 0), columns: t.columns.length });
      }
      return out;
    }
    case "describe_table": {
      const t = (await mainTables(sandbox)).find((x) => x.table === action.table);
      if (!t) return { error: `Unknown table '${action.table}'. Use list_tables to see the tables.` };
      const sample = await sandbox.query(`SELECT * FROM main.${quoteIdent(t.table)} LIMIT 3`);
      return { table: t.table, columns: t.columns, sample };
    }
    case "run_sql": {
      const r = await runDetectiveSql(sandbox, action.sql);
      return r.ok ? { rows: r.rows, truncated: r.truncated } : { error: r.error };
    }
  }
}

function clip(text: string): string {
  return text.length <= MAX_RESULT_CHARS
    ? text
    : `${text.slice(0, MAX_RESULT_CHARS)}… [truncated, ${text.length} chars total; aggregate or LIMIT]`;
}

function promptOf(transcript: string[], budgetLeft: number, final: boolean): string {
  const history = transcript.length ? transcript.join("\n\n") : "(nothing yet)";
  const ask = final
    ? "The step budget is used up. Write your final report now from what you found."
    : `Steps left: ${budgetLeft}. Choose the next action.`;
  return `## Investigation so far\n\n${history}\n\n## Next\n\n${ask}`;
}

export async function runDetective(opts: {
  sandbox: Store;
  llm: Llm;
  onEvent?: (e: DetectiveEvent) => void;
  signal?: AbortSignal;
  maxSteps?: number;
}): Promise<DetectiveReport> {
  const { sandbox, llm, onEvent, signal } = opts;
  const maxSteps = opts.maxSteps ?? DETECTIVE_MAX_STEPS;
  const transcript: string[] = [];

  for (let step = 1; step <= maxSteps; step++) {
    signal?.throwIfAborted();
    const { action } = await llm.object({
      schemaName: "detective_step",
      schema: DetectiveStep,
      instructions: INSTRUCTIONS,
      prompt: promptOf(transcript, maxSteps - step + 1, false),
    });
    if (action.tool === "report") return action.report;
    if (action.tool === "run_sql") onEvent?.({ type: "log", message: `SQL: ${action.sql}` });
    const result = await runTool(sandbox, action);
    transcript.push(
      `### Step ${step}\nAction: ${JSON.stringify(action)}\nResult: ${clip(JSON.stringify(result))}`,
    );
  }

  signal?.throwIfAborted();
  return llm.object({
    schemaName: "detective_report",
    schema: DetectiveReport,
    instructions: INSTRUCTIONS,
    prompt: promptOf(transcript, 0, true),
  });
}
