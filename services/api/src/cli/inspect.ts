/**
 * `pnpm evidence <db>`, `pnpm compare <dbA> <dbB>`, `pnpm detective <db>`: the dataer port on a finished DB.
 * Expectations come from a scenario: `--scenario <file>`, else `scenario.json` next to the DB
 * (the API layout runs/<session>/datasets/dN/), else only the daily series are printed.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compileScenario } from "@s2d/noiser";
import type { Expectation } from "@s2d/schema/evidence";
import type { Ports } from "../ports";

type Log = (line: string) => void;
const pct = (x: number | null) => (x === null ? "–" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} %`);

function expectationsFor(dbPath: string, scenarioFile?: string): Expectation[] | null {
  const file = scenarioFile ?? join(dirname(dbPath), "scenario.json");
  if (!existsSync(file)) return null;
  const res = compileScenario(JSON.parse(readFileSync(file, "utf8")));
  if (!res.ok) throw new Error(`${file}: ${res.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
  return res.scenario.expectations;
}

export async function evidenceCmd(
  dataer: Ports["dataer"],
  dbPath: string,
  opts: { scenario?: string; log?: Log } = {},
): Promise<boolean> {
  const log = opts.log ?? console.log;
  if (!existsSync(dbPath)) throw new Error(`No database at ${dbPath}`);
  const expectations = expectationsFor(dbPath, opts.scenario);
  const ev = await dataer.evidence(dbPath, expectations ?? []);
  for (const t of await dataer.tables(dbPath)) log(`  ${t.name}: ${t.rows} rows`);
  log(`${ev.series.length} daily series`);
  if (!expectations) {
    log("no scenario.json next to the DB (use --scenario <file>): expectations skipped");
    return true;
  }
  for (const e of ev.expectations)
    log(
      `  ${e.pass ? "✓" : "✗"} ${e.id}: ${e.before ?? "–"} → ${e.after ?? "–"} (${pct(e.relChange)})${e.error ? ` ${e.error}` : ""}`,
    );
  const passed = ev.expectations.filter((e) => e.pass).length;
  log(`${passed}/${ev.expectations.length} expectations pass`);
  return passed === ev.expectations.length;
}

export async function compareCmd(dataer: Ports["dataer"], dbA: string, dbB: string, log: Log = console.log) {
  const diff = await dataer.compare(dbA, dbB);
  const changed = diff.filter((d) => d.delta !== 0);
  for (const d of changed) log(`  ${d.metric}: ${d.a ?? "–"} → ${d.b ?? "–"} (${pct(d.relChange)})`);
  log(`${changed.length} of ${diff.length} metrics differ`);
}

export async function detectiveCmd(dataer: Ports["dataer"], dbPath: string, log: Log = console.log) {
  const { report, score } = await dataer.detective(dbPath, {
    onEvent: (e) => {
      if (e.type === "log") log(e.message);
    },
    signal: new AbortController().signal,
  });
  log(report.narrative);
  for (const f of report.findings) log(`  - ${f.start} ${f.claim} [${f.entities.join(", ")}]`);
  log(`recall ${score.recall.toFixed(2)}, precision ${score.precision.toFixed(2)}`);
}
