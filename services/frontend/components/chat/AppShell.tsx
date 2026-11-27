"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { formatDate } from "../../lib/format";
import { chatHref, loadHistory, type HistoryEntry } from "../../lib/history";
import { Icon, ICONS } from "../icons";

const KEY = "jojo.sidebar";
const noop = () => () => undefined;
const EMPTY: HistoryEntry[] = [];

/** History snapshot: read once per mount on the client, nothing on the server. */
function useHistory(): HistoryEntry[] {
  const [cache] = useState<{ value?: HistoryEntry[] }>({});
  return useSyncExternalStore(
    noop,
    () => (cache.value ??= loadHistory()),
    () => EMPTY,
  );
}

/** Sidebar state survives reloads; default: open on wide screens, closed on landing. */
function useSidebar(defaultOpen: boolean): [boolean, (open: boolean) => void] {
  const saved = useSyncExternalStore(
    noop,
    () => localStorage.getItem(KEY),
    () => null,
  );
  const [local, setLocal] = useState<boolean | null>(null);
  const open = local ?? (saved === null ? defaultOpen : saved === "1");
  return [
    open,
    (next) => {
      setLocal(next);
      localStorage.setItem(KEY, next ? "1" : "0");
    },
  ];
}

export function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="sb-toggle"
      aria-label={open ? "Skrýt historii" : "Zobrazit historii"}
      aria-expanded={open}
      aria-controls="sidebar"
      onClick={onToggle}
    >
      <Icon path={ICONS.sidebar} />
    </button>
  );
}

function Sidebar({ activeId, onClose }: { activeId?: string; onClose: () => void }) {
  const entries = useHistory();
  return (
    <aside id="sidebar" className="sidebar" aria-label="Historie chatů">
      <div className="sb-head">
        <a href="/" className="sb-brand" title="Nový chat">
          <img src="/fis-logo.png" alt="FIS VŠE" />
          <span>JOJO</span>
        </a>
        <button type="button" className="sb-close" aria-label="Skrýt historii" onClick={onClose}>
          <Icon path={ICONS.sidebar} />
        </button>
      </div>
      <nav className="sb-nav" aria-label="Hlavní">
        <a href="/" className="sb-new">
          <Icon path={ICONS.plus} /> Nový chat
        </a>
        <a href="/chat?demo=1">
          <Icon path={ICONS.chat} /> Ukázka s demo daty
        </a>
      </nav>
      <p className="sb-label">Historie</p>
      {entries.length === 0 ? (
        <p className="sb-empty">Zatím žádné chaty. První vznikne odesláním příběhu.</p>
      ) : (
        <ul className="sb-list">
          {entries.map((e) => (
            <li key={e.id}>
              <a href={chatHref(e)} aria-current={e.id === activeId ? "page" : undefined}>
                <span className="sb-title">{e.company}</span>
                <small>
                  {formatDate(e.createdAt)}
                  {e.demo && " · demo"}
                </small>
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="sb-foot">
        <a href="/lab/components">A2UI komponenty</a>
        <a href="/design">Design systém</a>
      </div>
    </aside>
  );
}

/**
 * Full-screen app frame: push sidebar (history) + main area. The sidebar slides in and moves the
 * content (no modal, no hamburger); under 900px it overlays with a scrim.
 */
export function AppShell({
  children,
  defaultOpen = true,
  activeId,
  topbar,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  activeId?: string;
  /** rendered after the sidebar toggle */
  topbar?: ReactNode;
}) {
  const [open, setOpen] = useSidebar(defaultOpen);
  return (
    <div className={`shell ${open ? "sb-open" : "sb-closed"}`}>
      <Sidebar
        activeId={activeId}
        onClose={() => {
          setOpen(false);
        }}
      />
      <button
        type="button"
        className="sb-scrim"
        aria-label="Zavřít historii"
        tabIndex={-1}
        onClick={() => {
          setOpen(false);
        }}
      />
      <div className="shell-main">
        <header className="topbar">
          {!open && (
            <SidebarToggle
              open={open}
              onToggle={() => {
                setOpen(true);
              }}
            />
          )}
          {topbar}
        </header>
        {children}
      </div>
    </div>
  );
}
