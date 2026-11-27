"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  addDays,
  curveAt,
  daysBetween,
  effectiveRamp,
  fitInto,
  nextId,
  sampleCurve,
  type Knot,
} from "../../lib/chat/curve";
import { formatDate, toText } from "../../lib/format";
import { useBinding, useResolve } from "./context";
import type { NodeProps } from "./tree";

export type CurvePoint = Knot & { title: string; description?: string };

const PAD = { l: 44, r: 18, t: 30, b: 28 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const byStart = (a: CurvePoint, b: CurvePoint) => a.start.localeCompare(b.start);
const num = (v: number) => v.toLocaleString("cs-CZ", { maximumFractionDigits: 1 });

function niceTicks(min: number, max: number, count = 5): number[] {
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(round1(v));
  return out;
}

/** Container width; jsdom (tests) has no ResizeObserver, so it falls back to 760. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(320, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  return [ref, width] as const;
}

type Drag = { id: string; part: "knot" | "end"; snapshot: CurvePoint[]; moved: boolean };

/**
 * Interactive story curve ("it just works"): drag a point to move it in time and value, drag its square
 * to change when things return to normal, double-click empty space to add a point, Delete removes,
 * arrows nudge (Shift = bigger steps), Ctrl+Z / Ctrl+Shift+Z undo / redo. Every change writes straight
 * into the bound data model, so the Generate action always sends what the user sees.
 */
export function CurveEditor({ node }: NodeProps) {
  const resolve = useResolve();
  const [bound, setPoints] = useBinding<CurvePoint[]>(node.points);
  const points = bound ?? [];
  const baseline = Number(resolve(node.baseline) ?? 0);
  const from = toText(resolve(node.from)) || "2026-01-01";
  const to = toText(resolve(node.to)) || addDays(from, 180);
  const ramp = effectiveRamp(Number(resolve(node.rampDays) ?? 14), from, to);
  const levels = points.map((p) => p.level);
  const min = Number(resolve(node.min) ?? Math.min(0, baseline, ...levels));
  const max = Number(resolve(node.max) ?? Math.max(baseline, ...levels) * 1.3 + 1);
  const label = toText(resolve(node.label));
  const unit = toText(resolve(node.unit));
  const locked = resolve(node.locked) === true;
  const H = Number(node.height ?? 280);

  const [wrap, W] = useWidth();
  const svg = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const history = useRef<{ past: CurvePoint[][]; future: CurvePoint[][] }>({ past: [], future: [] });
  const base = useId();

  const span = Math.max(1, daysBetween(from, to));
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (day: string) => PAD.l + (daysBetween(from, day) / span) * innerW;
  const y = (v: number) => PAD.t + (1 - (v - min) / (max - min || 1)) * innerH;
  const dayAt = (px: number) => addDays(from, clamp(Math.round(((px - PAD.l) / innerW) * span), 0, span));
  const valueAt = (py: number) => clamp(round1(min + (1 - (py - PAD.t) / innerH) * (max - min)), min, max);
  const sorted = [...points].sort(byStart);
  /** Handles sit where the ramp arrives, so they are on the line the user sees. */
  const handleDay = (start: string) => addDays(start, ramp);
  const sel = points.find((p) => p.id === selected) ?? null;
  const outside = points.filter((p) => p.start < from || p.start > to).length;
  const rootRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    const root = el?.closest<HTMLElement>(".thread-scroll, .canvas-body");
    if (!el || !root) return;
    // stuck = pinned at the top edge of the scroll container (sticky top: -1px)
    const onScroll = () => {
      setStuck(root.scrollTop > 0 && el.getBoundingClientRect().top - root.getBoundingClientRect().top <= 0);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
    };
  }, []);

  const write = (next: CurvePoint[]) => {
    setPoints([...next].sort(byStart));
  };
  const commit = (next: CurvePoint[], snapshot: CurvePoint[] = points) => {
    history.current.past.push(snapshot);
    history.current.future = [];
    write(next);
  };
  const patch = (id: string, change: Partial<CurvePoint>, live = false) => {
    const next = points.map((p) => (p.id === id ? { ...p, ...change } : p));
    if (live) write(next);
    else commit(next);
  };
  const remove = (id: string) => {
    commit(points.filter((p) => p.id !== id));
    setSelected(null);
  };
  const add = (start: string, level: number) => {
    const id = nextId(points);
    commit([...points, { id, title: "Nový bod", description: "", start, level }]);
    setSelected(id);
  };
  const undo = () => {
    const prev = history.current.past.pop();
    if (!prev) return;
    history.current.future.push(points);
    write(prev);
  };
  const redo = () => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(points);
    write(next);
  };

  /** Pointer position in SVG units (the SVG is drawn at its real pixel width). */
  const local = (e: PointerEvent | { clientX: number; clientY: number }) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || !r.width) return { px: 0, py: 0 };
    return { px: ((e.clientX - r.left) / r.width) * W, py: ((e.clientY - r.top) / r.height) * H };
  };

  const startDrag = (e: PointerEvent, id: string, part: Drag["part"]) => {
    if (locked) return;
    e.stopPropagation();
    e.preventDefault();
    svg.current?.setPointerCapture(e.pointerId);
    drag.current = { id, part, snapshot: points, moved: false };
    setDragging(true);
    setSelected(id);
  };
  const onMove = (e: PointerEvent) => {
    const { px, py } = local(e);
    setHover(px >= PAD.l && px <= W - PAD.r && py >= PAD.t && py <= H - PAD.b ? { px, py } : null);
    const d = drag.current;
    if (!d) return;
    d.moved = true;
    const p = points.find((k) => k.id === d.id);
    if (!p) return;
    // the handle sits where the ramp arrives, so the story date is `ramp` days earlier
    const day = addDays(dayAt(px), -ramp);
    if (d.part === "knot") {
      const start = p.end && day >= p.end ? addDays(p.end, -1) : day < from ? from : day;
      patch(p.id, { start, level: valueAt(py) }, true);
    } else {
      const end = day <= p.start ? addDays(p.start, 1) : day;
      patch(p.id, { end }, true);
    }
  };
  const endDrag = () => {
    const d = drag.current;
    if (d?.moved) {
      history.current.past.push(d.snapshot);
      history.current.future = [];
    }
    drag.current = null;
    setDragging(false);
  };

  const onKey = (e: KeyboardEvent) => {
    if (locked) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (!sel) return;
    const big = e.shiftKey;
    const moves: Record<string, () => Partial<CurvePoint>> = {
      ArrowLeft: () => ({ start: addDays(sel.start, big ? -7 : -1) }),
      ArrowRight: () => ({ start: addDays(sel.start, big ? 7 : 1) }),
      ArrowUp: () => ({ level: clamp(round1(sel.level + (big ? 1 : 0.1)), min, max) }),
      ArrowDown: () => ({ level: clamp(round1(sel.level - (big ? 1 : 0.1)), min, max) }),
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      patch(sel.id, move());
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(sel.id);
    } else if (e.key === "Escape") setSelected(null);
  };

  // geometry for drawing
  const step = Math.max(1, Math.round(span / 240));
  const samples = sampleCurve(baseline, points, from, to, step, ramp);
  const line = samples
    .map((s, i) => `${i ? "L" : "M"}${x(s.day).toFixed(1)},${y(s.value).toFixed(1)}`)
    .join("");
  const area = `${line}L${x(to).toFixed(1)},${y(min).toFixed(1)}L${x(from).toFixed(1)},${y(min).toFixed(1)}Z`;
  const yTicks = niceTicks(min, max);
  // short ranges get daily ticks, long ones whole weeks (~one label per 90 px)
  const rawEvery = span / Math.max(2, innerW / 90);
  const xEvery = rawEvery < 7 ? Math.max(1, Math.round(rawEvery)) : Math.round(rawEvery / 7) * 7;
  const xTicks: string[] = [];
  for (let d = from; d <= to; d = addDays(d, xEvery)) xTicks.push(d);
  const hoverDay = hover === null ? null : dayAt(hover.px);
  const hoverValue = hoverDay === null ? 0 : curveAt(hoverDay, baseline, points, ramp);
  // ghost point: pointer near the line and not on top of an existing handle → one click adds it there
  const ghost =
    !locked &&
    !dragging &&
    hover !== null &&
    hoverDay !== null &&
    Math.abs(hover.py - y(hoverValue)) < 18 &&
    sorted.every((p) => Math.abs(x(handleDay(p.start)) - hover.px) > 16);
  const addAtGhost = () => {
    if (!ghost || !hoverDay) return false;
    const start = addDays(hoverDay, -ramp);
    add(start < from ? from : start, round1(hoverValue));
    return true;
  };

  // the root is sticky: it stays in view while the settings below are scrolled and edited
  return (
    <div ref={rootRef} className={`a2-curve${locked ? " locked" : ""}${stuck ? " stuck" : ""}`}>
      <div className="a2-curve-sticky">
        <div className="a2-curve-bar">
          <strong>{label}</strong>
          {!locked && (
            <div className="a2-curve-tools">
              <button
                type="button"
                onClick={() => {
                  const last = sorted.at(-1);
                  const start = last ? addDays(last.start, 21) : addDays(from, Math.round(span / 2));
                  add(start > to ? to : start, round1(curveAt(start, baseline, points, ramp) + 1));
                }}
              >
                + Bod
              </button>
              <button type="button" aria-label="Zpět" title="Zpět (Ctrl+Z)" onClick={undo}>
                ↶
              </button>
              <button type="button" aria-label="Znovu" title="Znovu (Ctrl+Shift+Z)" onClick={redo}>
                ↷
              </button>
            </div>
          )}
        </div>
        <div
          ref={wrap}
          className="a2-curve-canvas"
          tabIndex={0}
          role="group"
          aria-label={`${label}: editor křivky`}
          aria-describedby={`${base}-hint`}
          onKeyDown={onKey}
        >
          <svg
            ref={svg}
            width={W}
            height={H}
            viewBox={`0 0 ${String(W)} ${String(H)}`}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={() => {
              setHover(null);
            }}
          >
            <rect
              x={PAD.l}
              y={PAD.t}
              width={innerW}
              height={innerH}
              className={ghost ? "hit adding" : "hit"}
              onClick={() => {
                if (!addAtGhost()) setSelected(null);
              }}
              onDoubleClick={(e) => {
                if (locked || ghost) return;
                const { px, py } = local(e);
                add(addDays(dayAt(px), -ramp), valueAt(py));
              }}
            />
            {yTicks.map((t) => (
              <g key={`y${String(t)}`} className="tick">
                <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
                <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end">
                  {num(t)}
                </text>
              </g>
            ))}
            {xTicks.map((d) => (
              <text key={d} className="xtick" x={x(d)} y={H - 8} textAnchor="middle">
                {formatDate(d).replace(/ \d{4}$/, "")}
              </text>
            ))}
            <path className="area" d={area} />
            <path className="line" d={line} />
            {hoverDay && !dragging && (
              <g className="guide">
                <line x1={x(hoverDay)} x2={x(hoverDay)} y1={PAD.t} y2={H - PAD.b} />
                {ghost && (
                  <g className="ghost">
                    <circle cx={x(hoverDay)} cy={y(hoverValue)} r={7} />
                    <text x={x(hoverDay)} y={y(hoverValue) + 4} textAnchor="middle">
                      +
                    </text>
                  </g>
                )}
                <text x={x(hoverDay) + 6} y={PAD.t + 12}>
                  {formatDate(hoverDay)} · {num(hoverValue)} {unit}
                  {ghost && " · klikněte pro nový bod"}
                </text>
              </g>
            )}
            {sorted.map((p, i) => {
              const hx = x(handleDay(p.start));
              const hy = y(curveAt(handleDay(p.start), baseline, points, ramp));
              const on = p.id === selected;
              return (
                <g key={p.id} className={`knot${on ? " on" : ""}`}>
                  <line className="mark" x1={x(p.start)} x2={x(p.start)} y1={PAD.t - 8} y2={H - PAD.b} />
                  <text className="num" x={x(p.start)} y={PAD.t - 12} textAnchor="middle">
                    {i + 1}
                  </text>
                  {p.end && (
                    <rect
                      className="end"
                      role="slider"
                      tabIndex={locked ? -1 : 0}
                      aria-label={`${p.title}: návrat k normálu`}
                      aria-valuetext={formatDate(p.end)}
                      x={x(handleDay(p.end)) - 5}
                      y={y(curveAt(handleDay(p.end), baseline, points, ramp)) - 5}
                      width={10}
                      height={10}
                      onPointerDown={(e) => {
                        startDrag(e, p.id, "end");
                      }}
                      onFocus={() => {
                        setSelected(p.id);
                      }}
                    />
                  )}
                  <circle
                    className="handle"
                    role="slider"
                    tabIndex={locked ? -1 : 0}
                    aria-label={`${String(i + 1)} · ${p.title}`}
                    aria-valuetext={`${formatDate(p.start)}, ${num(p.level)} ${unit}`}
                    cx={hx}
                    cy={hy}
                    r={on ? 8 : 6.5}
                    onPointerDown={(e) => {
                      startDrag(e, p.id, "knot");
                    }}
                    onFocus={() => {
                      setSelected(p.id);
                    }}
                  />
                  {on && (
                    <text className="tip" x={hx} y={hy - 14} textAnchor="middle">
                      {p.title}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        {outside > 0 && !locked && (
          <p className="a2-curve-outside" role="status">
            {outside === 1 ? "1 bod je" : `${String(outside)} body jsou`} mimo zvolené období.
            <button
              type="button"
              onClick={() => {
                commit(fitInto(points, from, to));
              }}
            >
              Rozložit body do období
            </button>
          </p>
        )}
        <p id={`${base}-hint`} className="a2-curve-hint">
          {locked
            ? "Křivka je zamčená, data se generují z této verze."
            : "Najeďte na křivku a klikněte = nový bod · táhněte body · šipky posouvají (Shift = víc) · Delete smaže · Ctrl+Z zpět"}
        </p>
      </div>
      {sel && !locked && (
        <div className="a2-curve-edit" aria-label={`Upravit bod ${sel.title}`} role="group">
          <label>
            Název
            <input
              type="text"
              value={sel.title}
              onChange={(e) => {
                patch(sel.id, { title: e.target.value }, true);
              }}
            />
          </label>
          <label>
            Začátek
            <input
              type="date"
              value={sel.start}
              min={from}
              max={to}
              onChange={(e) => {
                if (e.target.value) patch(sel.id, { start: e.target.value });
              }}
            />
          </label>
          <label>
            Hodnota{unit && ` (${unit})`}
            <input
              type="number"
              step={0.1}
              min={min}
              max={max}
              value={sel.level}
              onChange={(e) => {
                patch(sel.id, { level: clamp(Number(e.target.value), min, max) });
              }}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(sel.end)}
              onChange={(e) => {
                if (e.target.checked) patch(sel.id, { end: addDays(sel.start, 28) });
                else {
                  const rest = { ...sel };
                  delete rest.end;
                  commit(points.map((p) => (p.id === sel.id ? rest : p)));
                }
              }}
            />
            Návrat k normálu
          </label>
          {sel.end && (
            <label>
              Konec
              <input
                type="date"
                value={sel.end}
                min={addDays(sel.start, 1)}
                max={to}
                onChange={(e) => {
                  if (e.target.value) patch(sel.id, { end: e.target.value });
                }}
              />
            </label>
          )}
          <label className="wide">
            Popis
            <input
              type="text"
              value={sel.description ?? ""}
              onChange={(e) => {
                patch(sel.id, { description: e.target.value }, true);
              }}
            />
          </label>
          <button
            type="button"
            className="danger"
            onClick={() => {
              remove(sel.id);
            }}
          >
            Smazat bod
          </button>
        </div>
      )}
    </div>
  );
}
