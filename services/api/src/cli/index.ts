/**
 * CLI entry: `pnpm <command> ...` from the repo root (see root package.json).
 *   gen <scenario.json> [--seed N] [--scale X]
 *   cascade "<story>" "<company>"
 *   evidence <db> | detective <db> | compare <dbA> <dbB>
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createLlm } from "@s2d/llm";
import { runCascade } from "@s2d/cascade";
import { loadConfig } from "../config";
import { gen } from "./gen";

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
