"use client";

import { useRef, useState } from "react";
import { chatHref, loadHistory, type HistoryEntry } from "../../lib/history";
import { formatDate } from "../../lib/format";
import { Icon, ICONS } from "../icons";

/** Hamburger (top left) → drawer with chat history; skips the landing page. Native <dialog>: focus trap + Esc. */
export function HistoryMenu() {
  const drawer = useRef<HTMLDialogElement>(null);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const open = () => {
    setEntries(loadHistory());
    drawer.current?.showModal();
  };
  const close = () => drawer.current?.close();
  return (
    <>
      <button type="button" className="hamburger" aria-label="Menu a historie chatů" onClick={open}>
        <Icon path={ICONS.menu} />
      </button>
      <dialog
        ref={drawer}
        className="drawer"
        aria-labelledby="drawer-title"
        onClick={(e) => {
          if (e.target === drawer.current) close(); // click on the backdrop
        }}
      >
        <div className="drawer-head">
          <h2 id="drawer-title">JOJO</h2>
          <button type="button" aria-label="Zavřít menu" onClick={close}>
            <Icon path={ICONS.close} />
          </button>
        </div>
        <nav aria-label="Hlavní">
          <a href="/" className="drawer-new">
            <Icon path={ICONS.plus} /> Nový chat
          </a>
          <a href="/chat?demo=1">
            <Icon path={ICONS.chat} /> Ukázka s demo daty
          </a>
        </nav>
        <h3>Historie</h3>
        {entries.length === 0 ? (
          <p className="drawer-empty">Zatím žádné chaty. První vznikne odesláním příběhu.</p>
        ) : (
          <ul className="drawer-list">
            {entries.map((e) => (
              <li key={e.id}>
                <a href={chatHref(e)}>
                  <strong>{e.company}</strong>
                  <span>{e.story}</span>
                  <small>
                    {formatDate(e.createdAt)}
                    {e.demo && " · demo"}
                  </small>
                </a>
              </li>
            ))}
          </ul>
        )}
        <a href="/design" className="drawer-foot">
          Design systém
        </a>
      </dialog>
    </>
  );
}
