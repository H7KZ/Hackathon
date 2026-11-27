/** ISO date <-> integer day index (days since 1970-01-01, UTC). Engine works with indices only. */
const MS_PER_DAY = 86_400_000;

export function toDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) throw new Error(`Invalid ISO date: ${iso}`);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function fromDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}
