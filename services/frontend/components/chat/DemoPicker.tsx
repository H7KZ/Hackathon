"use client";

import { useEffect, useState } from "react";
import type { DemoIndexEntry } from "@s2d/schema/demo";
import { formatDate } from "../../lib/format";
import { DEMO_DIR, loadDemoIndex } from "../../lib/chat/demoSource";

type Load =
  { state: "loading" } | { state: "error"; message: string } | { state: "ok"; cases: DemoIndexEntry[] };

/** The recorded demo cases (public/demo/index.json), once per mount. */
export function useDemoCases(): Load {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    loadDemoIndex().then(
      (cases) => {
        if (alive) setLoad({ state: "ok", cases });
      },
      (err: unknown) => {
        if (alive) setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return load;
}

const nf = (n: number) => n.toLocaleString("cs-CZ");

/** `/chat?demo=1`: pick which recorded dataset to replay. */
export function DemoPicker() {
  const load = useDemoCases();
  return (
    <div className="demo-picker">
      <header className="demo-head">
        <h2>Ukázky s demo daty</h2>
        <p>
          Každá ukázka je zaznamenaný běh celé aplikace. Scénář místo jazykového modelu napsal člověk, data z
          něj vygeneroval deterministický engine (seed 42), hypotézy ověřila DuckDB a zjištění detektiva se
          hodnotí proti skutečným bodům příběhu. Běží bez serveru a bez API klíče.
        </p>
      </header>
      {load.state === "loading" && <p className="demo-note">Načítám ukázky…</p>}
      {load.state === "error" && (
        <p className="demo-note" role="alert">
          Seznam ukázek se nepodařilo načíst ({load.message}).
        </p>
      )}
      {load.state === "ok" && (
        <ul className="demo-grid">
          {load.cases.map((c) => (
            <li key={c.id} className="demo-card">
              <div className="demo-tags">
                {c.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              <h3>{c.title}</h3>
              <p className="demo-company">{c.input.company}</p>
              <p className="demo-summary">{c.summary}</p>
              <dl className="demo-stats">
                <div>
                  <dt>Tabulek</dt>
                  <dd>{c.stats.tables}</dd>
                </div>
                <div>
                  <dt>Řádků</dt>
                  <dd>{nf(c.stats.rows)}</dd>
                </div>
                <div>
                  <dt>Období</dt>
                  <dd>
                    {formatDate(c.stats.start)} – {formatDate(c.stats.end)}
                  </dd>
                </div>
              </dl>
              <div className="demo-actions">
                <a className="demo-open" href={`/chat?demo=${c.id}`}>
                  Přehrát ukázku
                </a>
                <a className="demo-dl" href={`${DEMO_DIR}/${c.id}/${c.id}_dat1.xlsx`} download>
                  Stáhnout data (.xlsx)
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Topbar select in a demo chat: switch to another recorded dataset. */
export function DemoSwitch({ current }: { current: string }) {
  const load = useDemoCases();
  if (load.state !== "ok") return null;
  return (
    <label className="demo-switch">
      <span>Ukázka</span>
      <select
        value={current}
        onChange={(e) => {
          window.location.assign(e.target.value ? `/chat?demo=${e.target.value}` : "/chat?demo=1");
        }}
      >
        {load.cases.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
        <option value="">Všechny ukázky…</option>
      </select>
    </label>
  );
}
