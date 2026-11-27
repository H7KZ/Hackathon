import { describe, expect, it } from "vitest";
import { guardSql } from "../../src/detective/tools";
import { scoreFindings } from "../../src/detective/score";

describe("guardSql (friendly pre-check; the sandbox is the security boundary)", () => {
  it("accepts a single read query and strips the trailing semicolon", () => {
    expect(guardSql("SELECT * FROM main.sale;")).toEqual({ ok: true, sql: "SELECT * FROM main.sale" });
  });

  it.each([
    ["DELETE FROM main.sale", /read queries/],
    ["SELECT 1; SELECT 2", /one statement/],
    ["   ", /Empty/],
  ])("rejects %j", (sql, reason) => {
    const r = guardSql(sql);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });
});

describe("scoreFindings", () => {
  const truth = [{ id: "sp1", entityIds: ["SUP-002"], start: "2025-03-01" }];
  const finding = (entities: string[], start: string) => ({
    claim: "x",
    entities,
    start,
    supportingSql: "SELECT 1",
  });

  it("matches on entity and date within ±14 days", () => {
    const s = scoreFindings([finding(["SUP-002"], "2025-03-10"), finding(["STO-001"], "2025-03-01")], truth);
    expect(s).toEqual({ recall: 1, precision: 0.5, matched: [{ storyPointId: "sp1", findingIndex: 0 }] });
  });

  it("does not match outside the date window or with an invalid date", () => {
    expect(scoreFindings([finding(["SUP-002"], "2025-04-01")], truth).recall).toBe(0);
    expect(scoreFindings([finding(["SUP-002"], "not-a-date")], truth).recall).toBe(0);
  });

  it("finds the maximum matching (greedy would assign f0 to A and lose B)", () => {
    const twoPoints = [
      { id: "A", entityIds: ["X", "Y"], start: "2025-03-01" },
      { id: "B", entityIds: ["X"], start: "2025-03-01" },
    ];
    const s = scoreFindings([finding(["X"], "2025-03-01"), finding(["Y"], "2025-03-01")], twoPoints);
    expect(s.recall).toBe(1);
  });
});
