/** UI defaults for the story settings (used by demo and live mode alike). */
import type { StoryConfig } from "./surfaces";
import { makeTime, normalizeTime } from "./time";

export const DEFAULT_CONFIG: StoryConfig = {
  curve: { label: "Průměrné zpoždění dodávky", unit: "dny", baseline: 2, rampDays: 14, min: 0, max: 10 },
  time: makeTime("2026-01-05", 6, "months", "day"),
  seed: 42,
  scale: 1,
  noise: { missing: 2, duplicates: 1, hourJitter: true },
  size: { stores: 3, products: 120, customers: 2400 },
};

/** Derived time fields recomputed (the picker keeps them in sync, this guards hand-written configs). */
export function normalize(config: StoryConfig): StoryConfig {
  return { ...config, time: normalizeTime(config.time) };
}
