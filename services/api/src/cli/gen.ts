/**
 * `pnpm gen`: scenario.json -> compile -> engine -> DuckDB -> expectations.
 * Writes <outDir>/<scenario_id>_seed<N>.duckdb.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compileScenario, runScenario } from "@s2d/noiser";
import { dataerPort } from "../adapters/dataer";

export interface GenOptions {
  file: string;
  outDir: string;
  seed?: number;
  scale?: number;
  log?: (line: string) => void;
}

export interface GenResult {
  ok: boolean;
  dbPath?: string;
}

export async function gen(opts: GenOptions): Promise<GenResult> {
  const log = opts.log ?? console.log;
  const result = compileScenario(JSON.parse(readFileSync(opts.file, "utf8")));
  if (!result.ok) {
    for (const e of result.errors) log(`${e.path}: ${e.message}`);
    return { ok: false };
  }
  const { scenario } = result;
  log(`compiled ${scenario.meta.id}: ${result.order.join(" -> ")}`);

  const seed = opts.seed ?? scenario.meta.seed;
  const run = runScenario(scenario, { seed, ...(opts.scale === undefined ? {} : { scale: opts.scale }) });
  for (const t of run.tables) log(`  ${t.name}: ${t.rows.length} rows`);

  mkdirSync(opts.outDir, { recursive: true });
  const dbPath = join(opts.outDir, `${scenario.meta.id}_seed${seed}.duckdb`);
  const dataer = dataerPort();
  await dataer.store(run, dbPath);
  log(`wrote ${dbPath}`);

  const { expectations } = await dataer.evidence(dbPath, scenario.expectations);
  for (const e of expectations) log(`  ${e.pass ? "✓" : "✗"} ${e.id}`);
  const ok = expectations.every((e) => e.pass);
  log(`${expectations.filter((e) => e.pass).length}/${expectations.length} expectations pass`);
  return { ok, dbPath };
}
