"use client";

import { useId, useState } from "react";
import { useResolve } from "./context";
import { Children, Node, str, type NodeProps } from "./tree";

type Gap = "sm" | "md" | "lg";
const gapClass = (gap: unknown) => `gap-${(gap as Gap | undefined) ?? "md"}`;

export function Column({ node }: NodeProps) {
  return (
    <div className={`a2-col ${gapClass(node.gap)}`} style={{ flexGrow: node.weight }}>
      <Children node={node} />
    </div>
  );
}

export function Row({ node }: NodeProps) {
  const justify = (node.justify as string | undefined) ?? "start";
  return (
    <div
      className={`a2-row ${gapClass(node.gap)} justify-${justify} ${node.wrap === false ? "" : "wrap"}`}
      style={{ flexGrow: node.weight }}
    >
      <Children node={node} />
    </div>
  );
}

export function Card({ node }: NodeProps) {
  const resolve = useResolve();
  const title = str(resolve(node.title));
  return (
    <section className="a2-card" style={{ flexGrow: node.weight }} aria-label={title || undefined}>
      {title && <h3 className="a2-card-title">{title}</h3>}
      {node.child && <Node id={node.child} />}
      {node.children && <Children node={node} />}
    </section>
  );
}

export function List({ node }: NodeProps) {
  return (
    <div className={`a2-list ${node.direction === "horizontal" ? "horizontal" : ""}`} role="list">
      <Children node={node} />
    </div>
  );
}

type Tab = { title: unknown; child: string };

export function Tabs({ node }: NodeProps) {
  const resolve = useResolve();
  const tabs = (node.tabs as Tab[] | undefined) ?? [];
  const [active, setActive] = useState(0);
  const base = useId();
  const current = tabs[active];
  return (
    <div className="a2-tabs">
      <div role="tablist" className="a2-tablist">
        {tabs.map((tab, i) => (
          <button
            key={tab.child}
            id={`${base}-t${String(i)}`}
            role="tab"
            type="button"
            aria-selected={i === active}
            aria-controls={`${base}-p`}
            onClick={() => {
              setActive(i);
            }}
          >
            {str(resolve(tab.title))}
          </button>
        ))}
      </div>
      <div
        id={`${base}-p`}
        role="tabpanel"
        aria-labelledby={`${base}-t${String(active)}`}
        className="a2-tabpanel"
      >
        {current && <Node id={current.child} />}
      </div>
    </div>
  );
}

export function Divider() {
  return <hr className="a2-divider" />;
}
