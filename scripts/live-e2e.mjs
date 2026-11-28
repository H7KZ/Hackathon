#!/usr/bin/env node
/**
 * Live end-to-end harness: drives real API sessions through the whole workflow and writes a report.
 *
 *   node scripts/live-e2e.mjs --api http://localhost:4400 --cases scripts/live-cases.json [--only id,id] [--out out/live-e2e]
 *
 * Per case: POST /sessions → draft (A1–A4) → approve with the UI's default settings → evidence +
 * tables → what-if ×2 (the UI's suggested questions) → compare → detective. Repair loops, errors and
 * timings come from runs/<session>/events.jsonl (same machine as the API). No dependencies.
 * Calls a paid LLM unless the API runs with LLM_OFFLINE=1.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    api: { type: "string", default: "http://localhost:4000" },
    cases: { type: "string", default: "scripts/live-cases.json" },
    only: { type: "string" },
    out: { type: "string", default: "out/live-e2e" },
    runs: { type: "string", default: "runs" },
    cache: { type: "string", default: ".cache/llm" },
    "no-whatif": { type: "boolean", default: false },
    "no-detect": { type: "boolean", default: false },
  },
});
const say = (line) => process.stdout.write(line + "\n");
const API = values.api.replace(/\/$/, "");
const ROOT = process.cwd();
const RUNS = resolve(ROOT, values.runs);
const CACHE = resolve(ROOT, values.cache);
/** The questions the UI offers after a dataset (services/frontend/lib/chat/liveSource.ts). */
const WHAT_IFS = ["Co kdyby byl dopad poloviční?", "Co kdyby se změna stala o měsíc později?"];
/** What "Generovat data" sends with untouched editor defaults (services/frontend/lib/chat/config.ts). */
const uiSettings = (expectationIds) => ({
  seed: 42,
  scale: 1,
  noise: { missing: 2, duplicates: 1, hourJitter: true },
  expectations: expectationIds,
});

const cases = JSON.parse(readFileSync(resolve(ROOT, values.cases), "utf8")).filter(
  (c) => !values.only || values.only.split(",").includes(c.id),
);

/** Transient network failures (server busy in a synchronous engine run) are retried; GETs only. */
async function call(method, path, body, tries = method === "GET" ? 6 : 1) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (tries <= 1) throw err;
    say(`  (retry ${method} ${path}: ${String(err.cause?.code ?? err.cause ?? err)})`);
    await new Promise((r) => setTimeout(r, 3000));
    return call(method, path, body, tries - 1);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const BUSY = new Set(["drafting", "refining", "generating", "detecting"]);
async function settle(id, timeoutMs = 20 * 60_000) {
  const end = Date.now() + timeoutMs;
  await new Promise((r) => setTimeout(r, 300));
  for (;;) {
    const { body } = await call("GET", `/sessions/${id}`);
    if (!BUSY.has(body.status)) return body;
    if (Date.now() > end) throw new Error(`timeout in ${body.status}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const events = (id) => {
  const f = join(RUNS, id, "events.jsonl");
  return existsSync(f)
    ? readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
};
const cacheCount = () =>
  existsSync(CACHE) ? readdirSync(CACHE).filter((f) => f.endsWith(".json")).length : 0;

/** One phase: send a command, wait for the session to settle, collect what happened. */
async function phase(id, name, cmd) {
  const t0 = Date.now();
  const calls0 = cacheCount();
  const seq0 = events(id).at(-1)?.seq ?? 0;
  const sent = cmd ? await call("POST", `/sessions/${id}/commands`, cmd) : { status: 201 };
  const state = sent.status < 300 ? await settle(id) : (await call("GET", `/sessions/${id}`)).body;
  const evs = events(id).filter((e) => e.seq > seq0);
  const loops = evs
    .filter((e) => e.type === "cascade" && e.event.type === "loop.iteration")
    .map((e) => ({
      step: e.event.step,
      n: e.event.n,
      ok: e.event.ok,
      feedback: e.event.feedback
        .slice(0, 4)
        .map((f) => (typeof f === "string" ? f : `${f.path}: ${f.message}`)),
    }));
  const steps = evs
    .filter((e) => e.type === "cascade" && e.event.type === "step.done")
    .map((e) => `${e.event.step}${e.event.cached ? " (cache)" : ""}`);
  const sql = evs.filter(
    (e) => e.type === "cascade" && e.event.type === "log" && e.event.message.startsWith("SQL"),
  );
  const errors = evs.filter((e) => e.type === "error").map((e) => e.message);
  const r = {
    phase: name,
    httpStatus: sent.status,
    status: state.status,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    newLlmCalls: cacheCount() - calls0,
    steps,
    loops,
    sqlQueries: sql.length,
    errors,
  };
  say(
    `  ${name.padEnd(10)} ${String(r.status).padEnd(20)} ${String(r.seconds).padStart(6)} s  llm+${r.newLlmCalls}` +
      `${loops.length ? `  loops ${loops.map((l) => `${l.step}#${l.n}${l.ok ? "✓" : "✗"}`).join(",")}` : ""}` +
      `${errors.length ? `  ERR ${errors[0].slice(0, 160)}` : ""}`,
  );
  return r;
}

async function runCase(c) {
  say(`\n▶ ${c.id} (${c.design ?? "server default"})`);
  const t0 = Date.now();
  const report = { id: c.id, company: c.company, story: c.story, phases: [] };
  const created = await call("POST", "/sessions", { company: c.company, story: c.story });
  if (created.status !== 201) return { ...report, fatal: `POST /sessions → ${created.status}` };
  const id = created.body.sessionId;
  report.sessionId = id;
  report.phases.push(await phase(id, "draft"));
  if (report.phases[0].status !== "awaiting_refinement") return finish();

  const story = (await call("GET", `/sessions/${id}/artifacts/04_story`)).body.value;
  report.story04 = {
    storyPoints: story.storyPoints.map((p) => ({
      id: p.id,
      phase: p.phase,
      start: p.start,
      title: p.title,
      entity: p.entity?.ids,
    })),
    curves: story.curves.map((cv) => ({ id: cv.id, baseline: cv.baseline, segments: cv.segments.length })),
    expectations: story.expectations.map((e) => e.id),
  };
  report.phases.push(
    await phase(id, "approve", {
      type: "approve",
      settings: uiSettings(story.expectations.map((e) => e.id)),
    }),
  );
  // like pressing "Generovat data" again: A5 resumes from its last rejected attempt (attempts 6-10)
  if (report.phases.at(-1).status === "awaiting_refinement")
    report.phases.push(
      await phase(id, "approve#2", {
        type: "approve",
        settings: uiSettings(story.expectations.map((e) => e.id)),
      }),
    );
  if (report.phases.at(-1).status !== "ready") return finish();

  // dataset ids are dat1, dat2, … (d1, d2 before run 5): read the first one from the session
  const first = (await call("GET", `/sessions/${id}`)).body.datasets?.[0]?.id ?? "dat1";
  const ev = (await call("GET", `/sessions/${id}/datasets/${first}/evidence`)).body;
  const tables = (await call("GET", `/sessions/${id}/datasets/${first}/tables`)).body.tables ?? [];
  const scenario = JSON.parse(readFileSync(join(RUNS, id, "datasets", first, "scenario.json"), "utf8"));
  report.dataset = {
    tables: tables.map((t) => `${t.name}:${t.rows}`),
    rows: tables.reduce((n, t) => n + t.rows, 0),
    series: ev.series.length,
    expectations: ev.expectations.map((e) => ({
      id: e.id,
      pass: e.pass,
      before: e.before,
      after: e.after,
      relChange: e.relChange === null ? null : Math.round(e.relChange * 1000) / 1000,
      ...(e.error && { error: e.error }),
    })),
    passed: `${ev.expectations.filter((e) => e.pass).length}/${ev.expectations.length}`,
    noise: scenario.noise ? Object.keys(scenario.noise) : [],
    processes: scenario.processes.length,
    entities: scenario.entities.map((e) => e.name),
  };
  say(`  evidence   ${report.dataset.passed} pass, ${tables.length} tables, ${report.dataset.rows} rows`);

  if (!values["no-whatif"]) {
    report.whatIf = [];
    for (const q of WHAT_IFS) {
      const p = await phase(id, "what_if", { type: "what_if", from: first, question: q });
      report.phases.push(p);
      const st = (await call("GET", `/sessions/${id}`)).body;
      const ds = st.datasets.find((d) => d.question === q);
      if (!ds) {
        report.whatIf.push({ question: q, ok: false, error: p.errors[0] ?? st.error });
        continue;
      }
      const diff = (await call("GET", `/sessions/${id}/datasets/${ds.id}/compare/${first}`)).body.diff ?? [];
      const ev2 = (await call("GET", `/sessions/${id}/datasets/${ds.id}/evidence`)).body;
      const changed = diff
        .filter((d) => d.delta)
        .sort((a, b) => Math.abs(b.relChange ?? 0) - Math.abs(a.relChange ?? 0));
      report.whatIf.push({
        question: q,
        ok: true,
        datasetId: ds.id,
        seed: ds.seed,
        evidencePassed: `${ev2.expectations.filter((e) => e.pass).length}/${ev2.expectations.length}`,
        topChanges: changed
          .slice(0, 5)
          .map((d) => `${d.metric} ${d.relChange === null ? "" : (d.relChange * 100).toFixed(1) + " %"}`),
        unchangedMetrics: diff.length - changed.length,
      });
    }
  }
  if (!values["no-detect"]) {
    report.phases.push(await phase(id, "detect", { type: "detect", datasetId: first }));
    const det = (await call("GET", `/sessions/${id}/datasets/${first}/detective`)).body.result;
    report.detective = det
      ? {
          recall: det.score.recall,
          precision: det.score.precision,
          findings: det.report.findings.map((f) => `${f.start} ${f.claim} [${f.entities.join(", ")}]`),
          narrative: det.report.narrative,
        }
      : null;
    if (det)
      say(`  detective  recall ${det.score.recall.toFixed(2)}, precision ${det.score.precision.toFixed(2)}`);
  }
  return finish();

  function finish() {
    report.totalSeconds = Math.round((Date.now() - t0) / 1000);
    report.llmCalls = report.phases.reduce((n, p) => n + p.newLlmCalls, 0);
    return report;
  }
}

mkdirSync(resolve(ROOT, values.out), { recursive: true });
const health = await call("GET", "/health").catch(() => null);
if (!health || health.status !== 200) {
  console.error(`API not reachable at ${API}`);
  process.exit(2);
}
const results = [];
for (const c of cases) {
  try {
    results.push(await runCase(c));
  } catch (err) {
    results.push({ id: c.id, fatal: String(err) });
    say(`  FATAL ${String(err)}`);
  }
  const file = resolve(ROOT, values.out, `report-${new URL(API).port}.json`);
  writeFileSync(file, JSON.stringify({ api: API, finishedAt: new Date().toISOString(), results }, null, 2));
}
say(`\nreport: ${values.out}/report-${new URL(API).port}.json`);
