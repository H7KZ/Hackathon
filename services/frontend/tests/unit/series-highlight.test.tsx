import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import type * as Recharts from "recharts";
import { LineChart } from "../../components/a2ui/charts";

// jsdom has no layout: give the chart a fixed size instead of measuring the parent.
vi.mock("recharts", async (importOriginal) => ({
  ...(await importOriginal<typeof Recharts>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width: number; height: number }> }) =>
    cloneElement(children, { width: 600, height: 300 }),
}));
vi.mock("../../components/a2ui/context", () => ({ useResolve: () => (v: unknown) => v }));

const node = {
  id: "c",
  component: "LineChart",
  data: [
    { day: "2026-03-01", a: 1, b: 2 },
    { day: "2026-03-02", a: 3, b: 4 },
  ],
  lines: [
    { key: "a", label: "Řada A" },
    { key: "b", label: "Řada B" },
  ],
};

describe("line chart series highlight", () => {
  it("dims the other series while a legend item is hovered", () => {
    const { container } = render(<LineChart node={node} />);
    const opacities = () =>
      [...container.querySelectorAll(".recharts-line-curve")].map((p) => p.getAttribute("stroke-opacity"));
    const item = container.querySelectorAll(".recharts-legend-item")[1] as Element;

    expect(opacities()).toEqual(["1", "1"]);
    fireEvent.mouseEnter(item);
    expect(opacities()).toEqual(["0.15", "1"]);
    fireEvent.mouseLeave(item);
    expect(opacities()).toEqual(["1", "1"]);
  });
});
