import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Nav } from "../../components/Nav";
import { NAV_ITEMS } from "../../lib/nav";

describe("Nav", () => {
  it("renders a link for every SPEC page", () => {
    render(<Nav />);
    for (const item of NAV_ITEMS) {
      expect(screen.getByRole("link", { name: item.label })).toHaveAttribute("href", item.href);
    }
  });

  it("marks the active page", () => {
    render(<Nav active="/dukaz" />);
    expect(screen.getByRole("link", { name: "Důkaz" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Data" })).not.toHaveAttribute("aria-current");
  });
});
