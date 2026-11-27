/**
 * CLI entry: `pnpm <command> ...` from the repo root (see root package.json).
 *   gen <scenario.json> [--seed N] [--scale X]
 *   cascade "<story>" "<company>"
 *   evidence <db> | detective <db> | compare <dbA> <dbB>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { compileScenario } from "@s2d/noiser";
import { createLlm } from "@s2d/llm";
import { runCascade } from "@s2d/cascade";
import { loadConfig } from "../config";

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
      const result = compileScenario(JSON.parse(readFileSync(resolve(cfg.root, file), "utf8")));
      if (!result.ok) {
        for (const e of result.errors) console.error(`${e.path}: ${e.message}`);
        return 1;
      }
      console.log(`compiled ${result.scenario.meta.id}: ${result.order.join(" -> ")}`);
      console.log(`seed=${values.seed ?? result.scenario.meta.seed} scale=${values.scale ?? 1}`);
      console.error("engine not implemented yet (services/noiser/src/engine/run.ts)");
      return 2;
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
