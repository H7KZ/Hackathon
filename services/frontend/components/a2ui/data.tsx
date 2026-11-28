"use client";

import { useState } from "react";
import { formatValue, toText, type Format } from "../../lib/format";
import { useResolve } from "./context";
import { str, type NodeProps } from "./tree";

/** Big number with label and optional signed change (`delta`, a ratio: 0.38 → +38 %). */
export function Kpi({ node }: NodeProps) {
  const resolve = useResolve();
  const value = resolve(node.value);
  const delta = resolve(node.delta) as number | undefined;
  const format = (node.format as Format | undefined) ?? "number";
  const unit = str(resolve(node.unit));
  return (
    <div className="a2-kpi" style={{ flexGrow: node.weight ?? 1 }}>
      <span className="a2-kpi-label">{str(resolve(node.label))}</span>
      <span className="a2-kpi-value">
        {formatValue(value, format)}
        {unit && <small> {unit}</small>}
      </span>
      {typeof delta === "number" && (
        <span className={`a2-kpi-delta ${delta >= 0 ? "up" : "down"}`}>
          {delta >= 0 ? "▲" : "▼"} {formatValue(delta, "delta")}
        </span>
      )}
    </div>
  );
}

type Column = { key: string; label: string; format?: Format; goodWhen?: "up" | "down" };
type Row = Record<string, unknown>;

/** Sortable read-only table; shows `maxRows` (default 8) then "Zobrazit vše". */
export function Table({ node }: NodeProps) {
  const resolve = useResolve();
  const columns = (node.columns as Column[] | undefined) ?? [];
  const rows = (resolve(node.rows) as Row[] | undefined) ?? [];
  const max = Number(node.maxRows ?? 8);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [all, setAll] = useState(false);
  const sorted = sort
    ? [...rows].sort((a, b) => {
        const x = a[sort.key];
        const y = b[sort.key];
        if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir;
        return toText(x).localeCompare(toText(y), "cs") * sort.dir;
      })
    : rows;
  const shown = all ? sorted : sorted.slice(0, max);
  const caption = str(resolve(node.caption));
  return (
    <div className="a2-table-wrap">
      <table className="a2-table">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => {
              const dir = sort?.key === c.key ? sort.dir : 0;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={c.format && c.format !== "text" ? "num" : ""}
                  aria-sort={dir === 1 ? "ascending" : dir === -1 ? "descending" : "none"}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSort({ key: c.key, dir: dir === 1 ? -1 : 1 });
                    }}
                  >
                    {c.label}
                    <span aria-hidden="true">{dir === 1 ? " ↑" : dir === -1 ? " ↓" : ""}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            // ids repeat when the noise duplicates rows (live run 4), so the position is part of the key
            <tr key={`${toText(row.id ?? "")}#${String(i)}`}>
              {columns.map((c) => {
                const v = row[c.key];
                // delta is coloured only when the column says which direction is good
                let tone = "";
                if (c.format === "pass" || c.format === "yesno") tone = v ? "ok" : "fail";
                else if (c.format === "delta" && typeof v === "number" && c.goodWhen && v !== 0)
                  tone = v > 0 === (c.goodWhen === "up") ? "ok" : "fail";
                return (
                  <td key={c.key} className={`${c.format && c.format !== "text" ? "num" : ""} ${tone}`}>
                    {formatValue(v, c.format)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && (
        <button
          type="button"
          className="a2-more"
          onClick={() => {
            setAll(!all);
          }}
        >
          {all ? "Zobrazit méně" : `Zobrazit vše (${String(rows.length)})`}
        </button>
      )}
    </div>
  );
}
