/**
 * Story gate for the A5 loop: a scenario that compiles is not enough, the story must show in the data.
 * Runs the engine at the scenario seed, stores the run (FK integrity), then on a sandbox runs the
 * expectations and checks that the baseline before the story is flat (no warm-up drift).
 * Errors go back to A5 like compile errors. Live run 2026-11-27 compiled first try and carried no story.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dailySeries, runExpectations, storeRun, withSandbox, type DailySeries } from "@s2d/dataer";
import { generateInWorker } from "@s2d/noiser";
import type { CompileError } from "@s2d/schema/api";
import type { Expectation, ExpectationResult } from "@s2d/schema/evidence";
import { Scenario } from "@s2d/schema/scenario";

/** Shortest baseline (days) worth checking, max relative drift between its halves, min rows/day. */
const MIN_BASELINE_DAYS = 28;
const MAX_DRIFT = 0.35;
const MIN_Z = 4;
const MIN_ROWS_PER_DAY = 2;

const fmt = (n: number) => String(Number.isInteger(n) ? n : Number(n.toPrecision(4)));
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export function formatExpectationFailure(
  e: Pick<Expectation, "id" | "description" | "check">,
  r: ExpectationResult,
): string {
  const needed =
    e.check.kind === "increase"
      ? `an increase of at least +${pct(e.check.minRelChange)}`
      : e.check.kind === "decrease"
        ? `a decrease of at least -${pct(e.check.minRelChange)}`
        : `to stay within ±${pct(e.check.minRelChange)}`;
  const measured =
    r.error !== undefined
      ? `the SQL failed: ${r.error}`
      : `before ${fmt(r.before ?? 0)}, after ${fmt(r.after ?? 0)}${
          r.relChange === null
            ? ""
            : ` (change ${r.relChange >= 0 ? "+" : ""}${(r.relChange * 100).toFixed(1)}%)`
        }`;
  return `Expectation "${e.id}" (${e.description}) failed: ${measured}; it needs ${needed}. The curves and expectations are fixed (from 04_story); change counts, rates, initial flow values or the process chain so the story lever reaches the measured table strongly enough.`;
}

/** Row-count series whose daily volume drifts between the two halves of the pre-story baseline. */
export function baselineDrift(series: DailySeries[], start: string, storyStart: string): CompileError[] {
  const errors: CompileError[] = [];
  const seen = new Set<string>();
  for (const s of series) {
    if (s.metric !== "rows" || seen.has(s.table)) continue;
    const pts = s.points.filter((p) => p.day >= start && p.day < storyStart);
    if (pts.length < MIN_BASELINE_DAYS) continue;
    const half = Math.floor(pts.length / 2);
    const mean = (xs: typeof pts) => xs.reduce((a, p) => a + p.value, 0) / xs.length;
    const first = pts.slice(0, half);
    const second = pts.slice(half);
    const a = mean(first);
    const b = mean(second);
    if (Math.max(a, b) < MIN_ROWS_PER_DAY) continue;
    // large (relative to the bigger half) AND clearly not Poisson noise (z-score of the two means)
    const z = Math.abs(b - a) / Math.sqrt(a / first.length + b / second.length);
    if (Math.abs(b - a) / Math.max(a, b) <= MAX_DRIFT || z <= MIN_Z) continue;
    seen.add(s.table);
    errors.push({
      path: `tables.${s.table}`,
      message: `Table "${s.table}" (by ${s.dateColumn}) averages ${a.toFixed(1)} rows/day in ${first[0]?.day}..${first.at(-1)?.day} but ${b.toFixed(1)} in ${second[0]?.day}..${second.at(-1)?.day}, before the story starts on ${storyStart}. The model is not in steady state, so a fake event appears without any curve. Make the baseline flat: start each flow near its steady level (raise its "initial" value) and balance inflow (deliveries, restocking) with outflow (demand).`,
    });
  }
  return errors;
}

export async function storyGate(raw: unknown): Promise<CompileError[]> {
  const gen = await generateInWorker(raw);
  if (!gen.ok) return gen.errors;
  const s = Scenario.parse(raw);
  const dir = mkdtempSync(join(tmpdir(), "s2d-gate-"));
  try {
    const db = join(dir, "gate.duckdb");
    try {
      await storeRun(db, gen.run);
    } catch (err) {
      return [
        {
          path: "processes",
          message: `Generated data breaks referential integrity: ${err instanceof Error ? err.message : String(err)}. Every derived record must reference an existing source id.`,
        },
      ];
    }
    return await withSandbox(
      db,
      async (sandbox) => {
        const results = await runExpectations(sandbox, s.expectations);
        const errors: CompileError[] = results.flatMap((r, i) => {
          const e = s.expectations[i];
          return r.pass || !e
            ? []
            : [{ path: `expectations[${i}]`, message: formatExpectationFailure(e, r) }];
        });
        const starts = s.curves.flatMap((c) => c.segments.map((seg) => seg.start)).sort();
        if (starts[0] !== undefined)
          errors.push(...baselineDrift(await dailySeries(sandbox), s.meta.start, starts[0]));
        return errors;
      },
      { tmpRoot: dir },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
