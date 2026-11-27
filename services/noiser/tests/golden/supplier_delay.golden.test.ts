/**
 * Golden tests: pinned hashes of every generated table for supplier_delay@seed42.
 * When the engine changes intentionally, regenerate with `UPDATE_GOLDEN=1 pnpm vitest run tests/golden`
 * and say why in the commit.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GeneratedTable, RunResult } from "@s2d/schema/run";
import { loadScenarioFixture } from "@s2d/test-utils";
import { generate } from "../../src/index";

const HASHES = join(import.meta.dirname, "supplier_delay.hashes.json");

function run(raw: unknown = loadScenarioFixture("supplier_delay"), seed = 42): RunResult {
  const result = generate(raw, { seed });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.run;
}

/** One hash per table name (tables written by several processes are concatenated, like writeRun). */
function hashes(tables: readonly GeneratedTable[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of [...new Set(tables.map((t) => t.name))].sort()) {
    const rows = tables.filter((t) => t.name === name).flatMap((t) => t.rows);
    out[name] = createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
  }
  return out;
}

const base = run();
const rows = (name: string) => base.tables.filter((t) => t.name === name).flatMap((t) => t.rows);

describe("golden: supplier_delay@42", () => {
  it("determinism: two runs produce identical table hashes", () => {
    expect(hashes(run().tables)).toEqual(hashes(base.tables));
    expect(run().meta.scenarioHash).toBe(base.meta.scenarioHash);
  });

  it("stream isolation: changing late_prob.to leaves purchase_attempt identical", () => {
    const raw = loadScenarioFixture("supplier_delay") as {
      curves: { id: string; segments: { to: number }[] }[];
    };
    const seg = raw.curves.find((c) => c.id === "late_prob")?.segments[0];
    if (!seg) throw new Error("fixture changed");
    seg.to = 0.3;
    const changed = hashes(run(raw).tables);
    const before = hashes(base.tables);
    for (const t of ["purchase_attempt", "supplier", "product", "store", "customer"]) {
      expect(changed[t], t).toBe(before[t]);
    }
    expect(changed.delivery).not.toBe(before.delivery);
  });

  it("integrity: every FK resolves and stock never goes negative", () => {
    const ids = (name: string) => new Set(rows(name).map((r) => r.id));
    const fks: [string, string, string][] = [
      ["product", "supplier_id", "supplier"],
      ["customer", "home_store_id", "store"],
      ["delivery", "store_id", "store"],
      ["delivery", "product_id", "product"],
      ["delivery", "supplier_id", "supplier"],
      ["purchase_attempt", "customer_id", "customer"],
      ["purchase_attempt", "store_id", "store"],
      ["purchase_attempt", "product_id", "product"],
      ["sale", "customer_id", "customer"],
      ["sale", "store_id", "store"],
      ["sale", "product_id", "product"],
      ["lost_sale", "attempt_id", "purchase_attempt"],
      ["lost_sale", "customer_id", "customer"],
      ["complaint", "customer_id", "customer"],
      ["complaint", "store_id", "store"],
      ["complaint", "product_id", "product"],
      ["stock_daily", "store_id", "store"],
      ["stock_daily", "product_id", "product"],
    ];
    for (const [table, column, target] of fks) {
      const pk = ids(target);
      const dangling = rows(table).filter((r) => !pk.has(r[column] ?? null));
      expect(dangling.length, `${table}.${column} -> ${target}`).toBe(0);
    }
    for (const t of base.tables)
      expect(new Set(t.rows.map((r) => r.id ?? r)).size, t.name).toBe(t.rows.length);
    expect(rows("stock_daily").every((r) => (r.value as number) >= 0)).toBe(true);
  });

  it("pinned hashes match tests/golden/supplier_delay.hashes.json", () => {
    const actual = hashes(base.tables);
    if (process.env.UPDATE_GOLDEN === "1") {
      writeFileSync(HASHES, `${JSON.stringify(actual, null, 2)}\n`);
    }
    expect(actual).toEqual(JSON.parse(readFileSync(HASHES, "utf8")));
  });
});
