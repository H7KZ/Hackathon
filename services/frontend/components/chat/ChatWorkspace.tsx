"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { A2uiAction } from "../../lib/a2ui/protocol";
import { createSurfaceStore } from "../../lib/a2ui/store";
import type { ChatItem, ChatSource, SourceEvent } from "../../lib/chat/types";
import { A2uiSurface, useStoreState } from "../a2ui/Surface";
import { Icon, ICONS } from "../icons";
import { Composer } from "./Composer";
import { HistoryMenu } from "./HistoryMenu";
import { Thinking } from "./Thinking";

/** Splits `**bold**` like the A2UI Text component; chat text is plain otherwise. */
function Bubble({ text }: { text: string }) {
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
 * Chat (left) + canvas (right). Surfaces with `metadata.placement: "canvas"` open as canvas tabs,
 * the rest render inline in the thread (docs/design/patterns.md "Chat + canvas").
 */
export function ChatWorkspace({ source, title }: { source: ChatSource; title: string }) {
  const store = useMemo(() => createSurfaceStore(), []);
  const state = useStoreState(store);
  // `run` tags items with the effect run that produced them: StrictMode starts the source twice in dev
  const [log, setLog] = useState<{ run: number; items: ChatItem[] }>({ run: 0, items: [] });
  const items = log.items;
  const [busy, setBusy] = useState<string | null>("Připojuji se");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "canvas">("chat");
  const seq = useRef(0);
  const runs = useRef(0);
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const run = ++runs.current;
    const add = (item: ChatItem) => {
      setLog((t) => (t.run === run ? { run, items: [...t.items, item] } : { run, items: [item] }));
    };
    const onEvent = (e: SourceEvent) => {
      const id = `i${String(++seq.current)}`;
      if (e.type === "say") add({ id, role: e.role, text: e.text });
      else if (e.type === "busy") setBusy(e.step);
      else if (e.type === "suggest") setSuggestions(e.items);
      else {
        const error = store.apply(e.message);
        if (error) console.warn("A2UI", error);
        if ("createSurface" in e.message && !error) {
          const { surfaceId, metadata } = e.message.createSurface;
          if (metadata?.placement === "canvas") setActive(surfaceId);
          else add({ id, role: "surface", surfaceId });
        }
      }
    };
    store.reset(); // external store, not React state: a clean slate for this run
    return source.start(onEvent);
  }, [source, store]);

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight; // .thread has scroll-behavior: smooth
  }, [items, busy]);

  const onAction = useCallback(
    (action: A2uiAction) => {
      if (action.name === "open_canvas" && typeof action.context.surfaceId === "string") {
        setActive(action.context.surfaceId);
        setView("canvas");
      }
      source.send({ kind: "action", action });
    },
    [source],
  );

  const canvas = state.order.filter((id) => state.surfaces[id]?.meta.placement === "canvas");
  const current = active && state.surfaces[active] ? active : (canvas.at(-1) ?? null);

  return (
    <div className="chat-page">
      <div className="chat-frame">
        <header className="chat-head">
          <HistoryMenu />
          <a href="/" className="chat-brand" title="Nový chat">
            <img src="/fis-logo.png" alt="FIS VŠE" />
            <span>JOJO</span>
          </a>
          <h1 className="chat-title">{title}</h1>
          {source.demo && <span className="demo-badge">Demo data</span>}
          <div className="view-toggle" role="group" aria-label="Zobrazení">
            <button
              type="button"
              aria-pressed={view === "chat"}
              onClick={() => {
                setView("chat");
              }}
            >
              <Icon path={ICONS.chat} /> Chat
            </button>
            <button
              type="button"
              aria-pressed={view === "canvas"}
              onClick={() => {
                setView("canvas");
              }}
            >
              <Icon path={ICONS.canvas} /> Plátno{canvas.length > 0 && ` (${String(canvas.length)})`}
            </button>
          </div>
        </header>

        <div className={`chat-body show-${view}`}>
          <section className="chat-col" aria-label="Konverzace">
            <div className="thread" ref={thread} aria-live="polite">
              {items.map((item) =>
                item.role === "surface" ? (
                  <div key={item.id} className="msg surface">
                    <A2uiSurface store={store} surfaceId={item.surfaceId} onAction={onAction} />
                  </div>
                ) : (
                  <div key={item.id} className={`msg ${item.role}`}>
                    <Bubble text={item.text} />
                  </div>
                ),
              )}
              {busy && <Thinking step={busy} />}
            </div>
            <Composer
              disabled={busy !== null}
              suggestions={suggestions}
              onSend={(text) => {
                source.send({ kind: "text", text });
              }}
            />
          </section>

          <section className="canvas" aria-label="Plátno">
            {canvas.length > 0 && (
              <div className="canvas-tabs" role="tablist" aria-label="Otevřené výstupy">
                {canvas.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={id === current}
                    onClick={() => {
                      setActive(id);
                    }}
                  >
                    {state.surfaces[id]?.meta.title ?? id}
                  </button>
                ))}
              </div>
            )}
            <div className="canvas-body">
              {current ? (
                <A2uiSurface key={current} store={store} surfaceId={current} onAction={onAction} />
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
      </div>
    </div>
  );
}
