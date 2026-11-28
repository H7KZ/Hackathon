"use client";

import { useEffect, useState } from "react";
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

/** "0:42" / "1:05": elapsed time of a running step. */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
}

/** Ticks once a second while any step runs, so the elapsed time moves (the UI is alive). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, [active]);
  return now;
}

/** Agent pipeline progress (A1–A5, engine, evidence, detective). */
export function Steps({ node }: NodeProps) {
  const resolve = useResolve();
  const steps = (resolve(node.steps) as Step[] | undefined) ?? [];
  const now = useNow(steps.some((s) => s.state === "running" && s.startedAt !== undefined));
  return (
    <ol className="a2-steps">
      {steps.map((s) => {
        const running = s.state === "running";
        const at = s.attempt;
        return (
          <li key={s.id} className={s.state} aria-current={running ? "step" : undefined}>
            <span className="dot" aria-hidden="true">
              {MARK[s.state]}
            </span>
            <span className="label">
              {s.label}
              <span className="sr-only"> ({SR[s.state]})</span>
              {running && s.startedAt !== undefined && (
                <span className="elapsed" suppressHydrationWarning>
                  {elapsedLabel(now - s.startedAt)}
                </span>
              )}
            </span>
            {running && at && (
              <span className="attempts" role="img" aria-label={`pokus ${String(at.n)} z ${String(at.max)}`}>
                {Array.from({ length: at.max }, (_, i) => (
                  <i key={i} className={i < at.n - 1 ? "used" : i === at.n - 1 ? "now" : ""} />
                ))}
              </span>
            )}
            {s.detail && <span className="detail">{s.detail}</span>}
            {running && s.hint && <span className="hint">{s.hint}</span>}
            {running && <span className="bar" aria-hidden="true" />}
          </li>
        );
      })}
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
