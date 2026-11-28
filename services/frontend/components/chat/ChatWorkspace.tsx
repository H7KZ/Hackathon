"use client";

import type { ChatSource } from "../../lib/chat/types";
import { AppShell } from "./AppShell";
import { DemoSwitch } from "./DemoPicker";
import { InspectorLayout, SplitLayout, ThreadLayout, type Layout } from "./layouts";
import { useChatSession } from "./useChatSession";

const LABEL: Record<Layout, string> = {
  thread: "Vlákno",
  inspector: "Vlákno + A2UI",
  split: "Chat + plátno",
};

/** Full-screen workspace: history sidebar + one of the layouts (docs/design/patterns.md). */
export function ChatWorkspace({
  source,
  title,
  layout = "thread",
  sessionId,
  switcher = false,
  demoCase,
}: {
  source: ChatSource;
  title: string;
  layout?: Layout;
  sessionId?: string;
  /** show links to the other layouts (the /lab routes) */
  switcher?: boolean;
  /** a recorded demo case: the topbar offers the other cases */
  demoCase?: string;
}) {
  const s = useChatSession(source);
  return (
    <AppShell
      activeId={sessionId}
      topbar={
        <>
          <h1 className="topbar-title">{title}</h1>
          {source.demo && <span className="demo-badge">Demo data</span>}
          {demoCase && <DemoSwitch current={demoCase} />}
          {switcher && (
            <nav className="seg layout-switch" aria-label="Rozložení">
              {(Object.keys(LABEL) as Layout[]).map((l) => (
                <a key={l} href={`/lab/${l}`} aria-current={l === layout ? "page" : undefined}>
                  {LABEL[l]}
                </a>
              ))}
            </nav>
          )}
        </>
      }
    >
      <div className="workspace">
        {layout === "thread" && <ThreadLayout s={s} />}
        {layout === "inspector" && <InspectorLayout s={s} />}
        {layout === "split" && <SplitLayout s={s} />}
      </div>
    </AppShell>
  );
}
