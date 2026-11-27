"use client";

import type { ReactElement } from "react";
import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart as RLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDate, formatValue, toText } from "../../lib/format";
import { useResolve } from "./context";
import { str, type NodeProps } from "./tree";

/** Chart palette, docs/design/brand.md. A = green solid, B = blue dashed. */
export const SERIES_COLORS = ["#00957d", "#009ee0", "#7a5cc7", "#c77700", "#5b6563"];
const STORY = "#c77700";
const GRID = "#e3eae8";
const AXIS = { fontSize: 12, fill: "#5b6563" };

type Series = { key: string; label: string; dashed?: boolean; color?: number };
type Marker = { date: string; label: string };
type Row = Record<string, unknown>;

const shortDate = (v: unknown) => {
  const s = formatDate(toText(v));
  return s.replace(/ \d{4}$/, "");
};
const tooltipValue = (v: unknown) => formatValue(v, "number");

function Frame({ title, height, children }: { title: string; height: number; children: ReactElement }) {
  return (
    <figure className="a2-chart">
      {title && <figcaption>{title}</figcaption>}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/**
 * Time series with story-point markers (amber dashed line + label): the place where a curve was bent.
 * `data`: rows like `{ day: "2026-03-01", a: 12, b: 15 }`; `lines` say which keys to draw.
 */
export function LineChart({ node }: NodeProps) {
  const resolve = useResolve();
  const data = (resolve(node.data) as Row[] | undefined) ?? [];
  const lines = (node.lines as Series[] | undefined) ?? [];
  const markers = (resolve(node.markers) as Marker[] | undefined) ?? [];
  const xKey = (node.xKey as string | undefined) ?? "day";
  return (
    <Frame title={str(resolve(node.title))} height={Number(node.height ?? 260)}>
      <RLineChart data={data} margin={{ top: 22, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} tickFormatter={shortDate} minTickGap={28} stroke={GRID} />
        <YAxis tick={AXIS} width={44} stroke={GRID} tickFormatter={tooltipValue} />
        <Tooltip labelFormatter={(v) => formatDate(toText(v))} formatter={tooltipValue} />
        {lines.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 13 }} />}
        {markers.map((m, i) => (
          <ReferenceLine
            key={`${m.date}-${m.label}`}
            x={m.date}
            stroke={STORY}
            strokeDasharray="4 4"
            label={{
              value: markers.length > 1 ? `◆ ${String(i + 1)}` : `◆ ${m.label}`,
              position: "insideTopLeft",
              fill: STORY,
              fontSize: 12,
            }}
          />
        ))}
        {lines.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={SERIES_COLORS[s.color ?? i] ?? SERIES_COLORS[0]}
            strokeWidth={2}
            strokeDasharray={s.dashed ? "6 4" : undefined}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </RLineChart>
    </Frame>
  );
}

export function BarChart({ node }: NodeProps) {
  const resolve = useResolve();
  const data = (resolve(node.data) as Row[] | undefined) ?? [];
  const bars = (node.bars as Series[] | undefined) ?? [];
  const xKey = (node.xKey as string | undefined) ?? "label";
  return (
    <Frame title={str(resolve(node.title))} height={Number(node.height ?? 240)}>
      <RBarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} stroke={GRID} />
        <YAxis tick={AXIS} width={44} stroke={GRID} tickFormatter={tooltipValue} />
        <Tooltip formatter={tooltipValue} cursor={{ fill: "#f1f9f7" }} />
        {bars.length > 1 && <Legend wrapperStyle={{ fontSize: 13 }} />}
        {bars.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={SERIES_COLORS[s.color ?? i] ?? SERIES_COLORS[0]}
            radius={[6, 6, 0, 0]}
            isAnimationActive={false}
          />
        ))}
      </RBarChart>
    </Frame>
  );
}
