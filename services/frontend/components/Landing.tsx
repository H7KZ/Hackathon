"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createSession } from "../lib/api";
import { createLiveSource } from "../lib/chat/liveSource";
import { createDemoSource, loadDemoIndex, pickCase } from "../lib/chat/demoSource";
import type { ChatSource } from "../lib/chat/types";
import { chatHref, remember } from "../lib/history";
import { ChatWorkspace } from "./chat/ChatWorkspace";
import { AppShell } from "./chat/AppShell";
import { PromptForm, type Send, type SessionInfo } from "./PromptForm";
import { PromptHelp } from "./PromptHelp";

const isDemo = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");

/** Runs `update` inside a View Transition so the prompt box morphs into the chat frame (`jojo-shell`). */
export function morph(update: () => void) {
  const reduced =
    typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof document.startViewTransition !== "function") update();
  else document.startViewTransition(update);
}

/** Landing → chat in place: no navigation, so the box can grow into the workspace (docs/design/patterns.md). */
export function Landing() {
  const [chat, setChat] = useState<{
    source: ChatSource;
    title: string;
    id: string;
    demoCase?: string;
  } | null>(null);
  /** demo mode: the recorded case closest to what was typed (lib/chat/demoSource.ts pickCase) */
  const picked = useRef<{ id: string; title: string } | null>(null);

  const send: Send = async (input) => {
    if (!isDemo()) return createSession(input);
    const cases = await loadDemoIndex().catch(() => []);
    const c = pickCase(cases, input);
    picked.current = c ? { id: c.id, title: c.title } : null;
    return { ok: true, sessionId: `demo-${Date.now().toString(36)}` };
  };

  function onSent(info: SessionInfo) {
    const demo = isDemo();
    const demoCase = demo ? (picked.current?.id ?? "eshop_carrier") : undefined;
    const entry = {
      id: info.sessionId,
      company: demo ? (picked.current?.title ?? info.company) : info.company,
      story: info.story,
      createdAt: new Date().toISOString().slice(0, 10),
      demo,
      ...(demoCase && { demoCase }),
    };
    remember(entry);
    const source = demoCase
      ? createDemoSource(demoCase, {
          note: `Tohle je ukázka bez jazykového modelu: přehrávám nejbližší připravený případ, „${picked.current?.title ?? demoCase}“.`,
        })
      : createLiveSource(info.sessionId);
    morph(() => {
      flushSync(() => {
        setChat({ source, title: entry.company, id: info.sessionId, ...(demoCase && { demoCase }) });
      });
    });
    window.history.pushState(null, "", chatHref(entry));
  }

  if (chat)
    return (
      <ChatWorkspace
        source={chat.source}
        title={chat.title}
        sessionId={chat.id}
        {...(chat.demoCase && { demoCase: chat.demoCase })}
      />
    );

  return (
    <AppShell defaultOpen={false}>
      <div className="landing-scroll">
        <div className="landing">
          <header className="brand">
            {/* a full reload on purpose: it resets the form */}
            <a href="/" title="Začít znovu">
              <img src="/fis-logo.png" alt="Fakulta informatiky a statistiky VŠE" />
              <h1>JOJO</h1>
            </a>
          </header>
          <p className="lead">Z vašeho příběhu vytvoříme data, ve kterých se dá dohledat.</p>
          <PromptForm send={send} onSent={onSent} />
          <PromptHelp />
        </div>
      </div>
    </AppShell>
  );
}
