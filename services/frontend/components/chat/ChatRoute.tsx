"use client";

import { useMemo, useSyncExternalStore } from "react";
import { createLiveSource } from "../../lib/chat/liveSource";
import { createDemoSource } from "../../lib/chat/demoSource";
import { findEntry } from "../../lib/history";
import { AppShell } from "./AppShell";
import { ChatWorkspace } from "./ChatWorkspace";
import { DemoPicker } from "./DemoPicker";
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
  demoCase = null,
  sessionId,
  layout = "thread",
  switcher = false,
}: {
  demo: boolean;
  /** recorded case to replay; null in demo mode = the case picker (or the case of the history entry) */
  demoCase?: string | null;
  sessionId: string | null;
  layout?: Layout;
  switcher?: boolean;
}) {
  const hydrated = useHydrated();
  const chat = useMemo(() => {
    if (!hydrated) return null;
    const entry = sessionId ? findEntry(sessionId) : undefined;
    if (demo) {
      const caseId = demoCase ?? entry?.demoCase ?? null;
      if (!caseId) return "picker" as const;
      return { source: createDemoSource(caseId), title: entry?.company ?? "Ukázka", caseId };
    }
    if (sessionId) return { source: createLiveSource(sessionId), title: entry?.company ?? "Chat" };
    return "missing" as const;
  }, [hydrated, demo, demoCase, sessionId]);

  if (chat === "picker")
    return (
      <AppShell>
        <div className="landing-scroll demo-scroll">
          <DemoPicker />
        </div>
      </AppShell>
    );

  if (chat === "missing")
    return (
      <div className="chat-missing">
        <p>Tenhle chat neexistuje.</p>
        <a href="/">Začít nový</a> · <a href="/chat?demo=1">Ukázky s demo daty</a>
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
      {...("caseId" in chat && { demoCase: chat.caseId })}
    />
  );
}
