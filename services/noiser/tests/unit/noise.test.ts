import { describe, expect, it } from "vitest";
import type { Row } from "@s2d/schema/run";
import { compileScenario } from "../../src/compiler/validate";
import { runScenario } from "../../src/engine/run";
import { BASE, mini, table } from "../support/scenarios";

const processes = [
  {
    type: "arrival",
    id: "visit",
    table: "visit",
    per: ["store"],
    rate: 5,
    fields: {
      id: { gen: "id" },
      store_id: { gen: "ref", path: "key.store" },
      amount: { gen: "uniformInt", min: 1, max: 9 },
      date: { gen: "ref", path: "day" },
    },
  },
  {
    type: "derive",
    id: "refund",
    table: "refund",
    source: "visit",
    p: 0.5,
    visibility: "ground_truth",
    fields: { id: { gen: "id" }, visit_id: { gen: "ref", path: "source.id" } },
  },
];
const withNoise = (noise: unknown) => mini({ processes, noise });
const clean = runScenario(withNoise(undefined)).tables;
const strip = (rows: Row[], col: string) => rows.map(({ [col]: _, ...rest }) => rest);

describe("noise", () => {
  it("missing: nulls ~p of one observed column and leaves everything else as in the clean run", () => {
    const { tables } = runScenario(withNoise({ missing: { "visit.amount": 0.3 } }));
    const visits = table(tables, "visit");
    const share = visits.filter((r) => r.amount === null).length / visits.length;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.35);
    expect(strip(visits, "amount")).toEqual(strip(table(clean, "visit"), "amount"));
    expect(table(tables, "refund")).toEqual(table(clean, "refund"));
    expect(table(tables, "store")).toEqual(table(clean, "store"));
  });

  it("duplicates: inserts exact copies right after ~p of the rows", () => {
    const visits = table(runScenario(withNoise({ duplicates: { visit: 0.2 } })).tables, "visit");
    const n = table(clean, "visit").length;
    expect(visits.length / n).toBeGreaterThan(1.15);
    expect(visits.length / n).toBeLessThan(1.25);
    const deduped = visits.filter((r, i) => i === 0 || r.id !== visits[i - 1]?.id);
    expect(deduped).toEqual(table(clean, "visit"));
  });

  it("hourJitter: adds `ts` on the record's day (08:00–19:59) to observed process tables only", () => {
    const { tables } = runScenario(withNoise({ hourJitter: true }));
    const visit = tables.find((t) => t.name === "visit");
    expect(visit?.columns).toEqual(["id", "store_id", "amount", "date", "ts"]);
    for (const r of visit?.rows ?? []) {
      expect(String(r.ts)).toMatch(/^\d{4}-\d{2}-\d{2} (0[89]|1\d):[0-5]\d:[0-5]\d$/);
      expect(String(r.ts).slice(0, 10)).toBe(r.date);
    }
    expect(table(tables, "refund")).toEqual(table(clean, "refund")); // ground_truth
    expect(table(tables, "store")).toEqual(table(clean, "store")); // entity
    expect(strip(visit?.rows ?? [], "ts")).toEqual(table(clean, "visit"));
  });

  it("is deterministic and isolated per table/column", () => {
    const a = runScenario(withNoise({ missing: { "visit.amount": 0.3, "visit.store_id": 0.1 } })).tables;
    const b = runScenario(withNoise({ missing: { "visit.amount": 0.3, "visit.store_id": 0.5 } })).tables;
    expect(
      runScenario(withNoise({ missing: { "visit.amount": 0.3, "visit.store_id": 0.1 } })).tables,
    ).toEqual(a);
    const amounts = (t: typeof a) => table(t, "visit").map((r) => r.amount);
    expect(amounts(b)).toEqual(amounts(a));
  });
});

describe("noise — compiler", () => {
  const errorsOf = (noise: unknown) => {
    const r = compileScenario({ ...BASE, processes, noise });
    return r.ok ? [] : r.errors;
  };

  it("accepts observed tables and columns", () => {
    expect(errorsOf({ missing: { "visit.amount": 0.1, "store.id": 0 }, duplicates: { visit: 0.1 } })).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'noise.missing["store.id"]' })]),
    );
    expect(
      errorsOf({ missing: { "visit.amount": 0.1 }, duplicates: { visit: 0.1 }, hourJitter: true }),
    ).toEqual([]);
  });

  it("rejects unknown tables/columns, ground_truth tables and id columns, listing valid targets", () => {
    const errors = errorsOf({
      missing: { "visit.price": 0.1, "nope.x": 0.1, "refund.visit_id": 0.1, "visit.id": 0.1 },
      duplicates: { refund: 0.1 },
    });
    expect(errors.map((e) => e.path)).toEqual([
      'noise.missing["visit.price"]',
      'noise.missing["nope.x"]',
      'noise.missing["refund.visit_id"]',
      'noise.missing["visit.id"]',
      'noise.duplicates["refund"]',
    ]);
    expect(errors[0]?.message).toMatch(/"amount"/);
    expect(errors[1]?.message).toMatch(/"visit"/);
    expect(errors[2]?.message).toMatch(/ground_truth/);
  });

  it("rejects hourJitter when an observed process table already has a `ts` column", () => {
    const clash = structuredClone(processes);
    (clash[0]?.fields as Record<string, unknown>).ts = { gen: "const", value: 1 };
    const r = compileScenario({ ...BASE, processes: clash, noise: { hourJitter: true } });
    expect(r.ok ? [] : r.errors).toEqual([expect.objectContaining({ path: "noise.hourJitter" })]);
  });
});
