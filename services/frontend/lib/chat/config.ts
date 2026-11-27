/** UI defaults for the story settings (used by demo and live mode alike). */
import { addDays } from "./curve";
import type { StoryConfig } from "./surfaces";

const START = "2026-01-05";

export const periodFor = (months: number, from = START) => ({
  from,
  to: addDays(from, Math.round(months * 30.4) - 1),
});

export const DEFAULT_CONFIG: StoryConfig = {
  curve: { label: "Průměrné zpoždění dodávky", unit: "dny", baseline: 2, rampDays: 14, min: 0, max: 10 },
  period: periodFor(6),
  months: ["6"],
  seed: 42,
  scale: 1,
  noise: { missing: 2, duplicates: 1, hourJitter: true },
  size: { stores: 3, products: 120, customers: 2400 },
};

/** Period derived from the months picker (the UI edits `months`, the engine wants dates). */
export function normalize(config: StoryConfig): StoryConfig {
  const months = Number(config.months[0] ?? 6) || 6;
  return { ...config, period: periodFor(months, config.period.from) };
}
