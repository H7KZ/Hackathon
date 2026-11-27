"use client";

import { useMemo, useState } from "react";
import type { A2uiAction } from "../lib/a2ui/protocol";
import { COMPONENTS } from "../lib/a2ui/catalog";
import { createSurfaceStore } from "../lib/a2ui/store";
import { LOADING_PHRASES } from "../lib/chat/phrases";
import {
  MOCK_COMPANY,
  MOCK_POINTS,
  PERIOD,
  curvePreview,
  mockCompare,
  mockDataset,
  mockDetective,
} from "../lib/chat/mockData";
import {
  companySurface,
  compareSurface,
  datasetSurface,
  detectiveSurface,
  progressSurface,
  readySurface,
  storySurface,
} from "../lib/chat/surfaces";
import { A2uiSurface } from "./a2ui/Surface";
import { Thinking } from "./chat/Thinking";

const TOKENS = [
  ["fis-dark", "#00201b", "text"],
  ["green", "#00957d", "primary, series 1"],
  ["green-dark", "#006252", "labels, pass"],
  ["green-light", "#33b39e", "hover"],
  ["mint", "#00d2b0", "glow"],
  ["blue", "#009ee0", "info, dataset B"],
  ["amber", "#c77700", "story points only"],
  ["violet", "#7a5cc7", "series 3"],
  ["error", "#b42800", "errors, fail"],
  ["muted", "#5b6563", "secondary text"],
  ["line", "#e3eae8", "borders"],
  ["wash", "#f1f9f7", "focus, agent bubble"],
] as const;

/** Every presenter surface on mock data: the catalog in real use. */
function useGallery() {
  return useMemo(() => {
    const store = createSurfaceStore();
    const ds = mockDataset("d1", MOCK_POINTS);
    const surfaces = [
      progressSurface("g-progress", "Generování dat", [
        { id: "a", label: "Skládám scénář", state: "done", detail: "2 iterace" },
        { id: "b", label: "Generuji data", state: "running" },
        { id: "c", label: "Ověřuji důkazy", state: "pending" },
        { id: "d", label: "Detektiv pátrá", state: "failed", detail: "timeout" },
      ]),
      companySurface("g-company", MOCK_COMPANY),
      readySurface("g-ready", "d1"),
      storySurface("g-story", MOCK_POINTS, curvePreview(MOCK_POINTS), PERIOD),
      datasetSurface("g-dataset", ds),
      detectiveSurface("g-detective", mockDetective("d1")),
      compareSurface("g-compare", mockCompare("Co kdyby dodavatel zpožďoval jen 2 týdny?", MOCK_POINTS)),
    ];
    for (const s of surfaces) store.apply(s);
    return { store, ids: surfaces.map((s) => ("createSurface" in s ? s.createSurface.surfaceId : "")) };
  }, []);
}

export function DesignGallery() {
  const { store, ids } = useGallery();
  const [last, setLast] = useState<A2uiAction | null>(null);
  const onAction = (a: A2uiAction) => {
    setLast(a);
  };
  const chat = ids.slice(0, 3);
  const canvas = ids.slice(3);
  return (
    <div className="design">
      <header>
        <h1>JOJO design systém</h1>
        <p>
          Živá ukázka tokenů a komponent A2UI katalogu. Pravidla: <code>docs/design/</code>.
        </p>
      </header>

      <section>
        <h2>Barvy</h2>
        <ul className="swatches">
          {TOKENS.map(([name, hex, use]) => (
            <li key={name}>
              <span style={{ background: hex }} />
              <strong>{name}</strong>
              <code>{hex}</code>
              <small>{use}</small>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Typografie</h2>
        <p className="type-display">JOJO</p>
        <p className="a2-text h1">Nadpis 1 – Dataset d1</p>
        <p className="a2-text h2">Nadpis 2 – Návrh příběhu</p>
        <p className="a2-text h3">Nadpis 3 – Body příběhu</p>
        <p className="a2-text">Text – Z vašeho příběhu vytvoříme data, ve kterých se dá dohledat.</p>
        <p className="a2-text caption">Popisek – ◆ = bod příběhu</p>
      </section>

      <section>
        <h2>Chat</h2>
        <div className="design-chat">
          <div className="msg user">
            <p>
              <strong>E-shop s domácími spotřebiči</strong>
            </p>
            <p>Dodavatel začal v březnu zpožďovat dodávky.</p>
          </div>
          <div className="msg agent">
            <p>Pouštím se do toho. Nejdřív firmu poznám, pak navrhnu příběh.</p>
          </div>
          <Thinking step="Kreslím vlivy" />
          {chat.map((id) => (
            <div key={id} className="msg surface">
              <A2uiSurface store={store} surfaceId={id} onAction={onAction} />
            </div>
          ))}
        </div>
        <h3>Hlášky při čekání</h3>
        <ol className="phrases">
          {LOADING_PHRASES.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
      </section>

      {canvas.map((id) => (
        <section key={id}>
          <h2>Plátno: {store.getSnapshot().surfaces[id]?.meta.title}</h2>
          <div className="design-canvas">
            <A2uiSurface store={store} surfaceId={id} onAction={onAction} />
          </div>
        </section>
      ))}

      <section>
        <h2>Katalog</h2>
        <p>
          {COMPONENTS.length} komponent: {COMPONENTS.join(", ")}.
        </p>
        <p role="status" className="design-action">
          {last ? (
            <>
              Poslední akce: <code>{JSON.stringify({ name: last.name, context: last.context })}</code>
            </>
          ) : (
            "Klikněte na tlačítko v ukázce: akce se vypíše sem."
          )}
        </p>
      </section>
    </div>
  );
}
