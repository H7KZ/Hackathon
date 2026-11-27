"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatItem } from "../../lib/chat/types";
import { A2uiSurface } from "../a2ui/Surface";
import { Icon, ICONS } from "../icons";
import { Composer } from "./Composer";
import { Thinking } from "./Thinking";
import type { ChatSession, LoggedMessage } from "./useChatSession";

export { LAYOUTS, type Layout } from "../../lib/chat/layout";

/** Splits `**bold**` like the A2UI Text component; chat text is plain otherwise. */
export function Bubble({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <p key={i}>
          {line
            .split(/(\*\*[^*]+\*\*)/g)
            .map((part, j) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <strong key={j}>{part.slice(2, -2)}</strong>
              ) : (
                part
              ),
            )}
        </p>
      ))}
    </>
  );
}

/**
 * Follows new content only while the reader is at the bottom (like a terminal); editing a chart or
 * scrolling up never yanks the view. A new big panel scrolls to its top so it is read from the start.
 */
function useAutoScroll(deps: unknown[], anchor?: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = anchor ? el.querySelector<HTMLElement>(`[data-item="${anchor}"]`) : null;
    if (target) el.scrollTop = target.offsetTop - 16;
    else if (atBottom.current) el.scrollTop = el.scrollHeight; // scroll-behavior: smooth in CSS
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** Big inline panel for a canvas surface inside the thread: title strip + A2UI meta + actions. */
function Panel({
  s,
  itemId,
  surfaceId,
  onInspect,
}: {
  s: ChatSession;
  itemId: string;
  surfaceId: string;
  onInspect?: (id: string) => void;
}) {
  const surface = s.state.surfaces[surfaceId];
  if (!surface) return null;
  const count = Object.keys(surface.components).length;
  return (
    <section className="panel" data-item={itemId} aria-label={surface.meta.title}>
      <header className="panel-head">
        <strong>{surface.meta.title}</strong>
        {onInspect && (
          <span className="panel-meta">
            A2UI · {count} {count < 5 ? "komponenty" : "komponent"}
          </span>
        )}
        {onInspect && (
          <button
            type="button"
            className="panel-btn"
            onClick={() => {
              onInspect(surfaceId);
            }}
          >
            <Icon path={ICONS.code} /> JSON
          </button>
        )}
      </header>
      <div className="panel-body">
        <A2uiSurface store={s.store} surfaceId={surfaceId} onAction={s.onAction} />
      </div>
    </section>
  );
}

function ThreadItems({
  s,
  items,
  inline,
  onInspect,
}: {
  s: ChatSession;
  items: ChatItem[];
  /** true: canvas surfaces render as panels in the thread */
  inline: boolean;
  onInspect?: (id: string) => void;
}) {
  return (
    <>
      {items.map((item) => {
        if (item.role !== "surface")
          return (
            <div key={item.id} className={`msg ${item.role}`}>
              <Bubble text={item.text} />
            </div>
          );
        const canvas = s.state.surfaces[item.surfaceId]?.meta.placement === "canvas";
        if (canvas && !inline) return null;
        return canvas ? (
          <Panel key={item.id} itemId={item.id} s={s} surfaceId={item.surfaceId} onInspect={onInspect} />
        ) : (
          <div key={item.id} className="msg surface">
            <A2uiSurface store={s.store} surfaceId={item.surfaceId} onAction={s.onAction} />
          </div>
        );
      })}
      {s.busy && <Thinking step={s.busy} />}
    </>
  );
}

/** A. One centered column: everything inline, like a document that writes itself. */
export function ThreadLayout({ s, onInspect }: { s: ChatSession; onInspect?: (id: string) => void }) {
  const last = s.items.at(-1);
  const panelId =
    last?.role === "surface" && s.state.surfaces[last.surfaceId]?.meta.placement === "canvas"
      ? last.id
      : null;
  const scroll = useAutoScroll([s.items.length, s.busy], panelId);
  return (
    <div className="thread-layout">
      <div className="thread-scroll" ref={scroll} aria-live="polite">
        <div className="thread-col">
          <ThreadItems s={s} items={s.items} inline onInspect={onInspect} />
        </div>
      </div>
      <div className="composer-dock">
        <Composer disabled={s.busy !== null} suggestions={s.suggestions} onSend={s.send} />
      </div>
    </div>
  );
}

function kindOf(m: LoggedMessage["message"]) {
  if ("createSurface" in m) return ["createSurface", m.createSurface.surfaceId] as const;
  if ("updateComponents" in m) return ["updateComponents", m.updateComponents.surfaceId] as const;
  if ("updateDataModel" in m) return ["updateDataModel", m.updateDataModel.surfaceId] as const;
  return ["deleteSurface", m.deleteSurface.surfaceId] as const;
}

/** B. Thread + protocol inspector: the A2UI stream and data models, live (the "how it works" view). */
export function InspectorLayout({ s }: { s: ChatSession }) {
  const [tab, setTab] = useState<"stream" | "data">("stream");
  const [picked, setPicked] = useState<string | null>(null);
  const target = picked && s.state.surfaces[picked] ? picked : s.focused;
  const list = useAutoScroll([s.messages.length, tab]);
  return (
    <div className="inspector-layout">
      <ThreadLayout
        s={s}
        onInspect={(id) => {
          setPicked(id);
          setTab("data");
        }}
      />
      <aside className="inspector" aria-label="A2UI inspektor">
        <div className="insp-head">
          <strong>A2UI</strong>
          <div className="seg" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "stream"}
              onClick={() => {
                setTab("stream");
              }}
            >
              Zprávy ({s.messages.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "data"}
              onClick={() => {
                setTab("data");
              }}
            >
              Data model
            </button>
          </div>
        </div>
        <div className="insp-body" ref={list}>
          {tab === "stream" ? (
            <ol className="insp-stream">
              {s.messages.map(({ n, message }) => {
                const [kind, id] = kindOf(message);
                return (
                  <li key={n}>
                    <details>
                      <summary>
                        <code className={`k-${kind}`}>{kind}</code> <span>{id}</span>
                      </summary>
                      <pre>{JSON.stringify(message, null, 2)}</pre>
                    </details>
                  </li>
                );
              })}
            </ol>
          ) : target ? (
            <>
              <select
                className="insp-pick"
                aria-label="Surface"
                value={target}
                onChange={(e) => {
                  setPicked(e.target.value);
                }}
              >
                {s.state.order.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <pre>{JSON.stringify(s.state.surfaces[target]?.data, null, 2)}</pre>
            </>
          ) : (
            <p className="insp-empty">Zatím žádná surface.</p>
          )}
        </div>
        <footer className="insp-foot">v1.0 · {s.state.order.length} surfaces · katalog JOJO v1</footer>
      </aside>
    </div>
  );
}

/** C. Chat column + canvas tabs (the first prototype), now full-bleed. */
export function SplitLayout({ s }: { s: ChatSession }) {
  const [view, setView] = useState<"chat" | "canvas">("chat");
  const scroll = useAutoScroll([s.items.length, s.busy]);
  const onAction: ChatSession["onAction"] = (a) => {
    if (a.name === "open_canvas") setView("canvas");
    s.onAction(a);
  };
  const s2 = { ...s, onAction };
  return (
    <div className={`split-layout show-${view}`}>
      <div className="view-toggle" role="group" aria-label="Zobrazení">
        <button
          type="button"
          aria-pressed={view === "chat"}
          onClick={() => {
            setView("chat");
          }}
        >
          Chat
        </button>
        <button
          type="button"
          aria-pressed={view === "canvas"}
          onClick={() => {
            setView("canvas");
          }}
        >
          Plátno ({s.canvasIds.length})
        </button>
      </div>
      <section className="chat-col" aria-label="Konverzace">
        <div className="thread" ref={scroll} aria-live="polite">
          <ThreadItems s={s2} items={s.items} inline={false} />
        </div>
        <Composer disabled={s.busy !== null} suggestions={s.suggestions} onSend={s.send} />
      </section>
      <section className="canvas" aria-label="Plátno">
        {s.canvasIds.length > 0 && (
          <div className="canvas-tabs" role="tablist" aria-label="Otevřené výstupy">
            {s.canvasIds.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === s.focused}
                onClick={() => {
                  s.setFocus(id);
                }}
              >
                {s.state.surfaces[id]?.meta.title ?? id}
              </button>
            ))}
          </div>
        )}
        <div className="canvas-body">
          {s.focused ? (
            <A2uiSurface key={s.focused} store={s.store} surfaceId={s.focused} onAction={onAction} />
          ) : (
            <div className="canvas-empty">
              <Icon path={ICONS.canvas} />
              <p>Tady se objeví návrh příběhu, grafy a tabulky.</p>
              <small>Agenti zatím pracují, výsledky sem pošlou sami.</small>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
