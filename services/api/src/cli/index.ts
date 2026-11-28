/**
 * CLI entry: `pnpm <command> ...` from the repo root (see root package.json).
 *   gen <scenario.json> [--seed N] [--scale X]
 *   cascade "<story>" "<company>"
 *   evidence <db> | detective <db> | compare <dbA> <dbB>
 *   demo-record [id...]   (offline UI demo bundles, docs/demo-data.md)
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createLlm } from "@s2d/llm";
import { runCascade, storyGate } from "@s2d/cascade";
import { loadConfig } from "../config";
import { dataerPort } from "../adapters/dataer";
import { recordDemo } from "../demo/record";
import { gen } from "./gen";
import { compareCmd, detectiveCmd, evidenceCmd } from "./inspect";

const [command, ...rest] = process.argv.slice(2);
const cfg = loadConfig();

async function main(): Promise<number> {
  switch (command) {
    case "gen": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { seed: { type: "string" }, scale: { type: "string" } },
      });
      const file = positionals[0];
      if (!file) return usage("gen <scenario.json> [--seed N] [--scale X]");
      const res = await gen({
        file: resolve(cfg.root, file),
        outDir: resolve(cfg.root, "out"),
        ...(values.seed === undefined ? {} : { seed: Number(values.seed) }),
        ...(values.scale === undefined ? {} : { scale: Number(values.scale) }),
      });
      return res.ok ? 0 : 1;
    }
    case "cascade": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { run: { type: "string" }, design: { type: "string" } },
      });
      const [story, company] = positionals;
      const design = values.design ?? process.env.CASCADE_DESIGN ?? "v1";
      if (!story || !company || (design !== "v1" && design !== "causal"))
        return usage('cascade "<story>" "<company>" [--run <runId>] [--design v1|causal]');
      // --run <id> resumes an existing run: hand-edited artifacts are kept, later steps recomputed
      const runId = values.run ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      const res = await runCascade(
        { story, company },
        {
          llm: createLlm(),
          runsDir: cfg.runsDir,
          runId,
          verify: storyGate,
          design,
          onEvent: (e) => {
            if (e.type === "step.done") console.log(`${e.step}: ${e.cached ? "cached" : "done"}`);
            else if (e.type === "loop.iteration")
              console.log(`${e.step} #${e.n}: ${e.ok ? "ok" : `${e.feedback.length} errors`}`);
            else if (e.type === "log") console.log(e.message);
          },
        },
      );
      console.log(`artifacts in ${res.dir}`);
      return 0;
    }
    case "evidence": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { scenario: { type: "string" } },
      });
      const db = positionals[0];
      if (!db) return usage("evidence <db> [--scenario <scenario.json>]");
      const ok = await evidenceCmd(dataerPort(), resolve(cfg.root, db), {
        ...(values.scenario === undefined ? {} : { scenario: resolve(cfg.root, values.scenario) }),
      });
      return ok ? 0 : 1;
    }
    case "compare": {
      const [a, b] = rest;
      if (!a || !b) return usage("compare <dbA> <dbB>");
      await compareCmd(dataerPort(), resolve(cfg.root, a), resolve(cfg.root, b));
      return 0;
    }
    case "detective": {
      const [db] = rest;
      if (!db) return usage("detective <db>");
      await detectiveCmd(dataerPort(), resolve(cfg.root, db));
      return 0;
    }
    case "demo-record": {
      await recordDemo({
        scenariosDir: cfg.scenariosDir,
        publicDir: resolve(cfg.root, "services/frontend/public"),
        ids: rest,
      });
      return 0;
    }
    default:
      return usage("<gen|cascade|evidence|detective|compare|demo-record> ...");
  }
}

function usage(text: string): number {
  console.error(`usage: pnpm ${text}`);
  return 64;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
