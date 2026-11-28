import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "@s2d/test-utils";
import { DiskCache } from "../../src/cache";

describe("DiskCache trace (which recordings a replay reads)", () => {
  it("appends the key of every hit to the trace file, misses are not listed", () => {
    const { dir, cleanup } = makeTempDir();
    try {
      const trace = join(dir, "trace.txt");
      const cache = new DiskCache(join(dir, "c"), trace);
      cache.set({ key: "k1", model: "m", schemaName: "s", output: 1 });
      expect(cache.get("k1")?.output).toBe(1);
      expect(cache.get("nope")).toBeUndefined();
      expect(readFileSync(trace, "utf8")).toBe("k1\n");
    } finally {
      cleanup();
    }
  });
});
