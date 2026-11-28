import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import HomePage from "../../app/page";
import { ChatWorkspace } from "../../components/chat/ChatWorkspace";
import { validateComponents } from "../../lib/a2ui/catalog";
import { createMockSource } from "../../lib/chat/mockSource";
import { LOADING_PHRASES, phraseAt } from "../../lib/chat/phrases";
import type { SourceEvent } from "../../lib/chat/types";
import { loadHistory, remember } from "../../lib/history";
import { EXAMPLES } from "../../lib/prompt";

const input = { company: EXAMPLES[0].company, story: EXAMPLES[0].story };
const created = (events: SourceEvent[]) =>
  events.flatMap((e) => (e.type === "a2ui" && "createSurface" in e.message ? [e.message] : []));
const ids = (events: SourceEvent[]) =>
  created(events).map((m) => ("createSurface" in m ? m.createSurface.surfaceId : ""));
const action = (name: string, context: Record<string, unknown> = {}) => ({
  kind: "action" as const,
  action: { name, surfaceId: "x", sourceComponentId: "b", timestamp: "2026-11-27T10:00:00Z", context },
});

afterEach(() => {
  localStorage.clear();
  window.history.pushState(null, "", "/");
});

describe("mock demo workflow", () => {
  it("plays draft → approve → dataset → detective → what-if, all surfaces valid in the JOJO catalog", async () => {
    const events: SourceEvent[] = [];
    const source = createMockSource(input, { speed: 0 });
    const stop = source.start((e) => events.push(e));

    await vi.waitFor(() => {
      expect(ids(events)).toContain("story");
    });
    expect(ids(events)).toEqual(["progress-1", "company", "story"]);

    source.send(action("approve", { points: undefined }));
    await vi.waitFor(() => {
      expect(ids(events)).toContain("ready-dat1");
    });
    expect(ids(events)).toContain("dataset-dat1");

    source.send(action("detect", { datasetId: "dat1" }));
    await vi.waitFor(() => {
      expect(ids(events)).toContain("detective-dat1");
    });

    source.send({ kind: "text", text: "Co kdyby dodavatel zpožďoval jen 2 týdny?" });
    await vi.waitFor(() => {
      expect(ids(events)).toContain("dataset-dat2");
    });
    stop();

    for (const m of created(events)) {
      if (!("createSurface" in m)) continue;
      expect(validateComponents(m.createSurface.surfaceId, m.createSurface.components ?? [])).toEqual([]);
    }
    expect(events.at(-1)).toEqual({ type: "suggest", items: expect.any(Array) as unknown });
  });

  it("refuses approve before the story exists and explains why", () => {
    const events: SourceEvent[] = [];
    const source = createMockSource(input, { speed: 0 });
    const stop = source.start((e) => events.push(e));
    source.send(action("approve"));
    stop();
    expect(events).toContainEqual({
      type: "say",
      role: "agent",
      text: expect.stringMatching(/Teď to nejde/) as unknown,
    });
  });
});

describe("chat workspace", () => {
  it("thread layout: thinking, story panel inline, approving generates the dataset", async () => {
    render(<ChatWorkspace source={createMockSource(input, { speed: 0 })} title={input.company} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Demo data")).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Návrh příběhu" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Generovat data" }));
    expect(await screen.findByRole("region", { name: "Dataset dat1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Spustit detektiva" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Historie chatů" })).toBeInTheDocument();
  });

  it("split layout puts big surfaces in canvas tabs", async () => {
    render(<ChatWorkspace source={createMockSource(input, { speed: 0 })} title="x" layout="split" />);
    expect(await screen.findByRole("tab", { name: "Návrh příběhu", selected: true })).toBeInTheDocument();
  });

  it("inspector layout logs every A2UI message and shows data models", async () => {
    render(<ChatWorkspace source={createMockSource(input, { speed: 0 })} title="x" layout="inspector" />);
    await screen.findByRole("region", { name: "Návrh příběhu" });
    expect(screen.getByRole("tab", { name: /^Zprávy/ })).toBeInTheDocument();
    expect(screen.getAllByText("createSurface").length).toBeGreaterThan(0);
    const [json] = screen.getAllByRole("button", { name: "JSON" });
    if (json) fireEvent.click(json);
    expect(screen.getByRole("tab", { name: "Data model", selected: true })).toBeInTheDocument();
  });
});

describe("landing → chat", () => {
  it("in demo mode the prompt box turns into the chat and the URL points at it", async () => {
    window.history.pushState(null, "", "/?demo=1");
    render(<HomePage />);
    fireEvent.change(screen.getByLabelText("Firma"), { target: { value: input.company } });
    fireEvent.change(screen.getByLabelText("Příběh"), { target: { value: input.story } });
    fireEvent.click(screen.getByRole("button", { name: "Odeslat" }));
    expect(await screen.findByText("Demo data")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/chat");
    expect(window.location.search).toMatch(/demo=1&s=demo-/);
    expect(loadHistory()[0]).toMatchObject({ company: input.company, demo: true });
  });
});

describe("history and loading copy", () => {
  it("keeps newest first, dedupes by id, caps at 20", () => {
    for (let i = 0; i < 25; i++)
      remember({ id: `s${String(i)}`, company: "F", story: "P", createdAt: "2026-11-27", demo: false });
    remember({ id: "s3", company: "F", story: "P", createdAt: "2026-11-27", demo: true });
    const list = loadHistory();
    expect(list).toHaveLength(20);
    expect(list[0]).toMatchObject({ id: "s3", demo: true });
  });

  it("rotates through all phrases without repeating neighbours", () => {
    const seen = Array.from({ length: LOADING_PHRASES.length }, (_, i) => phraseAt(i));
    expect(new Set(seen).size).toBe(LOADING_PHRASES.length);
    expect(phraseAt(0)).not.toBe(phraseAt(1));
  });
});

describe("thread extras (run-4 follow-up)", () => {
  it("quick replies sit at the end of the thread, not in the composer; what-if adds a compare tab", async () => {
    const { container } = render(
      <ChatWorkspace source={createMockSource(input, { speed: 0 })} title={input.company} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Generovat data" }));
    await screen.findByRole("region", { name: "Dataset dat1" });
    const [quick] = await screen.findAllByRole("button", { name: /Co kdyby/ });
    if (!quick) throw new Error("no quick reply");
    expect(container.querySelector(".thread-col")?.contains(quick)).toBe(true);
    expect(container.querySelector(".composer")?.querySelector(".suggest")).toBeNull();
    expect(screen.getByText(/Detektiv\*\*|druhý agent/)).toBeInTheDocument();
    fireEvent.click(quick);
    const ds2 = await screen.findByRole("region", { name: "Dataset dat2" });
    expect(ds2.querySelector('[role="tab"]:last-child')?.textContent).toBe("Porovnání s dat1");
  });

  it("Otevřít data scrolls to and flashes the dataset panel", async () => {
    const { container } = render(
      <ChatWorkspace source={createMockSource(input, { speed: 0 })} title={input.company} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Generovat data" }));
    const panel = await screen.findByRole("region", { name: "Dataset dat1" });
    fireEvent.click(screen.getByRole("button", { name: "Otevřít data" }));
    await vi.waitFor(() => {
      expect(panel.classList.contains("flash")).toBe(true);
    });
    expect(container).toBeTruthy();
  });
});
