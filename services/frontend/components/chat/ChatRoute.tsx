"use client";

import { useMemo, useSyncExternalStore } from "react";
import { createLiveSource } from "../../lib/chat/liveSource";
import { createMockSource } from "../../lib/chat/mockSource";
import { findEntry } from "../../lib/history";
import { EXAMPLES } from "../../lib/prompt";
import { ChatWorkspace } from "./ChatWorkspace";
import type { Layout } from "../../lib/chat/layout";

const noop = () => () => undefined;
/** false during SSR and hydration, true afterwards (history lives in localStorage). */
const useHydrated = () =>
  useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

export function ChatRoute({
  demo,
  sessionId,
  layout = "thread",
  switcher = false,
}: {
  demo: boolean;
  sessionId: string | null;
  layout?: Layout;
  switcher?: boolean;
}) {
  const hydrated = useHydrated();
  const chat = useMemo(() => {
    if (!hydrated) return null;
    const entry = sessionId ? findEntry(sessionId) : undefined;
    if (demo) {
      const input = entry ?? EXAMPLES[0];
      return { source: createMockSource(input), title: input.company };
    }
    if (sessionId) return { source: createLiveSource(sessionId), title: entry?.company ?? "Chat" };
    return "missing" as const;
  }, [hydrated, demo, sessionId]);

  if (chat === "missing")
    return (
      <div className="chat-missing">
        <p>Tenhle chat neexistuje.</p>
        <a href="/">Začít nový</a> · <a href="/chat?demo=1">Ukázka s demo daty</a>
      </div>
    );
  if (!chat) return null;
  return (
    <ChatWorkspace
      source={chat.source}
      title={chat.title}
      layout={layout}
      sessionId={sessionId ?? undefined}
      switcher={switcher}
    />
  );
}
