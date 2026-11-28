import { describe, expect, it } from "vitest";
import { CompileError, SessionCommand, SessionEvent, SessionState } from "../../src/api";
import { CascadeEvent } from "../../src/artifacts";
import * as barrel from "../../src/index";

describe("Session contract (@s2d/schema/api)", () => {
  it("parses a cascade event wrapped in a session event", () => {
    const e = SessionEvent.parse({
      seq: 1,
      type: "cascade",
      event: {
        type: "loop.iteration",
        step: "05_scenario",
        n: 2,
        ok: false,
        feedback: [{ path: "/a", message: "b" }],
      },
    });
    expect(e.type).toBe("cascade");
  });

  it("rejects an unknown cascade step", () => {
    expect(CascadeEvent.safeParse({ type: "step.started", step: "99_nope" }).success).toBe(false);
  });

  it("parses approve with settings and a session state", () => {
    expect(SessionCommand.parse({ type: "approve", settings: { seed: 7 } }).type).toBe("approve");
    const s = SessionState.parse({
      id: "x",
      status: "ready",
      input: { story: "s", company: "c" },
      datasets: [{ id: "d1", parent: null, seed: 42, origin: "approve" }],
    });
    expect(s.datasets).toHaveLength(1);
  });

  it("the barrel exports one CompileError", () => {
    expect(barrel.CompileError).toBe(CompileError);
    expect(barrel.CascadeEvent).toBe(CascadeEvent);
  });
});
