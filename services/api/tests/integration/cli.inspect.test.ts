import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT, makeTempDir } from "@s2d/test-utils";
import { dataerPort } from "../../src/adapters/dataer";
import { gen } from "../../src/cli/gen";
import { compareCmd, evidenceCmd } from "../../src/cli/inspect";

const tmp = makeTempDir("cli-inspect");
const scenario = join(REPO_ROOT, "scenarios/supplier_delay.json");
let db42 = "";
let db7 = "";
beforeAll(async () => {
  const quiet = () => undefined;
  db42 = (await gen({ file: scenario, outDir: tmp.dir, seed: 42, log: quiet })).dbPath ?? "";
  db7 = (await gen({ file: scenario, outDir: tmp.dir, seed: 7, log: quiet })).dbPath ?? "";
}, 60_000);
afterAll(() => {
  tmp.cleanup();
});

describe("cli evidence / compare", () => {
  it("evidence with --scenario prints tables and all expectations pass", async () => {
    const lines: string[] = [];
    const ok = await evidenceCmd(dataerPort(), db42, { scenario, log: (l) => lines.push(l) });
    expect(ok).toBe(true);
    expect(lines.some((l) => /sale: \d+ rows/.test(l))).toBe(true);
    expect(lines.at(-1)).toMatch(/^(\d+)\/\1 expectations pass$/);
  });

  it("evidence without a scenario prints only series", async () => {
    const lines: string[] = [];
    expect(await evidenceCmd(dataerPort(), db42, { log: (l) => lines.push(l) })).toBe(true);
    expect(lines.at(-1)).toContain("expectations skipped");
  });

  it("compare prints the metrics that differ between two seeds", async () => {
    const lines: string[] = [];
    await compareCmd(dataerPort(), db42, db7, (l) => lines.push(l));
    expect(lines.at(-1)).toMatch(/^\d+ of \d+ metrics differ$/);
    expect(lines.length).toBeGreaterThan(1);
  });
});
