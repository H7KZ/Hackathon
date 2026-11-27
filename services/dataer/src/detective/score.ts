/** Scores detective findings against truth.story_points (SPEC §3.E): entity match, start within ±14 days, nearest point. */
import type { DetectiveScore, Finding, TruthPoint } from "@s2d/schema/detective";

export const DATE_TOLERANCE_DAYS = 14;

function dayDiff(a: string, b: string): number {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.abs(da - db) / 86_400_000;
}

const sharesEntity = (f: Finding, p: TruthPoint) => f.entities.some((e) => p.entityIds.includes(e));

/**
 * A finding may match a story point only if it names one of its entities, starts within ±14 days, AND
 * that point is the nearest in time among the points sharing an entity with it (ties allowed). Live run
 * #2: a finding about the 1 March delays was matched to the 15 March short-shipping point because both
 * were about the same supplier and inside the window.
 */
function eligibility(findings: Finding[], truth: TruthPoint[]): boolean[][] {
  return findings.map((f) => {
    const diffs = truth.map((p) =>
      sharesEntity(f, p) ? dayDiff(f.start, p.start) : Number.POSITIVE_INFINITY,
    );
    const nearest = Math.min(...diffs);
    return diffs.map((d) => d <= DATE_TOLERANCE_DAYS && d === nearest);
  });
}

/** Maximum bipartite matching (augmenting paths) — sets are tiny, so O(V·E) is fine. */
export function scoreFindings(findings: Finding[], truth: TruthPoint[]): DetectiveScore {
  const eligible = eligibility(findings, truth);
  const matches = (fi: number, ti: number) => eligible[fi]?.[ti] === true;
  const findingOwner = new Map<number, number>(); // finding index -> truth index

  const tryAssign = (ti: number, seen: Set<number>): boolean => {
    const point = truth[ti];
    if (!point) return false;
    for (let fi = 0; fi < findings.length; fi++) {
      const f = findings[fi];
      if (!f || seen.has(fi) || !matches(fi, ti)) continue;
      seen.add(fi);
      const owner = findingOwner.get(fi);
      if (owner === undefined || tryAssign(owner, seen)) {
        findingOwner.set(fi, ti);
        return true;
      }
    }
    return false;
  };
  truth.forEach((_, ti) => tryAssign(ti, new Set()));

  const matched = [...findingOwner.entries()]
    .map(([findingIndex, ti]) => ({ storyPointId: truth[ti]?.id ?? "", findingIndex }))
    .sort((a, b) => a.findingIndex - b.findingIndex);

  return {
    recall: truth.length === 0 ? 1 : matched.length / truth.length,
    precision: findings.length === 0 ? 0 : matched.length / findings.length,
    matched,
  };
}
