import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import HomePage from "../../app/page";
import { Footer } from "../../components/Footer";
import { PromptForm, type Send } from "../../components/PromptForm";

const ok: Send = () => Promise.resolve({ ok: true, sessionId: "s1" });
const company = () => screen.getByLabelText("Firma");
const story = () => screen.getByLabelText("Příběh");
const type = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });
const send = () => fireEvent.click(screen.getByRole("button", { name: "Odeslat" }));
const upload = (...files: File[]) =>
  fireEvent.change(screen.getByLabelText("Nahrát soubor"), { target: { files } });

describe("landing page", () => {
  it("shows the FIS logo, the team name and the prompt box", () => {
    render(<HomePage />);
    expect(screen.getByRole("img", { name: /Fakulta informatiky/ })).toHaveAttribute("src", "/fis-logo.png");
    expect(screen.getByRole("heading", { level: 1, name: "JOJO" })).toBeInTheDocument();
    expect(company()).toBeInTheDocument();
    expect(story()).toBeInTheDocument();
  });

  it("has a footer", () => {
    render(<Footer />);
    expect(screen.getByRole("contentinfo")).toHaveTextContent("JOJO");
  });

  it("opens the long help and closes it with the button at the end or Escape", () => {
    render(<HomePage />);
    const toggle = screen.getByRole("button", { name: "Číst více" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Zavřít" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});

describe("PromptForm", () => {
  it("asks for the company first, then the story, and sends nothing", () => {
    const spy = vi.fn(ok);
    render(<PromptForm send={spy} />);
    send();
    expect(screen.getByRole("alert")).toHaveTextContent("Doplňte, o jakou firmu jde.");
    expect(company()).toHaveAttribute("aria-invalid", "true");
    expect(company()).toHaveAccessibleDescription("Doplňte, o jakou firmu jde.");
    type(company(), "Firma");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    send();
    expect(screen.getByRole("alert")).toHaveTextContent("Popište příběh");
    expect(story()).toHaveAttribute("aria-invalid", "true");
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends the trimmed input, with text files appended to the story", async () => {
    const spy = vi.fn(ok);
    render(<PromptForm send={spy} />);
    type(company(), "  Firma ");
    type(story(), " Klesly tržby. ");
    upload(new File(["a;b"], "data.csv"));
    send();
    expect(await screen.findByRole("status")).toHaveTextContent("Zadání odesláno");
    expect(spy).toHaveBeenCalledWith({ company: "Firma", story: "Klesly tržby.\n\n[data.csv]\na;b" });
  });

  it("rejects files the API cannot take as text", () => {
    render(<PromptForm send={ok} />);
    upload(new File(["x"], "obrazek.png"));
    expect(screen.getByRole("alert")).toHaveTextContent("obrazek.png");
    expect(screen.queryByRole("button", { name: "Odebrat obrazek.png" })).not.toBeInTheDocument();
  });

  it("shows a server error on the field it belongs to and keeps the input", async () => {
    render(
      <PromptForm send={() => Promise.resolve({ ok: false, message: "Příliš krátké", field: "story" })} />,
    );
    type(company(), "Firma");
    type(story(), "x");
    send();
    expect(await screen.findByRole("alert")).toHaveTextContent("Příliš krátké");
    expect(story()).toHaveAttribute("aria-invalid", "true");
    expect(story()).toHaveValue("x");
  });

  it("does not send twice while a request is running", async () => {
    const spy = vi.fn<Send>(() => new Promise(() => undefined));
    render(<PromptForm send={spy} />);
    type(company(), "Firma");
    type(story(), "Příběh");
    send();
    send();
    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("button", { name: "Odeslat" })).toBeDisabled();
  });

  it("fills the fields from an example", () => {
    render(<PromptForm send={ok} />);
    fireEvent.click(screen.getByRole("button", { name: "Příklad: Dodavatel" }));
    expect(company()).not.toHaveValue("");
    expect(story()).not.toHaveValue("");
  });

  it("clears only after the user confirms", () => {
    render(<PromptForm send={ok} />);
    expect(screen.queryByRole("button", { name: "Vymazat" })).not.toBeInTheDocument();
    type(company(), "Firma");
    fireEvent.click(screen.getByRole("button", { name: "Vymazat" }));
    fireEvent.click(screen.getByRole("button", { name: "Ponechat" }));
    expect(company()).toHaveValue("Firma");
    fireEvent.click(screen.getByRole("button", { name: "Vymazat" }));
    fireEvent.click(screen.getByRole("button", { name: "Smazat" }));
    expect(company()).toHaveValue("");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
