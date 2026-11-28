/**
 * Dataset time range and recording granularity: "6 months by hour" or "4 years by day".
 * `from`/`to` are derived from start + length + unit and kept in the same object, so anything bound
 * to `/config/time/from|to` (the curve editor axis) follows the picker immediately.
 */
import { addDays, daysBetween } from "./curve";

export const UNITS = ["days", "weeks", "months", "years"] as const;
export type Unit = (typeof UNITS)[number];
export const GRANULARITIES = ["hour", "day", "week"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export type TimeConfig = {
  start: string;
  length: number;
  unit: Unit;
  granularity: Granularity;
  from: string;
  to: string;
  /**
   * live sessions only: true = the agent picks the period (nothing is sent), false = the user's
   * from..to goes to the API as `settings.period`.
   */
  auto?: boolean;
};

/** Live sessions: the engine writes one date per record; "hour" adds a time of day (`ts` column). */
export const LIVE_GRANULARITY_LABEL: Partial<Record<Granularity, string>> = {
  day: "dnech (jen datum)",
  hour: "dnech s časem",
};
export const LIVE_PRESETS: { label: string; length: number; unit: Unit }[] = [
  { label: "3 měsíce", length: 3, unit: "months" },
  { label: "6 měsíců", length: 6, unit: "months" },
  { label: "1 rok", length: 1, unit: "years" },
  { label: "2 roky", length: 2, unit: "years" },
];

export const UNIT_LABEL: Record<Unit, string> = {
  days: "dní",
  weeks: "týdnů",
  months: "měsíců",
  years: "let",
};
export const GRANULARITY_LABEL: Record<Granularity, string> = {
  hour: "hodinách",
  day: "dnech",
  week: "týdnech",
};

/** Hard limits so a typo cannot ask for 10 000 years. */
export const MAX_LENGTH: Record<Unit, number> = { days: 3650, weeks: 520, months: 120, years: 10 };
/** Above this many records per entity the picker warns (hourly data over years explodes). */
export const WARN_SAMPLES = 20_000;

function addMonths(iso: string, months: number): string {
  const [y = 2026, m = 1, d = 1] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, d));
  return date.toISOString().slice(0, 10);
}

/** Last day (inclusive) of a range that starts on `start`. */
export function endOf(start: string, length: number, unit: Unit): string {
  const n = Math.max(1, Math.round(length));
  if (unit === "days") return addDays(start, n - 1);
  if (unit === "weeks") return addDays(start, n * 7 - 1);
  return addDays(addMonths(start, unit === "months" ? n : n * 12), -1);
}

export function makeTime(start: string, length: number, unit: Unit, granularity: Granularity): TimeConfig {
  const len = Math.min(MAX_LENGTH[unit], Math.max(1, Math.round(length) || 1));
  return { start, length: len, unit, granularity, from: start, to: endOf(start, len, unit) };
}

/** Recompute derived fields (and clamp) after any edit. */
export const normalizeTime = (t: TimeConfig): TimeConfig => ({
  ...makeTime(t.start, t.length, t.unit, t.granularity),
  ...(t.auto !== undefined && { auto: t.auto }),
});

export const daysIn = (t: TimeConfig) => daysBetween(t.from, t.to) + 1;

/** Records per entity per process: days × 24 for hourly, ÷ 7 for weekly. */
export function samplesPerEntity(t: TimeConfig): number {
  const days = daysIn(t);
  return t.granularity === "hour" ? days * 24 : t.granularity === "week" ? Math.ceil(days / 7) : days;
}

export const PRESETS: { label: string; length: number; unit: Unit; granularity: Granularity }[] = [
  { label: "2 týdny po hodinách", length: 2, unit: "weeks", granularity: "hour" },
  { label: "6 měsíců po dnech", length: 6, unit: "months", granularity: "day" },
  { label: "6 měsíců po hodinách", length: 6, unit: "months", granularity: "hour" },
  { label: "4 roky po dnech", length: 4, unit: "years", granularity: "day" },
];
