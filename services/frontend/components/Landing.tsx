"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import { createSession } from "../lib/api";
import { createLiveSource } from "../lib/chat/liveSource";
import { createMockSource } from "../lib/chat/mockSource";
import type { ChatSource } from "../lib/chat/types";
import { chatHref, remember } from "../lib/history";
import { ChatWorkspace } from "./chat/ChatWorkspace";
import { HistoryMenu } from "./chat/HistoryMenu";
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
  const [chat, setChat] = useState<{ source: ChatSource; title: string } | null>(null);

  const send: Send = (input) =>
    isDemo()
      ? Promise.resolve({ ok: true, sessionId: `demo-${Date.now().toString(36)}` })
      : createSession(input);

  function onSent(info: SessionInfo) {
    const demo = isDemo();
    const entry = {
      id: info.sessionId,
      company: info.company,
      story: info.story,
      createdAt: new Date().toISOString().slice(0, 10),
      demo,
    };
    remember(entry);
    const source = demo ? createMockSource(info) : createLiveSource(info.sessionId);
    morph(() => {
      flushSync(() => {
        setChat({ source, title: info.company });
      });
    });
    window.history.pushState(null, "", chatHref(entry));
  }

  if (chat) return <ChatWorkspace source={chat.source} title={chat.title} />;

  return (
    <div className="landing">
      <div className="landing-menu">
        <HistoryMenu />
      </div>
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
  );
}
