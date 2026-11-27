import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { A2uiSurface } from "../../components/a2ui/Surface";
import { a2ui, path, type ComponentNode } from "../../lib/a2ui/protocol";
import { createSurfaceStore } from "../../lib/a2ui/store";

function mount(components: ComponentNode[], dataModel: Record<string, unknown> = {}) {
  const store = createSurfaceStore();
  store.apply(a2ui.create({ surfaceId: "s", components, dataModel }));
  const onAction = vi.fn();
  render(<A2uiSurface store={store} surfaceId="s" onAction={onAction} />);
  return { store, onAction };
}

describe("A2UI renderer", () => {
  it("renders bound text and updates when the data model changes", () => {
    const { store } = mount([{ id: "root", component: "Text", variant: "h2", text: path("/title") }], {
      title: "Dataset d1",
    });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Dataset d1");
    act(() => {
      store.apply(a2ui.data("s", "/title", "Dataset d2"));
    });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Dataset d2");
  });

  it("repeats a template per array item with relative paths", () => {
    mount(
      [
        { id: "root", component: "List", children: { componentId: "row", path: "/items" } },
        { id: "row", component: "Badge", tone: "ok", text: path("name") },
      ],
      { items: [{ name: "Jablko" }, { name: "Hruška" }] },
    );
    expect(screen.getByText("Jablko")).toBeInTheDocument();
    expect(screen.getByText("Hruška")).toBeInTheDocument();
  });

  it("writes input back into the data model and sends actions with resolved context", () => {
    const { store, onAction } = mount(
      [
        { id: "root", component: "Column", children: ["field", "go"] },
        { id: "field", component: "TextField", label: "Začátek", value: path("/start") },
        {
          id: "go",
          component: "Button",
          label: "Schválit",
          action: { event: { name: "approve", context: { start: path("/start") } } },
        },
      ],
      { start: "2026-03-02" },
    );
    fireEvent.change(screen.getByLabelText("Začátek"), { target: { value: "2026-04-01" } });
    expect(store.read("s", "/start")).toBe("2026-04-01");
    fireEvent.click(screen.getByRole("button", { name: "Schválit" }));
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "approve",
        surfaceId: "s",
        sourceComponentId: "go",
        context: { start: "2026-04-01" },
      }),
    );
  });

  it("formats KPI and table numbers in Czech and shows pass/fail", () => {
    mount(
      [
        { id: "root", component: "Column", children: ["kpi", "table"] },
        { id: "kpi", component: "Kpi", label: "Řádků", value: path("/rows"), format: "int" },
        {
          id: "table",
          component: "Table",
          columns: [
            { key: "d", label: "Hypotéza" },
            { key: "r", label: "Změna", format: "delta" },
            { key: "p", label: "Výsledek", format: "pass" },
          ],
          rows: path("/exp"),
        },
      ],
      { rows: 48210, exp: [{ d: "Zpoždění roste", r: 0.38, p: true }] },
    );
    const norm = (s: string | null) => (s ?? "").replace(/\s/g, " ");
    expect(norm(screen.getByText(/48/).textContent)).toBe("48 210");
    expect(norm(screen.getByText(/38/).textContent)).toBe("+38 %");
    expect(screen.getByText("✓ splněno")).toBeInTheDocument();
  });

  it("shows a placeholder for components that have not streamed in yet", () => {
    const { store } = mount([{ id: "root", component: "Column", children: ["later"] }]);
    expect(document.querySelector(".a2-placeholder")).not.toBeNull();
    act(() => {
      store.apply(a2ui.components("s", [{ id: "later", component: "Text", text: "Už jsem tu" }]));
    });
    expect(screen.getByText("Už jsem tu")).toBeInTheDocument();
  });
});
