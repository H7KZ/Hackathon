import { describe, expect, it } from "vitest";
import { humanizeDetective, humanizeIds } from "../../lib/chat/labels";

const labels = { "STO-001": "Obuv Krok s.r.o.", "SUP-002": "Import Asie a.s." };

describe("humanizeIds (user: nobody knows what STO-001 means)", () => {
  it("puts the entity name in front of its id, leaves unknown ids alone", () => {
    expect(humanizeIds("Prodeje v STO-001 a STO-009 rostou", labels)).toBe(
      "Prodeje v Obuv Krok s.r.o. (STO-001) a STO-009 rostou",
    );
  });

  it("is idempotent", () => {
    const once = humanizeIds("Vratky u SUP-002", labels);
    expect(humanizeIds(once, labels)).toBe(once);
  });

  it("names the entities of detective findings", () => {
    const v = humanizeDetective(
      {
        datasetId: "dat1",
        narrative: "SUP-002 dodává pozdě",
        recall: 1,
        precision: 1,
        findings: [{ claim: "SUP-002 zpožďuje", start: "2024-03-01", entities: "SUP-002", matched: true }],
      },
      labels,
    );
    expect(v.narrative).toBe("Import Asie a.s. (SUP-002) dodává pozdě");
    expect(v.findings[0]?.entities).toBe("Import Asie a.s. (SUP-002)");
  });
});
