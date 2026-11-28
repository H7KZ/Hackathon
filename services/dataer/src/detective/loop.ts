/**
 * Blind detective tool loop (SPEC §3.E). Gets ONLY a sandbox store (main tables, read-only).
 *
 * `@s2d/llm` has no tool calling, so each turn is one `llm.object()` call returning an action
 * (run_sql | report | describe_table | list_tables). The transcript of earlier actions and their results
 * is part of the prompt, so the disk cache replays a whole investigation deterministically offline.
 * After `maxSteps` actions without a report, one final call forces the report.
 * The action schema is a dataer-internal protocol, not a contract type.
 *
 * Speed (user: the detective took minutes): every step is one slow LLM call whose prompt grows with the
 * transcript, so the loop front-loads what code can compute (all main tables with columns, row counts,
 * date ranges and sample rows), lets one step run several queries, and has a short budget.
 */
import { z } from "zod";
import type { Llm } from "@s2d/llm";
import { DetectiveReport } from "@s2d/schema/detective";
import type { Store } from "../store/duckdb";
import { isDateType, mainTables, quoteIdent } from "../store/columns";
import { runDetectiveSql } from "./tools";

export type DetectiveEvent = { type: "log"; message: string };

export const DETECTIVE_MAX_STEPS = 8;
const MAX_RESULT_CHARS = 4_000;
/** per query when a step runs several */
const MAX_QUERY_RESULT_CHARS = 2_500;
const MAX_QUERIES = 4;

export const DetectiveStep = z.object({
  action: z.discriminatedUnion("tool", [
    z.object({ tool: z.literal("list_tables") }),
    z.object({ tool: z.literal("describe_table"), table: z.string() }),
    z.object({
      tool: z.literal("run_sql"),
      sql: z.string().optional(),
      queries: z.array(z.string()).max(MAX_QUERIES).optional(),
    }),
    z.object({ tool: z.literal("report"), report: DetectiveReport }),
  ]),
});
type Action = z.infer<typeof DetectiveStep>["action"];

const INSTRUCTIONS = `You are a data analyst investigating an unknown company's relational dataset in DuckDB.
Find the business story hidden in the data: which entities (e.g. a supplier, store or product) changed
behaviour, when it started, and what it caused downstream. You know nothing about the company in advance.

The prompt already lists every table with its columns, row count, date ranges and sample rows.
Each turn, return exactly one action:
- {"tool":"run_sql","queries":["<read-only DuckDB SELECT>", ...]}: up to 4 queries at once, at most 200 rows each
- {"tool":"report","report":{...}}: your final answer; ends the investigation
- {"tool":"describe_table","table":"<name>"} / {"tool":"list_tables"}: only if you need them again
The step budget is small: batch related queries in one step and aggregate in SQL (per week, per entity).

How to investigate:
- Group a rate or count per week and per entity (supplier, store, product, segment...) and compare each
  entity with the others: the story is usually one entity or group that changes while the rest stay flat.
- A change starts on the first week of a SUSTAINED shift (the new level holds for the following weeks),
  not on a single noisy week before it; with ~30 records a week, a few percentage points are noise.
- If the same entity shifts again later (escalation, peak, recovery), that is another phase: report it
  as its own finding with its own start date.

Report rules:
- One finding per change point of a CAUSE: an entity or group whose behaviour changed. "entities" lists
  the concrete entity ids exactly as they appear in the data (or, for a group of records, the category
  values that define it, e.g. a customer segment or channel); "start" is the ISO date (YYYY-MM-DD) of the
  first week of that change; "supportingSql" is the query that shows it.
- Downstream consequences (more complaints, lost sales, lower revenue) go into the narrative, or into a
  finding only when they single out their own entities and start on their own date.
- Write narrative and claims in Czech.`;

const sqlOf = (a: { sql?: string | undefined; queries?: string[] | undefined }) =>
  [...(a.sql ? [a.sql] : []), ...(a.queries ?? [])].slice(0, MAX_QUERIES);

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
      if (!t) return { error: `Unknown table '${action.table}'. The tables are listed at the top.` };
      const sample = await sandbox.query(`SELECT * FROM main.${quoteIdent(t.table)} LIMIT 3`);
      return { table: t.table, columns: t.columns, sample };
    }
    case "run_sql": {
      const queries = sqlOf(action);
      if (queries.length === 0) return { error: 'run_sql needs "queries": ["SELECT ..."].' };
      const results = [];
      for (const sql of queries) {
        const r = await runDetectiveSql(sandbox, sql);
        const out = r.ok ? { rows: r.rows, truncated: r.truncated } : { error: r.error };
        results.push(
          queries.length === 1 ? out : { sql, result: clip(JSON.stringify(out), MAX_QUERY_RESULT_CHARS) },
        );
      }
      return queries.length === 1 ? results[0] : results;
    }
  }
}

function clip(text: string, max = MAX_RESULT_CHARS): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}… [truncated, ${text.length} chars total; aggregate or LIMIT]`;
}

/** What a careful analyst looks at first, computed by code so no LLM step is spent on it. */
export async function overviewOf(sandbox: Store): Promise<string> {
  const out: string[] = [];
  for (const t of await mainTables(sandbox)) {
    const q = quoteIdent(t.table);
    const [count] = await sandbox.query(`SELECT count(*)::DOUBLE AS n FROM main.${q}`);
    const ranges: string[] = [];
    for (const c of t.columns.filter((x) => isDateType(x.type))) {
      const col = quoteIdent(c.name);
      const [r] = await sandbox.query(
        `SELECT CAST(CAST(min(${col}) AS DATE) AS VARCHAR) AS lo, CAST(CAST(max(${col}) AS DATE) AS VARCHAR) AS hi FROM main.${q}`,
      );
      if (r?.lo) ranges.push(`${c.name}: ${String(r.lo)} … ${String(r.hi)}`);
    }
    const sample = await sandbox.query(`SELECT * FROM main.${q} LIMIT 2`);
    out.push(
      [
        `### ${t.table} (rows: ${String(Number(count?.n ?? 0))})`,
        `columns: ${t.columns.map((c) => `${c.name} ${c.type}`).join(", ")}`,
        ...(ranges.length ? [`dates: ${ranges.join("; ")}`] : []),
        `sample: ${clip(JSON.stringify(sample), 600)}`,
      ].join("\n"),
    );
  }
  return out.join("\n\n");
}

function promptOf(overview: string, transcript: string[], budgetLeft: number, final: boolean): string {
  const history = transcript.length ? transcript.join("\n\n") : "(nothing yet)";
  const ask = final
    ? "The step budget is used up. Write your final report now from what you found."
    : budgetLeft === 1
      ? "Steps left: 1. Report now unless one more batch of queries is essential."
      : `Steps left: ${budgetLeft}. Choose the next action.`;
  return `## Tables\n\n${overview}\n\n## Investigation so far\n\n${history}\n\n## Next\n\n${ask}`;
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
  signal?.throwIfAborted();
  const overview = await overviewOf(sandbox);

  for (let step = 1; step <= maxSteps; step++) {
    signal?.throwIfAborted();
    const { action } = await llm.object({
      schemaName: "detective_step",
      schema: DetectiveStep,
      instructions: INSTRUCTIONS,
      prompt: promptOf(overview, transcript, maxSteps - step + 1, false),
    });
    if (action.tool === "report") return action.report;
    if (action.tool === "run_sql")
      for (const sql of sqlOf(action)) onEvent?.({ type: "log", message: `SQL: ${sql}` });
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
    prompt: promptOf(overview, transcript, 0, true),
  });
}
