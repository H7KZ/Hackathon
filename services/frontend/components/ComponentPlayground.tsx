"use client";

import { useMemo, useState } from "react";
import { COMPONENTS } from "../lib/a2ui/catalog";
import { EXAMPLES } from "../lib/a2ui/playground";
import { a2ui, type A2uiAction } from "../lib/a2ui/protocol";
import { createSurfaceStore } from "../lib/a2ui/store";
import { A2uiSurface, useStoreState } from "./a2ui/Surface";

/** /lab/components: every catalog component, live, with its data model and the actions it sends. */
export function ComponentPlayground() {
  const store = useMemo(() => {
    const s = createSurfaceStore();
    for (const ex of EXAMPLES)
      s.apply(a2ui.create({ surfaceId: `pg-${ex.name}`, components: ex.components, dataModel: ex.data }));
    return s;
  }, []);
  const state = useStoreState(store);
  const [log, setLog] = useState<A2uiAction[]>([]);
  const onAction = (a: A2uiAction) => {
    setLog((l) => [a, ...l].slice(0, 20));
  };
  const missing = COMPONENTS.filter((c) => !EXAMPLES.some((e) => e.name === c));
  return (
    <div className="playground">
      <header>
        <h1>A2UI komponenty</h1>
        <p>
          Každá komponenta katalogu JOJO naživo. Vpravo vidíte data model, do kterého komponenta zapisuje, a
          akce, které posílá agentovi.
          {missing.length > 0 && ` Chybí ukázka: ${missing.join(", ")}.`}
        </p>
        <nav aria-label="Komponenty">
          {EXAMPLES.map((e) => (
            <a key={e.name} href={`#${e.name}`}>
              {e.name}
            </a>
          ))}
        </nav>
      </header>
      {EXAMPLES.map((ex) => {
        const id = `pg-${ex.name}`;
        return (
          <section key={ex.name} id={ex.name} className="pg-item" aria-label={ex.name}>
            <div className="pg-main">
              <h2>{ex.name}</h2>
              <p className="pg-try">{ex.tryIt}</p>
              <div className="pg-stage">
                <A2uiSurface store={store} surfaceId={id} onAction={onAction} />
              </div>
            </div>
            <pre className="pg-data" aria-label={`${ex.name} data model`}>
              {JSON.stringify(state.surfaces[id]?.data, null, 2)}
            </pre>
          </section>
        );
      })}
      <aside className="pg-log" aria-label="Akce">
        <strong>Akce ({log.length})</strong>
        {log.length === 0 ? (
          <p>Zatím žádná. Klikněte na tlačítko v ukázce Button.</p>
        ) : (
          <ol>
            {log.map((a, i) => (
              <li key={`${a.timestamp}-${String(i)}`}>
                <code>{a.name}</code> {JSON.stringify(a.context)}
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
