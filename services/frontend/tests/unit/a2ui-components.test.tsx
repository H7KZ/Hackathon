import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { A2uiSurface } from "../../components/a2ui/Surface";
import { COMPONENTS, validateComponents } from "../../lib/a2ui/catalog";
import { EXAMPLES, type Example } from "../../lib/a2ui/playground";
import { a2ui } from "../../lib/a2ui/protocol";
import { createSurfaceStore } from "../../lib/a2ui/store";

function mount(name: Example["name"]) {
  const ex = EXAMPLES.find((e) => e.name === name);
  if (!ex) throw new Error(`no example for ${name}`);
  const store = createSurfaceStore();
  store.apply(
    a2ui.create({ surfaceId: "s", components: ex.components, dataModel: structuredClone(ex.data) }),
  );
  const onAction = vi.fn();
  render(<A2uiSurface store={store} surfaceId="s" onAction={onAction} />);
  return { store, onAction, read: (p: string) => store.read("s", p) };
}

describe("catalog coverage", () => {
  it("every catalog component has a playground example and every example is valid", () => {
    expect(COMPONENTS.filter((c) => !EXAMPLES.some((e) => e.name === c))).toEqual([]);
    for (const ex of EXAMPLES) expect(validateComponents(ex.name, ex.components)).toEqual([]);
  });

  it.each(EXAMPLES.map((e) => e.name))("%s renders without errors", (name) => {
    mount(name);
    expect(document.querySelector(".a2-unknown")).toBeNull();
    expect(document.querySelector(".a2-placeholder")).toBeNull();
  });
});

describe("inputs write to the data model and send actions", () => {
  it("Button sends its action with resolved context; CheckBox locks it", () => {
    const { onAction } = mount("Button");
    fireEvent.click(screen.getByRole("button", { name: "Generovat" }));
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ name: "generate", context: { seed: 42 } }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Zamknout" }));
    expect(screen.getByRole("button", { name: "Generovat" })).toBeDisabled();
  });

  it("TextField writes text; the number variant writes numbers", () => {
    const { read } = mount("TextField");
    fireEvent.change(screen.getByLabelText("Název"), { target: { value: "Nový název" } });
    fireEvent.change(screen.getByLabelText("Seed"), { target: { value: "7" } });
    expect(read("/name")).toBe("Nový název");
    expect(read("/seed")).toBe(7);
  });

  it("Slider writes the number", () => {
    const { read } = mount("Slider");
    fireEvent.change(screen.getByRole("slider"), { target: { value: "2.4" } });
    expect(read("/scale")).toBe(2.4);
  });

  it("ChoicePicker: single replaces, multiple toggles", () => {
    const { read } = mount("ChoicePicker");
    fireEvent.click(screen.getByRole("button", { name: "12 měsíců" }));
    expect(read("/months")).toEqual(["12"]);
    fireEvent.click(screen.getByRole("button", { name: "tickets" }));
    fireEvent.click(screen.getByRole("button", { name: "orders" }));
    expect(read("/tables")).toEqual(["tickets"]);
  });

  it("CheckBox toggles a boolean", () => {
    const { read } = mount("CheckBox");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(read("/jitter")).toBe(false);
  });

  it("DateTimeInput sets and clears an ISO date", () => {
    const { read } = mount("DateTimeInput");
    fireEvent.change(screen.getByLabelText("Začátek"), { target: { value: "2026-04-01" } });
    expect(read("/start")).toBe("2026-04-01");
    fireEvent.change(screen.getByLabelText("Začátek"), { target: { value: "" } });
    expect(read("/start")).toBeUndefined();
  });

  it("List template inputs write into their own item", () => {
    const { read } = mount("List");
    const second = screen.getAllByLabelText("Název")[1];
    if (second) fireEvent.change(second, { target: { value: "Upraveno" } });
    expect(read("/items/1/title")).toBe("Upraveno");
    expect(read("/items/0/title")).toBe("Dodavatel začíná zpožďovat");
  });
});

describe("layout and data components respond to the user", () => {
  it("Collapsible is closed by default and opens on click", () => {
    mount("Collapsible");
    const details = document.querySelector("details");
    expect(details?.open).toBe(false);
    fireEvent.click(screen.getByText("Pokročilé nastavení"));
    expect(details?.open).toBe(true);
  });

  it("Tabs switch the visible panel", () => {
    mount("Tabs");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Obsah přehledu");
    fireEvent.click(screen.getByRole("tab", { name: "Detail" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Obsah detailu");
  });

  it("Table sorts by column, reverses, expands, colours delta only with goodWhen", () => {
    mount("Table");
    const firstCell = () => within(screen.getAllByRole("row")[1] ?? document.body).getAllByRole("cell")[0];
    expect(screen.getAllByRole("row")).toHaveLength(4); // header + maxRows 3
    fireEvent.click(screen.getByRole("button", { name: /Hodnota/ }));
    expect(firstCell()).toHaveTextContent("Zpoždění");
    fireEvent.click(screen.getByRole("button", { name: /Hodnota/ }));
    expect(firstCell()).toHaveTextContent("Objednávky");
    fireEvent.click(screen.getByRole("button", { name: /Zobrazit vše/ }));
    expect(screen.getAllByRole("row")).toHaveLength(5);
    expect(document.querySelectorAll("td.ok, td.fail").length).toBeGreaterThan(0);
  });

  it("Table renders duplicate row ids (noise duplicates) without React key warnings (live run 4)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createSurfaceStore();
    store.apply(
      a2ui.create({
        surfaceId: "s",
        components: [
          {
            id: "root",
            component: "Table",
            columns: [{ key: "id", label: "id" }],
            rows: { "@path": "/rows" },
          },
        ],
        dataModel: { rows: [{ id: "visit-000003" }, { id: "visit-000003" }] },
      }),
    );
    render(<A2uiSurface store={store} surfaceId="s" onAction={vi.fn()} />);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(err.mock.calls.filter((c) => String(c[0]).includes("same key"))).toEqual([]);
    err.mockRestore();
  });

  it("Kpi formats Czech numbers and a signed delta", () => {
    mount("Kpi");
    const norm = (s: string | null | undefined) => (s ?? "").replace(/\s/g, " ");
    expect(norm(screen.getByText(/48/).textContent)).toBe("48 210");
    expect(norm(document.querySelector(".a2-kpi-delta")?.textContent)).toBe("▲ +38 %");
  });
});

describe("CurveEditor: it just works", () => {
  const handles = () => screen.getAllByRole("slider").filter((el) => el.tagName.toLowerCase() === "circle");
  const values = (read: (p: string) => unknown) =>
    (read("/points") as { id: string; start: string; level: number; end?: string }[]).map((p) => ({ ...p }));

  it("keyboard: select a point, nudge date and value, delete, undo, redo", () => {
    const { read } = mount("CurveEditor");
    const canvas = screen.getByRole("group", { name: /editor křivky/ });
    const first = handles()[0];
    if (!first) throw new Error("no handle");
    fireEvent.focus(first);
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    fireEvent.keyDown(canvas, { key: "ArrowUp", shiftKey: true });
    expect(values(read)[0]).toMatchObject({ id: "sp1", start: "2026-03-03", level: 6.5 });
    fireEvent.keyDown(canvas, { key: "Delete" });
    expect(values(read).map((p) => p.id)).toEqual(["sp2", "sp3"]);
    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    expect(values(read).map((p) => p.id)).toEqual(["sp1", "sp2", "sp3"]);
    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true, shiftKey: true });
    expect(values(read)).toHaveLength(2);
  });

  it("toolbar adds a point after the last one and selects it for editing", () => {
    const { read } = mount("CurveEditor");
    fireEvent.click(screen.getByRole("button", { name: "+ Bod" }));
    const pts = values(read);
    expect(pts).toHaveLength(4);
    expect(pts.at(-1)).toMatchObject({ id: "sp4" });
    const editor = screen.getByRole("group", { name: /Upravit bod/ });
    fireEvent.change(within(editor).getByLabelText("Název"), { target: { value: "Konkurence zlevní" } });
    expect((read("/points/3") as { title: string }).title).toBe("Konkurence zlevní");
  });

  it("inline editor: return-to-normal toggles an end date; delete button removes", () => {
    const { read } = mount("CurveEditor");
    const first = handles()[0];
    if (first) fireEvent.focus(first);
    const editor = screen.getByRole("group", { name: /Upravit bod/ });
    fireEvent.click(within(editor).getByLabelText("Návrat k normálu"));
    expect(values(read)[0]?.end).toBe("2026-03-30");
    fireEvent.change(within(editor).getByLabelText(/Hodnota/), { target: { value: "8" } });
    expect(values(read)[0]?.level).toBe(8);
    fireEvent.click(within(editor).getByRole("button", { name: "Smazat bod" }));
    expect(values(read)).toHaveLength(2);
  });

  it("double-click on empty chart adds a point where the pointer is", () => {
    const { read } = mount("CurveEditor");
    const svg = document.querySelector(".a2-curve svg");
    if (!svg) throw new Error("no svg");
    svg.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 760,
      height: 240,
      right: 760,
      bottom: 240,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const hit = document.querySelector(".a2-curve .hit");
    if (hit) fireEvent.doubleClick(hit, { clientX: 400, clientY: 60 });
    const added = values(read).find((p) => p.id === "sp4");
    expect(added).toBeDefined();
    expect(added?.level).toBeGreaterThan(6);
  });

  it("locked editor ignores edits", () => {
    const store = createSurfaceStore();
    const ex = EXAMPLES.find((e) => e.name === "CurveEditor");
    if (!ex) throw new Error("no example");
    const [root] = ex.components;
    store.apply(
      a2ui.create({
        surfaceId: "s",
        components: [{ ...root, id: "root", component: "CurveEditor", locked: true }],
        dataModel: structuredClone(ex.data),
      }),
    );
    render(<A2uiSurface store={store} surfaceId="s" onAction={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "+ Bod" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("group", { name: /editor křivky/ }), { key: "Delete" });
    expect((store.read("s", "/points") as unknown[]).length).toBe(3);
  });
});

describe("PeriodPicker", () => {
  it("derives the end date and record count; presets and units recompute", () => {
    const { read } = mount("PeriodPicker");
    expect(read("/time")).toMatchObject({ from: "2026-01-05", to: "2026-07-04", granularity: "day" });
    fireEvent.click(screen.getByRole("radio", { name: "hodinách" }));
    expect(screen.getByRole("status")).toHaveTextContent(/4\s344 záznamů na entitu/);
    fireEvent.change(screen.getByLabelText("Jednotka délky"), { target: { value: "years" } });
    expect(read("/time")).toMatchObject({ unit: "years", length: 6, to: "2032-01-04" });
    expect(screen.getByRole("status")).toHaveTextContent(/hodně dat/);
    fireEvent.click(screen.getByRole("button", { name: "4 roky po dnech" }));
    expect(read("/time")).toMatchObject({ length: 4, unit: "years", granularity: "day", to: "2030-01-04" });
    fireEvent.change(screen.getByLabelText("Začátek"), { target: { value: "2025-03-01" } });
    expect(read("/time/from")).toBe("2025-03-01");
  });
});

describe("CurveEditor reacts to the pointer and the period", () => {
  const rect = {
    left: 0,
    top: 0,
    width: 760,
    height: 240,
    right: 760,
    bottom: 240,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };

  it("hovering near the line shows a ghost point; one click adds it on the curve", () => {
    const { read } = mount("CurveEditor");
    const svg = document.querySelector(".a2-curve svg");
    const hit = document.querySelector(".a2-curve .hit");
    if (!svg || !hit) throw new Error("no svg");
    svg.getBoundingClientRect = () => rect;
    // baseline 2 on a 0..10 axis, early January: the line sits near the bottom of the plot
    const yBaseline = 30 + (1 - 2 / 10) * (240 - 30 - 28);
    fireEvent.pointerMove(svg, { clientX: 90, clientY: yBaseline });
    expect(document.querySelector(".a2-curve .ghost")).not.toBeNull();
    fireEvent.click(hit);
    const added = (read("/points") as { id: string; level: number }[]).find((p) => p.id === "sp4");
    expect(added?.level).toBe(2);
  });

  it("points outside a new period can be fitted back in one click", () => {
    const store = createSurfaceStore();
    const ex = EXAMPLES.find((e) => e.name === "CurveEditor");
    if (!ex) throw new Error("no example");
    const [root] = ex.components;
    store.apply(
      a2ui.create({
        surfaceId: "s",
        components: [{ ...root, id: "root", component: "CurveEditor", from: "2027-01-01", to: "2027-01-14" }],
        dataModel: structuredClone(ex.data),
      }),
    );
    render(<A2uiSurface store={store} surfaceId="s" onAction={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rozložit body do období" }));
    const pts = store.read("s", "/points") as { start: string }[];
    expect(pts.every((p) => p.start >= "2027-01-01" && p.start <= "2027-01-14")).toBe(true);
    expect(screen.queryByRole("button", { name: "Rozložit body do období" })).toBeNull();
  });
});
