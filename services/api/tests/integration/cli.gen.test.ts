import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT, makeTempDir } from "@s2d/test-utils";
import { gen } from "../../src/cli/gen";

const tmp = makeTempDir("cli-gen");
afterAll(() => {
  tmp.cleanup();
});

describe("cli gen", () => {
  it("supplier_delay end to end: writes DuckDB and all expectations pass", async () => {
    const lines: string[] = [];
    const res = await gen({
      file: join(REPO_ROOT, "scenarios/supplier_delay.json"),
      outDir: tmp.dir,
      seed: 42,
      log: (l) => lines.push(l),
    });
    expect(res.ok).toBe(true);
    expect(res.dbPath).toBe(join(tmp.dir, "supplier_delay_seed42.duckdb"));
    expect(existsSync(res.dbPath ?? "")).toBe(true);
    expect(lines.some((l) => l.includes("expectations pass"))).toBe(true);
  });
});
