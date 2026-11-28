/**
 * `pnpm demo:record [id...]`: runs every demo case (scenarios/demo/*.json) through the real orchestrator
 * with the demo ports and stores each session as a bundle the UI replays offline
 * (services/frontend/public/demo/<id>.json + index.json). See docs/demo-data.md.
 *
 * A case is rejected (nothing written) when its dataset breaks referential integrity, a hypothesis
 * fails, or a detective finding's SQL does not run.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatasetEvidence, SessionCommand, SessionEvent } from "@s2d/schema/api";
import { DemoBundle, DemoIndex, type DemoIndexEntry } from "@s2d/schema/demo";
import { demoCascadePort, demoDataerPort, loadDemoCases, type LoadedCase } from "../adapters/demo";
import { noiserPort } from "../adapters/noiser";
import { createOrchestrator, type Orchestrator } from "../orchestrator";

/** What "Generovat data" sends with the UI defaults (lib/chat/config.ts DEFAULT_CONFIG, auto period). */
export const UI_DEFAULT_SETTINGS = {
  seed: 42,
  scale: 1,
  noise: { missing: 2, duplicates: 1, hourJitter: true },
} as const;

/**
 * A `ts` column (noise hourJitter) repeats the day of the table's own date column; the UI never plots
 * its series when the table has another date column (liveMapping pickSeries), so the bundle leaves it out.
 */
export function pruneSeries(ev: DatasetEvidence): DatasetEvidence {
  const dates = new Map<string, Set<string>>();
  for (const s of ev.series) dates.set(s.table, (dates.get(s.table) ?? new Set()).add(s.dateColumn));
  return {
    ...ev,
    series: ev.series.filter((s) => s.dateColumn !== "ts" || (dates.get(s.table)?.size ?? 0) < 2),
  };
}

/** Rows kept per table preview; the UI asks for fewer and the replay slices. */
const PREVIEW_ROWS = 25;

export interface RecordOptions {
  scenariosDir: string;
  /** services/frontend/public */
  publicDir: string;
  ids?: string[];
  log?: (line: string) => void;
}

async function run(orch: Orchestrator, id: string, cmd: SessionCommand): Promise<void> {
  const res = orch.command(id, cmd);
  if (res.errors?.length) throw new Error(`${cmd.type}: ${res.errors.map((e) => e.message).join("; ")}`);
  await orch.idle(id);
  const state = orch.get(id);
  if (state.error) throw new Error(`${cmd.type}: ${state.error}`);
}

export async function recordCase(c: LoadedCase, publicDir: string, log: (l: string) => void) {
  const runsDir = mkdtempSync(join(tmpdir(), "s2d-demo-"));
  const cases = [c];
  const orch = createOrchestrator({
    ports: { cascade: demoCascadePort(cases), noiser: noiserPort(), dataer: demoDataerPort(cases) },
    runsDir,
  });
  try {
    const { sessionId: id } = await orch.create(c.demo.input);
    await orch.idle(id);
    const cut = () => orch.events(id).at(-1)?.seq ?? 0;
    const draftEnd = cut();
    const expectations = c.scenario.expectations.map((e) => e.id);
    await run(orch, id, { type: "approve", settings: { ...UI_DEFAULT_SETTINGS, expectations } });
    const approveEnd = cut();
    const whatIfEnds: { question: string; datasetId: string; end: number }[] = [];
    for (const w of c.demo.whatIfs) {
      await run(orch, id, { type: "what_if", question: w.question, from: "dat1" });
      const datasetId = orch.get(id).datasets.at(-1)?.id ?? "";
      whatIfEnds.push({ question: w.question, datasetId, end: cut() });
    }
    const detectEnds: { datasetId: string; end: number }[] = [];
    for (const datasetId of Object.keys(c.demo.detective)) {
      await run(orch, id, { type: "detect", datasetId });
      detectEnds.push({ datasetId, end: cut() });
    }

    const all = orch.events(id);
    // wall-clock `at` dropped: the replay paces events itself, and re-recording gives the same bundle
    const slice = (from: number, to: number): SessionEvent[] =>
      all.filter((e) => e.seq > from && e.seq <= to).map(({ at: _at, ...e }) => e);
    const state = orch.get(id);
    const responses: Record<string, unknown> = { "/labels": { labels: orch.labels(id) } };
    for (const name of ["01_company", "02_model", "03_influences", "04_story"] as const)
      responses[`/artifacts/${name}`] = { name, value: orch.artifact(id, name) };
    let rows = 0;
    let tableCount = 0;
    for (const d of state.datasets) {
      const ev = await orch.evidence(id, d.id);
      if (d.id === "dat1") {
        const failed = ev.expectations.filter((e) => !e.pass);
        if (failed.length) throw new Error(`dat1: hypotheses fail: ${failed.map((e) => e.id).join(", ")}`);
      }
      const tables = await orch.tables(id, d.id);
      if (d.id === "dat1") {
        rows = tables.reduce((n, t) => n + t.rows, 0);
        tableCount = tables.length;
      }
      // entity names are the same in every dataset of a case (same scenario entities, same seed)
      const labels = orch.labels(id, d.id);
      if (JSON.stringify(labels) !== JSON.stringify(orch.labels(id)))
        responses[`/labels?dataset=${d.id}`] = { labels };
      responses[`/datasets/${d.id}/evidence`] = pruneSeries(ev);
      responses[`/datasets/${d.id}/scenario`] = { scenario: orch.scenario(id, d.id) };
      responses[`/datasets/${d.id}/tables`] = { tables };
      for (const t of tables)
        responses[`/datasets/${d.id}/tables/${t.name}`] = await orch.preview(id, d.id, t.name, PREVIEW_ROWS);
      responses[`/datasets/${d.id}/detective`] = { result: await orch.detective(id, d.id) };
      if (d.parent)
        responses[`/datasets/${d.id}/compare/${d.parent}`] = { diff: await orch.compare(id, d.id, d.parent) };
    }

    // the first dataset as a real download (what the export button of a live session would serve)
    const exportDir = join(publicDir, "demo", c.demo.id);
    mkdirSync(exportDir, { recursive: true });
    const xlsx = await orch.exportDataset(id, "dat1", "xlsx");
    copyFileSync(xlsx.file, join(exportDir, `${c.demo.id}_dat1.xlsx`));

    const det = responses["/datasets/dat1/detective"] as { result: { score: { recall: number } } | null };
    log(
      `${c.demo.id}: ${String(tableCount)} tables, ${rows.toLocaleString("cs-CZ")} rows, ${String(state.datasets.length)} datasets, detective recall ${String(det.result?.score.recall ?? "—")}`,
    );
    return DemoBundle.parse({
      version: 1,
      id: c.demo.id,
      title: c.demo.title,
      summary: c.demo.summary,
      tags: c.demo.tags,
      input: c.demo.input,
      stats: { tables: tableCount, rows, start: c.scenario.meta.start, end: c.scenario.meta.end },
      suggestions: c.demo.whatIfs.map((w) => w.question),
      draft: slice(0, draftEnd),
      approve: slice(draftEnd, approveEnd),
      whatIfs: whatIfEnds.map((w, i) => ({
        question: w.question,
        datasetId: w.datasetId,
        events: slice(i === 0 ? approveEnd : (whatIfEnds[i - 1]?.end ?? approveEnd), w.end),
      })),
      detect: detectEnds.map((d, i) => ({
        datasetId: d.datasetId,
        events: slice(
          i === 0 ? (whatIfEnds.at(-1)?.end ?? approveEnd) : (detectEnds[i - 1]?.end ?? 0),
          d.end,
        ),
      })),
      datasets: state.datasets,
      responses,
      exports: { dat1: { xlsx: `/demo/${c.demo.id}/${c.demo.id}_dat1.xlsx` } },
    });
  } finally {
    rmSync(runsDir, { recursive: true, force: true });
  }
}

export async function recordDemo(opts: RecordOptions): Promise<DemoIndexEntry[]> {
  const log = opts.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const cases = loadDemoCases(opts.scenariosDir);
  const outDir = join(opts.publicDir, "demo");
  mkdirSync(outDir, { recursive: true });
  const index: DemoIndexEntry[] = [];
  for (const c of cases) {
    const file = join(outDir, `${c.demo.id}.json`);
    let bundle: DemoBundle;
    if (!opts.ids?.length || opts.ids.includes(c.demo.id)) {
      bundle = await recordCase(c, opts.publicDir, log);
      writeFileSync(file, JSON.stringify(bundle));
    } else if (existsSync(file)) {
      bundle = DemoBundle.parse(JSON.parse(readFileSync(file, "utf8")));
    } else continue;
    const { id, title, summary, tags, input, stats } = bundle;
    index.push({ id, title, summary, tags, input, stats });
  }
  writeFileSync(
    join(outDir, "index.json"),
    JSON.stringify(DemoIndex.parse({ cases: index }), null, 2) + "\n",
  );
  return index;
}
