/** Compare two runs (SPEC §3.F): same seed, different parameter -> metric deltas. */
import type { MetricDiff } from "@s2d/schema/evidence";

export function diffMetrics(a: Record<string, number>, b: Record<string, number>): MetricDiff[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.map((metric) => {
    const va = a[metric] ?? null;
    const vb = b[metric] ?? null;
    const delta = va !== null && vb !== null ? vb - va : null;
    const relChange = delta !== null && va !== null && va !== 0 ? delta / Math.abs(va) : null;
    return { metric, a: va, b: vb, delta, relChange };
  });
}
