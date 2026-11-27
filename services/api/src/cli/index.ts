/**
 * CLI entry: `pnpm <command> ...` from the repo root (see root package.json).
 *   gen <scenario.json> [--seed N] [--scale X]
 *   cascade "<story>" "<company>"
 *   evidence <db> | detective <db> | compare <dbA> <dbB>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createLlm } from "@s2d/llm";
import { runCascade } from "@s2d/cascade";
import { loadConfig } from "../config";
import { generateRun } from "../runs";

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
      const seed = values.seed === undefined ? undefined : Number(values.seed);
      const scale = values.scale === undefined ? undefined : Number(values.scale);
      const raw: unknown = JSON.parse(readFileSync(resolve(cfg.root, file), "utf8"));
      const result = await generateRun(cfg.outDir, raw, { seed, scale });
      if (!result.ok) {
        for (const e of result.errors) console.error(`${e.path}: ${e.message}`);
        return 1;
      }
      console.log(`${result.meta.scenarioId} seed=${result.meta.seed}: ${result.order.join(" -> ")}`);
      for (const t of result.tables)
        console.log(`  ${t.visibility === "observed" ? "main" : "truth"}.${t.name}: ${t.rows} rows`);
      console.log(result.dbPath);
      return 0;
    }
    case "cascade": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { run: { type: "string" } },
      });
      const [story, company] = positionals;
      if (!story || !company) return usage('cascade "<story>" "<company>" [--run <runId>]');
      // --run <id> resumes an existing run: hand-edited artifacts are kept, later steps recomputed
      const runId = values.run ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      const res = await runCascade(
        { story, company },
        {
          llm: createLlm(),
          runsDir: cfg.runsDir,
          runId,
          onStep: (n, st) => {
            console.log(`${n}: ${st}`);
          },
        },
      );
      console.log(`artifacts in ${res.dir}`);
      return 0;
    }
    case "evidence":
    case "detective":
    case "compare":
      console.error(`${command}: not implemented yet`);
      return 2;
    default:
      return usage("<gen|cascade|evidence|detective|compare> ...");
  }
}

function usage(text: string): number {
  console.error(`usage: pnpm ${text}`);
  return 64;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
