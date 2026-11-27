"use client";

import { formatDate } from "../../lib/format";
import { useResolve } from "./context";
import { str, type NodeProps } from "./tree";

import type { Step, StepState } from "../../lib/a2ui/catalog";

const MARK: Record<StepState, string> = { pending: "", running: "", done: "✓", failed: "!" };
const SR: Record<StepState, string> = {
  pending: "čeká",
  running: "běží",
  done: "hotovo",
  failed: "selhalo",
};

/** Agent pipeline progress (A1–A5, engine, evidence, detective). */
export function Steps({ node }: NodeProps) {
  const resolve = useResolve();
  const steps = (resolve(node.steps) as Step[] | undefined) ?? [];
  return (
    <ol className="a2-steps">
      {steps.map((s) => (
        <li key={s.id} className={s.state} aria-current={s.state === "running" ? "step" : undefined}>
          <span className="dot" aria-hidden="true">
            {MARK[s.state]}
          </span>
          <span className="label">
            {s.label}
            <span className="sr-only"> ({SR[s.state]})</span>
          </span>
          {s.detail && <span className="detail">{s.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

export type StoryPointView = { id: string; title: string; start: string; end?: string; entity?: string };

/** Horizontal axis with story points placed by date between `from` and `to`. Read-only overview. */
export function StoryTimeline({ node }: NodeProps) {
  const resolve = useResolve();
  const points = (resolve(node.points) as StoryPointView[] | undefined) ?? [];
  const from = Date.parse(str(resolve(node.from)) || points[0]?.start || "");
  const to = Date.parse(str(resolve(node.to)) || points.at(-1)?.start || "");
  const span = to - from || 1;
  const at = (iso: string) => Math.min(100, Math.max(0, ((Date.parse(iso) - from) / span) * 100));
  return (
    <div className="a2-timeline">
      <div className="axis" aria-hidden="true">
        <span>{formatDate(str(resolve(node.from)) || points[0]?.start || "")}</span>
        <span>{formatDate(str(resolve(node.to)) || points.at(-1)?.start || "")}</span>
      </div>
      <ol>
        {points.map((p, i) => (
          <li
            key={p.id}
            style={{
              left: `${String(at(p.start))}%`,
              width: p.end ? `${String(Math.max(2, at(p.end) - at(p.start)))}%` : undefined,
            }}
            className={`lane${String(i % 3)}`}
          >
            <span className="pin" aria-hidden="true" />
            <span className="chip">
              <strong>
                {points.length > 1 && `${String(i + 1)} · `}
                {p.title}
              </strong>
              <small>
                {formatDate(p.start)}
                {p.end && ` – ${formatDate(p.end)}`}
              </small>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
