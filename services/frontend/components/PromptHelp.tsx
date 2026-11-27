"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, ICONS } from "./icons";

export function PromptHelp() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    toggle.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <section className="help" aria-label="Nápověda">
      <p className="help-row">
        <Icon path={ICONS.info} />
        <span>Napište, o jakou firmu jde a co se v ní stalo.</span>
        <button
          ref={toggle}
          type="button"
          className="link"
          aria-expanded={open}
          aria-controls="help-panel"
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? "Skrýt" : "Číst více"}
        </button>
      </p>
      <div id="help-panel" className={open ? "help-panel open" : "help-panel"}>
        <div>
          <div className="help-card">
            <h2>Jak zadat příběh</h2>
            <ol>
              <li>
                <strong>Firma:</strong> čím se zabývá, například „e-shop s elektronikou“.
              </li>
              <li>
                <strong>Příběh:</strong> co se změnilo, kdy a jaký to mělo dopad.
              </li>
              <li>
                <strong>Soubor (nepovinné):</strong> textové podklady .txt, .md, .csv nebo .json do 200 kB.
                Jejich obsah se přidá k příběhu.
              </li>
              <li>
                <strong>Odeslání:</strong> tlačítkem s vlaštovkou nebo klávesou Enter. Nový řádek vložíte
                pomocí Shift+Enter.
              </li>
            </ol>
            <button type="button" className="close" onClick={close}>
              Zavřít
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
