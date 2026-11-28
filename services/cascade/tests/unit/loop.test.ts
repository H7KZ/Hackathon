import { describe, expect, it } from "vitest";
import { loadScenarioFixture } from "@s2d/test-utils";
import { describeShape, formatHistory, repairLoop, type Attempt, type Feedback } from "../../src/loop";

describe("describeShape", () => {
  it("gives no hint when the object has its own top-level keys", () => {
    expect(describeShape({ name: "x", entities: [], flows: [] })).toEqual([]);
  });

  it("hints at a wrapped object and at non-objects", () => {
    expect(describeShape({ scenario: { name: "x" } })).toEqual([
      'Your answer wrapped everything in "scenario"; put the fields directly at the top level.',
    ]);
    expect(describeShape([1])).toEqual(["Your answer was an array, expected one JSON object."]);
    expect(describeShape(undefined)).toEqual([]);
  });
});

describe("repairLoop keeps the best attempt and passes the history (live run 3: attempt 4 reintroduced attempt 1's error)", () => {
  const scenario = loadScenarioFixture("supplier_delay");
  const gateError = { path: "expectations[0]", message: "Expectation e1 failed: change -0.5%" };
  const rootError = { path: "processes.1.rate", message: "Curve x drives a non-root parameter" };

  it("a worse later attempt does not replace the best one as `previous`", async () => {
    const calls: { previous: unknown; feedback: Feedback; history: Attempt[] }[] = [];
    const outputs = ["gate-fail", "root-fail", "ok"];
    const res = await repairLoop<string>({
      step: "05_scenario",
      keepBest: true,
      ask: (feedback, previous, _n, history) => {
        calls.push({ previous, feedback, history: [...history] });
        return Promise.resolve(outputs[calls.length - 1] ?? "ok");
      },
      assemble: (o) => (o === "root-fail" ? { ok: false, errors: [rootError] } : { ok: true, scenario }),
      verify: () => Promise.resolve(calls.length === 1 ? [gateError] : []),
    });
    expect(res.ok).toBe(true);
    expect(calls[1]?.previous).toBe("gate-fail");
    // attempt 2 regressed to a compile-stage error: attempt 3 still edits attempt 1
    expect(calls[2]?.previous).toBe("gate-fail");
    expect(calls[2]?.feedback).toEqual([gateError]);
    expect(calls[2]?.history.map((h) => [h.n, h.stage])).toEqual([
      [1, "story gate"],
      [2, "compile"],
    ]);
  });

  it("acceptGateMisses: when every attempt runs but some hypotheses still fail, the best runnable attempt is used and the misses reported", async () => {
    let n = 0;
    const res = await repairLoop<string>({
      step: "05_scenario",
      keepBest: true,
      acceptGateMisses: true,
      ask: () => Promise.resolve(["gate-2", "compile-fail", "gate-1"][n++] ?? "gate-1"),
      assemble: (o) => (o === "compile-fail" ? { ok: false, errors: [rootError] } : { ok: true, scenario }),
      verify: () => Promise.resolve(n === 1 ? [gateError, gateError] : [gateError]),
      maxIterations: 3,
    });
    expect(res).toMatchObject({ ok: true, output: "gate-1", misses: [gateError] });
  });

  it("without acceptGateMisses a run that never passes the gate fails", async () => {
    const res = await repairLoop<string>({
      step: "05_scenario",
      ask: () => Promise.resolve("x"),
      assemble: () => ({ ok: true, scenario }),
      verify: () => Promise.resolve([gateError]),
      maxIterations: 2,
    });
    expect(res.ok).toBe(false);
  });

  it("without keepBest the last attempt stays `previous` (whatIf, 4b)", async () => {
    const prev: unknown[] = [];
    await repairLoop<string>({
      step: "05_scenario",
      ask: (_f, previous) => {
        prev.push(previous);
        return Promise.resolve(prev.length === 1 ? "a" : "b");
      },
      assemble: (o) => (o === "b" ? { ok: false, errors: [rootError] } : { ok: true, scenario }),
      verify: () => Promise.resolve([gateError]),
      maxIterations: 3,
    });
    expect(prev).toEqual([undefined, "a", "b"]);
  });

  it("formatHistory marks errors that came back after an attempt without them", () => {
    const text = formatHistory([
      { n: 1, stage: "check", feedback: [rootError] },
      { n: 2, stage: "story gate", feedback: [gateError] },
      { n: 3, stage: "check", feedback: [rootError] },
    ]);
    expect(text).toMatch(/attempt 1 \(check\)/);
    expect(text).toMatch(/came back in attempt 3/);
    expect(text).toContain("processes.1.rate");
  });
});
