/**
 * Generate a run and persist it: @s2d/noiser `generate()` -> @s2d/dataer `writeRun()`.
 * Shared by `POST /runs` and `pnpm gen`. File: out/<scenarioId>/<seed>-<scenarioHash8>.duckdb (SPEC §3.C).
 */
import { join } from "node:path";
import { generate, type RunOptions } from "@s2d/noiser";
import { mergeTables, writeRun } from "@s2d/dataer";
import type { CompileError } from "@s2d/schema/api";
import type { RunMeta } from "@s2d/schema/run";

export interface RunSummary {
  dbPath: string;
  meta: RunMeta;
  order: string[];
  tables: { name: string; visibility: "observed" | "ground_truth"; rows: number }[];
}

export type GenerateRunResult = ({ ok: true } & RunSummary) | { ok: false; errors: CompileError[] };

export async function generateRun(
  outDir: string,
  raw: unknown,
  opts: RunOptions = {},
): Promise<GenerateRunResult> {
  const result = generate(raw, opts);
  if (!result.ok) return result;
  const { meta } = result.run;
  const dbPath = join(outDir, meta.scenarioId, `${meta.seed}-${meta.scenarioHash.slice(0, 8)}.duckdb`);
  await writeRun(dbPath, result.run);
  return {
    ok: true,
    dbPath,
    meta,
    order: result.order,
    tables: mergeTables(result.run.tables).map((t) => ({
      name: t.name,
      visibility: t.visibility,
      rows: t.rows.length,
    })),
  };
}
