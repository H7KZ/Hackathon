import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DemoBundle, DemoIndexEntry } from "@s2d/schema/demo";
import { DemoPicker } from "../../components/chat/DemoPicker";
import { validateComponents } from "../../lib/a2ui/catalog";
import type { ComponentNode } from "../../lib/a2ui/protocol";
import { createDemoSource, pickCase, sourceFromBundle } from "../../lib/chat/demoSource";
import { createDemoTransport, eventDelay } from "../../lib/chat/demoTransport";
import type { SourceEvent } from "../../lib/chat/types";

const PUBLIC = join(import.meta.dirname, "../../public/demo");
const read = (file: string): unknown => JSON.parse(readFileSync(join(PUBLIC, file), "utf8"));
const bundle = read("eshop_carrier.json") as DemoBundle;
const index = (read("index.json") as { cases: DemoIndexEntry[] }).cases;

type Created = { createSurface: { surfaceId: string; components?: ComponentNode[] } };
const created = (events: SourceEvent[]) =>
  events.flatMap((e) => (e.type === "a2ui" && "createSurface" in e.message ? [e.message as Created] : []));
const ids = (events: SourceEvent[]) => created(events).map((m) => m.createSurface.surfaceId);
const surface = (events: SourceEvent[], id: string) =>
  created(events).find((m) => m.createSurface.surfaceId === id)?.createSurface.components ?? [];
const says = (events: SourceEvent[]) => events.flatMap((e) => (e.type === "say" ? [e.text] : []));
const action = (name: string, context: Record<string, unknown> = {}) => ({
  kind: "action" as const,
  action: { name, surfaceId: "x", sourceComponentId: "b", timestamp: "2026-11-28T10:00:00Z", context },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("demo replay (recorded session, no API)", () => {
  it("plays draft → approve → detective → what-if from the recording, every surface valid", async () => {
    const events: SourceEvent[] = [];
    const source = sourceFromBundle(bundle, { speed: 0 });
    expect(source.demo).toBe(true);
    const stop = source.start((e) => events.push(e));

    await vi.waitFor(() => {
      expect(ids(events)).toContain("story");
    });
    expect(ids(events)).toEqual(["progress-1", "company", "story"]);
    // the story is fixed in a replay: read-only curve, no settings that would change the data
    const story = surface(events, "story");
    expect(story.find((c) => c.component === "CurveEditor")?.locked).toBe(true);
    expect(story.find((c) => c.id === "root")?.children).toEqual([
      "intro",
      "curve",
      "curveHelp",
      "s-exp",
      "actions",
    ]);

    source.send(action("approve", { points: [] }));
    await vi.waitFor(() => {
      expect(ids(events)).toContain("ready-dat1");
    });
    const dat1 = surface(events, "dataset-dat1");
    expect(dat1.map((c) => c.id)).toContain("dl-xlsx");
    expect(dat1.map((c) => c.id)).not.toContain("dl-csv");
    // real tables from the recording: 9 observed tables, rows from DuckDB
    const tables = dat1.filter((c) => c.component === "Table" && c.id.startsWith("table"));
    expect(tables.length).toBe(6);
    // a table already looks like a card, so it is not wrapped in another one
    expect(dat1.filter((c) => c.component === "Card")).toEqual([]);

    source.send(action("detect", { datasetId: "dat1" }));
    await vi.waitFor(() => {
      expect(ids(events)).toContain("detective-dat1");
    });
    expect(says(events).some((t) => t.includes("Detektiv data neznal a našel 100 %"))).toBe(true);

    source.send({ kind: "text", text: "Co kdyby pršelo?" });
    await vi.waitFor(() => {
      expect(says(events).some((t) => t.includes("připravené jen otázky"))).toBe(true);
    });

    source.send({ kind: "text", text: bundle.suggestions[0] ?? "" });
    await vi.waitFor(() => {
      expect(ids(events)).toContain("dataset-dat2");
    });
    const dat2 = surface(events, "dataset-dat2");
    expect(dat2.map((c) => c.id)).toContain("cmp-root");
    expect(dat2.map((c) => c.id)).not.toContain("dl");
    stop();

    for (const m of created(events))
      expect(validateComponents(m.createSurface.surfaceId, m.createSurface.components ?? [])).toEqual([]);
    expect(events).toContainEqual({ type: "suggest", items: bundle.suggestions });
  });

  it("a story with two levers (card_fraud) freezes every lever tab and offers no curve edit", async () => {
    const fraud = read("card_fraud.json") as DemoBundle;
    const events: SourceEvent[] = [];
    const source = sourceFromBundle(fraud, { speed: 0 });
    const stop = source.start((e) => events.push(e));
    await vi.waitFor(() => {
      expect(ids(events)).toContain("story");
    });
    const story = surface(events, "story");
    expect(story.find((c) => c.id === "root")?.children).toEqual(["intro", "leverTabs", "s-exp", "actions"]);
    const curves = story.filter((c) => c.component === "CurveEditor" && c.id.startsWith("lv"));
    expect(curves.length).toBe(2);
    for (const c of curves) expect(c.locked).toBe(true);
    expect(story.find((c) => c.id === "lv")?.children).toEqual(["lvCurve", "lvHelp"]);
    source.send(action("approve", { points: [] }));
    await vi.waitFor(() => {
      expect(ids(events)).toContain("ready-dat1");
    });
    stop();
    expect(surface(events, "ready-dat1").find((c) => c.id === "row")?.children).toEqual(["detect", "open"]);
  });

  it("the lazy source shows the recorded prompt, and a failed load says so", async () => {
    const events: SourceEvent[] = [];
    const stop = createDemoSource("eshop_carrier", { speed: 0, load: () => Promise.resolve(bundle) }).start(
      (e) => events.push(e),
    );
    await vi.waitFor(() => {
      expect(ids(events)).toContain("story");
    });
    stop();
    expect(events).toContainEqual({
      type: "say",
      role: "user",
      text: expect.stringContaining("VoltMarket") as unknown,
    });

    const failed: SourceEvent[] = [];
    createDemoSource("nope", { load: () => Promise.reject(new Error("HTTP 404")) }).start((e) =>
      failed.push(e),
    );
    await vi.waitFor(() => {
      expect(says(failed).some((t) => t.includes("Ukázku se nepodařilo načíst (HTTP 404)"))).toBe(true);
    });
  });
});

describe("demo transport", () => {
  it("answers recorded GETs, trims previews to ?limit and refuses unknown paths", async () => {
    const t = createDemoTransport(bundle, { speed: 0 });
    const base = `/sessions/demo-${bundle.id}`;
    const preview = await t.getJson<{ rowsShown: unknown[]; rows: number }>(
      `${base}/datasets/dat1/tables/shipment?limit=8`,
    );
    expect(preview.rowsShown).toHaveLength(8);
    expect(preview.rows).toBeGreaterThan(8000);
    const labels = await t.getJson<{ labels: Record<string, string> }>(`${base}/labels?dataset=dat2`);
    expect(Object.keys(labels.labels).length).toBeGreaterThan(2000);
    await expect(t.getJson(`${base}/datasets/dat9/evidence`)).rejects.toThrow("HTTP 404");
    const state = await t.getJson<{ datasets: unknown[]; status: string }>(base);
    expect(state).toMatchObject({ status: "drafting", datasets: [] });
  });

  it("is busy while a phase plays and paces events like a short real run", async () => {
    const t = createDemoTransport(bundle, { speed: 0 });
    const got: string[] = [];
    const close = t.events(
      `/sessions/demo-${bundle.id}/events`,
      (d) => got.push(d),
      () => undefined,
    );
    expect(t.busy).toBe(true);
    const res = await t.send("POST", `/sessions/demo-${bundle.id}/commands`, { type: "approve" });
    expect(res.status).toBe(409);
    await vi.waitFor(() => {
      expect(t.busy).toBe(false);
    });
    close();
    expect(got.map((d) => (JSON.parse(d) as { seq: number }).seq)).toEqual(bundle.draft.map((_, i) => i + 1));
    const total = bundle.approve.reduce((n, e) => n + eventDelay(e), 0);
    expect(total).toBeGreaterThan(2000);
    expect(total).toBeLessThan(10_000);
  });
});

describe("demo picker", () => {
  it("lists every recorded case with real numbers and a replay link", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ cases: index }))));
    render(<DemoPicker />);
    const links = await screen.findAllByRole("link", { name: "Přehrát ukázku" });
    expect(links.map((a) => a.getAttribute("href"))).toEqual(index.map((c) => `/chat?demo=${c.id}`));
    expect(screen.getByRole("heading", { name: "E-shop: dopravce nestíhá" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Stáhnout data (.xlsx)" })).toHaveLength(index.length);
  });

  it("picks the case closest to a typed prompt", () => {
    expect(pickCase(index, { company: "Banka", story: "Útočníci zkoušejí kradené karty" })?.id).toBe(
      "card_fraud",
    );
    expect(
      pickCase(index, { company: "Poskytovatel internetu", story: "Routery padají po aktualizaci firmwaru" })
        ?.id,
    ).toBe("isp_firmware");
    expect(pickCase(index, { company: "x", story: "y" })?.id).toBe(index[0]?.id);
  });
});
