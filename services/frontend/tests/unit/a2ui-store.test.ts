import { describe, expect, it } from "vitest";
import { validateComponents } from "../../lib/a2ui/catalog";
import { getAt, resolvePath, setAt } from "../../lib/a2ui/pointer";
import { a2ui, isA2uiMessage, path } from "../../lib/a2ui/protocol";
import { applyMessage, createSurfaceStore, emptyState } from "../../lib/a2ui/store";

describe("JSON pointer", () => {
  it("reads nested values, array indices and escaped tokens", () => {
    const model = { a: { "b/c": [10, { d: "x" }] } };
    expect(getAt(model, "/a/b~1c/1/d")).toBe("x");
    expect(getAt(model, "/a/missing/deep")).toBeUndefined();
    expect(getAt(model, "/")).toBe(model);
  });

  it("upserts immutably, creating missing objects; undefined deletes", () => {
    const model = { keep: 1, list: [1, 2] };
    const next = setAt(model, "/new/deep", 5) as Record<string, unknown>;
    expect(next).toEqual({ keep: 1, list: [1, 2], new: { deep: 5 } });
    expect(model).toEqual({ keep: 1, list: [1, 2] });
    expect(setAt(model, "/list/1", 9)).toEqual({ keep: 1, list: [1, 9] });
    expect(setAt(model, "/keep", undefined)).toEqual({ list: [1, 2] });
  });

  it("resolves relative paths against a template scope", () => {
    expect(resolvePath("name", "/items/2")).toBe("/items/2/name");
    expect(resolvePath("/abs", "/items/2")).toBe("/abs");
    expect(resolvePath("name")).toBe("/name");
  });
});

describe("surface reducer (A2UI v1.0 messages)", () => {
  const created = applyMessage(
    emptyState,
    a2ui.create({
      surfaceId: "s",
      components: [{ id: "root", component: "Text", text: path("/msg") }],
      dataModel: { msg: "ahoj" },
      metadata: { placement: "canvas", title: "T" },
    }),
  ).state;

  it("creates a surface with components by id and its data model", () => {
    expect(created.order).toEqual(["s"]);
    expect(created.surfaces.s?.components.root?.component).toBe("Text");
    expect(created.surfaces.s?.meta).toEqual({ placement: "canvas", title: "T" });
  });

  it("updates components by id and data by path, deletes surfaces", () => {
    let s = applyMessage(
      created,
      a2ui.components("s", [{ id: "root", component: "Badge", text: "x" }]),
    ).state;
    s = applyMessage(s, a2ui.data("s", "/msg", "nazdar")).state;
    expect(s.surfaces.s?.components.root?.component).toBe("Badge");
    expect(s.surfaces.s?.data).toEqual({ msg: "nazdar" });
    s = applyMessage(s, a2ui.remove("s")).state;
    expect(s.order).toEqual([]);
  });

  it("reports integrity errors in A2UI format instead of throwing", () => {
    expect(applyMessage(created, a2ui.create({ surfaceId: "s" })).error?.code).toBe("INTEGRITY_ERROR");
    expect(applyMessage(created, a2ui.data("nope", "/", {})).error).toMatchObject({
      code: "INTEGRITY_ERROR",
      surfaceId: "nope",
    });
  });

  it("store.write is two-way binding and notifies subscribers", () => {
    const store = createSurfaceStore(created);
    let calls = 0;
    store.subscribe(() => calls++);
    store.write("s", "/msg", "nové");
    expect(store.read("s", "/msg")).toBe("nové");
    expect(calls).toBe(1);
  });

  it("recognises wire messages", () => {
    expect(isA2uiMessage(a2ui.remove("x"))).toBe(true);
    expect(isA2uiMessage({ version: "0.8", deleteSurface: { surfaceId: "x" } })).toBe(false);
    expect(isA2uiMessage({ version: "1.0" })).toBe(false);
  });
});

describe("JOJO catalog validation", () => {
  it("rejects unknown components and literal numbers in data props", () => {
    const errors = validateComponents("s", [
      { id: "a", component: "Marquee" },
      { id: "b", component: "Kpi", label: "x", value: 42 },
      { id: "c", component: "LineChart", data: path("/series") },
    ]);
    expect(errors.map((e) => e.path)).toEqual(["/components/0/component", "/components/1/value"]);
    expect(errors[1]?.message).toMatch(/data binding/);
  });
});
