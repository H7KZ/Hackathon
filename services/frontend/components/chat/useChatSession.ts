"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { A2uiAction, A2uiMessage } from "../../lib/a2ui/protocol";
import { createSurfaceStore } from "../../lib/a2ui/store";
import type { ChatItem, ChatSource, SourceEvent } from "../../lib/chat/types";
import { useStoreState } from "../a2ui/Surface";

export type LoggedMessage = { n: number; message: A2uiMessage };
type Log = { run: number; items: ChatItem[]; messages: LoggedMessage[] };

const MAX_MESSAGES = 300;

/**
 * Everything a chat layout needs, independent of how it is laid out: the surface store, the thread
 * (bubbles + every surface in arrival order), busy step, quick replies and the raw A2UI message log.
 */
export function useChatSession(source: ChatSource) {
  const store = useMemo(() => createSurfaceStore(), []);
  const state = useStoreState(store);
  // `run` tags entries with the effect run that produced them: StrictMode starts the source twice in dev
  const [log, setLog] = useState<Log>({ run: 0, items: [], messages: [] });
  const [busy, setBusy] = useState<string | null>("Připojuji se");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const seq = useRef(0);
  const runs = useRef(0);

  useEffect(() => {
    const run = ++runs.current;
    const update = (patch: (l: Log) => Partial<Log>) => {
      setLog((l) => {
        const base = l.run === run ? l : { run, items: [], messages: [] };
        return { ...base, ...patch(base) };
      });
    };
    const onEvent = (e: SourceEvent) => {
      const n = ++seq.current;
      const id = `i${String(n)}`;
      if (e.type === "say") update((l) => ({ items: [...l.items, { id, role: e.role, text: e.text }] }));
      else if (e.type === "busy") setBusy(e.step);
      else if (e.type === "suggest") setSuggestions(e.items);
      else {
        const error = store.apply(e.message);
        if (error) console.warn("A2UI", error);
        const created = "createSurface" in e.message && !error ? e.message.createSurface : null;
        update((l) => ({
          messages: [...l.messages, { n, message: e.message }].slice(-MAX_MESSAGES),
          ...(created && {
            items: [...l.items, { id, role: "surface" as const, surfaceId: created.surfaceId }],
          }),
        }));
        if (created?.metadata?.placement === "canvas") setFocus(created.surfaceId);
      }
    };
    store.reset(); // external store, not React state: a clean slate for this run
    return source.start(onEvent);
  }, [source, store]);

  const onAction = useCallback(
    (action: A2uiAction) => {
      if (action.name === "open_canvas" && typeof action.context.surfaceId === "string") {
        setFocus(action.context.surfaceId);
      }
      source.send({ kind: "action", action });
    },
    [source],
  );

  const send = useCallback(
    (text: string) => {
      source.send({ kind: "text", text });
    },
    [source],
  );

  const canvasIds = state.order.filter((id) => state.surfaces[id]?.meta.placement === "canvas");
  const focused = focus && state.surfaces[focus] ? focus : (canvasIds.at(-1) ?? null);

  // only a live session can be cancelled (the API aborts the job and returns to the last stable state)
  const cancel = useMemo(() => (source.cancel ? () => source.cancel?.() : undefined), [source]);

  return {
    cancel,
    store,
    state,
    items: log.items,
    messages: log.messages,
    busy,
    suggestions,
    canvasIds,
    focused,
    setFocus,
    onAction,
    send,
  };
}

export type ChatSession = ReturnType<typeof useChatSession>;
