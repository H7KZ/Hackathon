"use client";

import { useId } from "react";
import { formatDate } from "../../lib/format";
import {
  GRANULARITIES,
  GRANULARITY_LABEL,
  LIVE_GRANULARITY_LABEL,
  LIVE_PRESETS,
  MAX_LENGTH,
  PRESETS,
  UNITS,
  UNIT_LABEL,
  WARN_SAMPLES,
  daysIn,
  makeTime,
  samplesPerEntity,
  type Granularity,
  type TimeConfig,
  type Unit,
} from "../../lib/chat/time";
import { useBinding } from "./context";
import type { NodeProps } from "./tree";

const FALLBACK = makeTime("2026-01-05", 6, "months", "day");

type SetTime = (
  patch: Partial<Pick<TimeConfig, "start" | "length" | "unit" | "granularity" | "auto">>,
) => void;

/**
 * Live session: the agent picks the period unless the user sets one (then it is sent with approve).
 * Records are daily (engine); "s časem" adds a time of day to each record.
 */
function LivePeriod({ t, id, set }: { t: TimeConfig; id: string; set: SetTime }) {
  const gran = (
    <div className="a2-period-gran" role="radiogroup" aria-label="Záznam po">
      <span>Záznam po</span>
      <div>
        {(["day", "hour"] as const).map((g) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={t.granularity === g}
            onClick={() => {
              set({ granularity: g });
            }}
          >
            {LIVE_GRANULARITY_LABEL[g]}
          </button>
        ))}
      </div>
    </div>
  );
  if (t.auto !== false)
    return (
      <fieldset className="a2-period">
        <legend>Období a záznam dat</legend>
        <div className="a2-period-row">
          <p className="a2-period-auto">
            Období určí agent podle příběhu (obvykle půl roku až rok kolem změny).
            <button
              type="button"
              className="a2-link"
              onClick={() => {
                set({ auto: false });
              }}
            >
              Nastavit vlastní období
            </button>
          </p>
          {gran}
        </div>
      </fieldset>
    );
  return (
    <fieldset className="a2-period">
      <legend>Období a záznam dat</legend>
      <div className="a2-period-row">
        <label htmlFor={`${id}-start`}>
          Začátek
          <input
            id={`${id}-start`}
            type="date"
            value={t.start}
            onChange={(e) => {
              if (e.target.value) set({ start: e.target.value });
            }}
          />
        </label>
        <label htmlFor={`${id}-len`}>
          Délka
          <span className="a2-period-len">
            <input
              id={`${id}-len`}
              type="number"
              min={1}
              max={MAX_LENGTH[t.unit]}
              value={t.length}
              onChange={(e) => {
                set({ length: Number(e.target.value) || 1 });
              }}
            />
            <select
              aria-label="Jednotka délky"
              value={t.unit}
              onChange={(e) => {
                set({ unit: e.target.value as Unit });
              }}
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u]}
                </option>
              ))}
            </select>
          </span>
        </label>
        {gran}
      </div>
      <p className="a2-period-sum" role="status">
        {formatDate(t.from)} – {formatDate(t.to)} · {nf(daysIn(t))} dní. Všechny body příběhu musí ležet
        uvnitř.
      </p>
      <div className="a2-period-presets" aria-label="Rychlá volba">
        {LIVE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={t.length === p.length && t.unit === p.unit}
            onClick={() => {
              set({ length: p.length, unit: p.unit });
            }}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className="a2-link"
          onClick={() => {
            set({ auto: true });
          }}
        >
          Zpět na automatické
        </button>
      </div>
    </fieldset>
  );
}
const nf = (n: number) => n.toLocaleString("cs-CZ");

/**
 * Dataset range + how often records are written. Writes the whole TimeConfig (incl. derived from/to)
 * into its bound path, so the curve axis updates while the user types.
 */
export function PeriodPicker({ node }: NodeProps) {
  const [bound, setValue] = useBinding<TimeConfig>(node.value);
  const t = bound ?? FALLBACK;
  const id = useId();
  const set = (patch: Partial<Pick<TimeConfig, "start" | "length" | "unit" | "granularity" | "auto">>) => {
    const n = { ...t, ...patch };
    setValue({
      ...makeTime(n.start, n.length, n.unit, n.granularity),
      ...(n.auto !== undefined && { auto: n.auto }),
    });
  };
  if (node.live === true) return <LivePeriod t={t} id={id} set={set} />;
  const samples = samplesPerEntity(t);
  const heavy = samples > WARN_SAMPLES;
  return (
    <fieldset className="a2-period">
      <legend>Období a záznam dat</legend>
      <div className="a2-period-row">
        <label htmlFor={`${id}-start`}>
          Začátek
          <input
            id={`${id}-start`}
            type="date"
            value={t.start}
            onChange={(e) => {
              if (e.target.value) set({ start: e.target.value });
            }}
          />
        </label>
        <label htmlFor={`${id}-len`}>
          Délka
          <span className="a2-period-len">
            <input
              id={`${id}-len`}
              type="number"
              min={1}
              max={MAX_LENGTH[t.unit]}
              value={t.length}
              onChange={(e) => {
                set({ length: Number(e.target.value) || 1 });
              }}
            />
            <select
              aria-label="Jednotka délky"
              value={t.unit}
              onChange={(e) => {
                set({ unit: e.target.value as Unit });
              }}
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u]}
                </option>
              ))}
            </select>
          </span>
        </label>
        <div className="a2-period-gran" role="radiogroup" aria-label="Záznam po">
          <span>Záznam po</span>
          <div>
            {GRANULARITIES.map((g: Granularity) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={t.granularity === g}
                onClick={() => {
                  set({ granularity: g });
                }}
              >
                {GRANULARITY_LABEL[g]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className={`a2-period-sum${heavy ? " warn" : ""}`} role="status">
        {formatDate(t.from)} – {formatDate(t.to)} · {nf(daysIn(t))} dní · {nf(samples)} záznamů na entitu
        {heavy && " · hodně dat: zvažte záznam po dnech nebo kratší období"}
      </p>
      <div className="a2-period-presets" aria-label="Rychlá volba">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={t.length === p.length && t.unit === p.unit && t.granularity === p.granularity}
            onClick={() => {
              set({ length: p.length, unit: p.unit, granularity: p.granularity });
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
