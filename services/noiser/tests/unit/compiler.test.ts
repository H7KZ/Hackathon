import { describe, expect, it } from "vitest";
import { loadScenarioFixture } from "@s2d/test-utils";
import { compileScenario } from "../../src/compiler/validate";

type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test fixture surgery

const fixture = () => loadScenarioFixture("supplier_delay") as Mutable;
const errorsOf = (raw: unknown) => {
  const r = compileScenario(raw);
  return r.ok ? [] : r.errors;
};

describe("compileScenario", () => {
  it("compiles supplier_delay and returns a topological order", () => {
    const r = compileScenario(fixture());
    expect(r.ok && r.order).toEqual([
      "delivery",
      "purchase_attempt",
      "fulfil",
      "complaint_oos",
      "complaint_quality",
    ]);
  });

  it("reports zod errors with a dotted path", () => {
    const s = fixture();
    s.meta.locale = "en-US";
    expect(errorsOf(s)).toEqual([expect.objectContaining({ path: "meta.locale" })]);
  });

  it("reports an unknown curve and lists the valid ones", () => {
    const s = fixture();
    s.processes[0].fields.is_late.p.curve = "nope";
    const [e] = errorsOf(s);
    expect(e?.path).toBe("processes[0].fields.is_late.p.curve");
    expect(e?.message).toMatch(/Unknown curve "nope".*"late_prob"/);
  });

  it("requires :then/:else when consuming a branch", () => {
    const s = fixture();
    s.processes[3].source = "fulfil";
    expect(errorsOf(s)[0]?.message).toMatch(/fulfil:then/);
  });

  it("detects cycles between processes", () => {
    const s = fixture();
    s.processes[3].source = "complaint_quality";
    s.processes[4].source = "complaint_oos";
    expect(errorsOf(s).some((e) => /cycle/.test(e.message))).toBe(true);
  });

  it("rejects segment dates outside the scenario period", () => {
    const s = fixture();
    s.curves[0].segments[0].start = "2024-12-01";
    expect(errorsOf(s)[0]?.path).toBe("curves[0].segments[0].start");
  });

  it("rejects unknown flow keys and story points", () => {
    const s = fixture();
    s.flows[0].keys = ["store", "warehouse"];
    s.expectations[0].storyPointId = "sp9";
    const paths = errorsOf(s).map((e) => e.path);
    expect(paths).toContain("flows[0].keys[1]");
    expect(paths).toContain("expectations[0].storyPointId");
  });
});

describe("compileScenario — references and shapes", () => {
  it("rejects key.* that is not a stream key of the arrival", () => {
    const s = fixture();
    s.processes[1].fields.customer_id.path = "key.store";
    expect(errorsOf(s)[0]?.message).toMatch(/stream keys of "purchase_attempt" are "key.customer"/);
  });

  it("rejects flow keys that do not match the flow definition", () => {
    const s = fixture();
    s.processes[0].effects[0].keys = { store: "self.store_id" };
    expect(errorsOf(s)[0]?.message).toMatch(/Keys of flow "stock" must be exactly "store", "product"/);
  });

  it("rejects lookup of a field the entity does not have", () => {
    const s = fixture();
    s.processes[0].fields.supplier_id.field = "vendor";
    expect(errorsOf(s)[0]?.path).toBe("processes[0].fields.supplier_id.field");
  });

  it("rejects segment end before start, bad clamp, duplicate expectation ids", () => {
    const s = fixture();
    s.curves[0].segments[0].end = "2025-02-01";
    s.curves[0].clamp = [1, 0];
    s.expectations[1].id = "e1";
    const paths = errorsOf(s).map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(["curves[0].segments[0].end", "curves[0].clamp", "expectations[1]"]),
    );
  });

  it("rejects one table written with two visibilities", () => {
    const s = fixture();
    s.processes[3].visibility = "ground_truth";
    expect(errorsOf(s).some((e) => /written as both ground_truth and observed/.test(e.message))).toBe(true);
  });

  it("rejects expectations reading truth", () => {
    const s = fixture();
    s.expectations[0].sql = "SELECT 'before' AS period, 1 AS value FROM truth.lost_sale";
    expect(errorsOf(s)[0]?.message).toMatch(/only schema main/);
  });

  it("rejects self.* pointing at a later field, even inside an `if` branch, and lists earlier fields", () => {
    const s = fixture();
    s.processes[0].fields.delay_days.then = { gen: "ref", path: "self.actual_date" };
    const [e] = errorsOf(s);
    expect(e?.path).toBe("processes[0].fields.delay_days.then.path");
    expect(e?.message).toMatch(/declared earlier.*"self.is_late"/);
    expect(e?.message.split("available:")[1]).not.toMatch(/actual_date/);
  });

  it("allows every field of the finished record in effects, but rejects unknown ones", () => {
    const s = fixture();
    s.processes[0].effects[0].delta = "self.qty";
    const [e] = errorsOf(s);
    expect(e?.path).toBe("processes[0].effects[0].delta");
    expect(e?.message).toMatch(/"self.quantity"/);
  });

  it("rejects self.* in a branch condition (the record does not exist yet)", () => {
    const s = fixture();
    s.processes[2].cond.value = "self.quantity";
    expect(errorsOf(s)[0]?.path).toBe("processes[2].cond.value");
  });

  it("rejects source.* that is not a field of the source record and lists the valid ones", () => {
    const s = fixture();
    s.processes[2].cond.keys.store = "source.shop_id";
    s.processes[3].fields.customer_id.path = "source.unit_price"; // lost_sale (fulfil:else) has no price
    const errors = errorsOf(s);
    expect(errors.map((e) => e.path)).toEqual([
      "processes[2].cond.keys.store",
      "processes[3].fields.customer_id.path",
    ]);
    expect(errors[0]?.message).toMatch(/"purchase_attempt".*"source.store_id"/);
    expect(errors[1]?.message).toMatch(/"fulfil:else"/);
  });

  it("checks paths in flow initial values: only key.<flow key>", () => {
    const s = fixture();
    s.flows[0].initial = { gen: "lookup", entity: "product", key: "key.supplier", field: "price" };
    expect(errorsOf(s)[0]).toMatchObject({ path: "flows[0].initial.key" });
  });

  it("formats zod paths with brackets", () => {
    const s = fixture();
    s.processes[0].id = "Bad-Id";
    expect(errorsOf(s)[0]?.path).toBe("processes[0].id");
  });
});
