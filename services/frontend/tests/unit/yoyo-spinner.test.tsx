import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { YOYO_VARIANTS, YoyoSpinner } from "../../components/yoyo-spinner";

const srcOf = (container: HTMLElement): string | null =>
  container.querySelector("img")?.getAttribute("src") ?? null;

describe("YoyoSpinner", () => {
  it("renders one of the 3 yoyo variants with role=status and the Czech label", () => {
    const { container } = render(<YoyoSpinner />);
    expect(YOYO_VARIANTS).toContain(srcOf(container));
    expect(screen.getByRole("status")).toHaveTextContent("Načítání…");
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("width", "40");
    expect(img).toHaveAttribute("aria-hidden", "true");
  });

  it("takes a custom label and size", () => {
    const { container } = render(<YoyoSpinner size={18} label="Připojuji k API…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Připojuji k API…");
    expect(container.querySelector("img")).toHaveAttribute("height", "18");
  });

  it("keeps the same variant across re-renders", () => {
    const { container, rerender } = render(<YoyoSpinner label="a" />);
    const first = srcOf(container);
    for (const label of ["b", "c", "d", "e"]) {
      rerender(<YoyoSpinner label={label} />);
      expect(srcOf(container)).toBe(first);
    }
  });
});
