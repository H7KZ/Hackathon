import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { A2uiSurface } from "../../components/a2ui/Surface";
import { createSurfaceStore } from "../../lib/a2ui/store";
import { storyToEdit } from "../../lib/chat/liveSource";
import { storySurface } from "../../lib/chat/surfaces";

const story = {
  storyPoints: [
    { id: "sp_delay", phase: 1, title: "Zpoždění", description: "", start: "2025-03-01" },
    { id: "sp_shipping", phase: 2, title: "Dražší doprava", description: "", start: "2025-05-01" },
  ],
  curves: [
    {
      id: "delay_prob",
      baseline: 0.05,
      segments: [
        { kind: "ramp", start: "2025-03-01", to: 0.33, storyPointId: "sp_delay" },
        { kind: "ramp", start: "2025-06-15", to: 0.05, storyPointId: "sp_delay" },
      ],
    },
    {
      id: "shipping_fee",
      baseline: 99,
      segments: [{ kind: "step", start: "2025-05-01", to: 199, storyPointId: "sp_shipping" }],
    },
  ],
  expectations: [{ id: "e1", description: "Storna rostou" }],
};

describe("live story editor with two levers", () => {
  it("draws a curve per lever and Generate sends the second lever's edit", () => {
    const edit = storyToEdit(story);
    const store = createSurfaceStore();
    store.apply(storySurface("story", edit.points, edit.config, edit.expectations, false, true, edit.levers));
    const onAction = vi.fn();
    const { container } = render(<A2uiSurface store={store} surfaceId="story" onAction={onAction} />);

    expect(screen.getByText("Další páky příběhu")).toBeInTheDocument();
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Cena dopravy/).length).toBeGreaterThan(0);

    act(() => {
      store.write("story", "/levers/0/baseline", 79);
    });
    fireEvent.click(screen.getByRole("button", { name: "Generovat data" }));
    const ctx = onAction.mock.calls[0]?.[0]?.context as { levers?: { curveId: string; baseline: number }[] };
    expect(ctx.levers?.[0]).toMatchObject({ curveId: "shipping_fee", baseline: 79 });
  });
});
