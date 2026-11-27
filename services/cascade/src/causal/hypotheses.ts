/**
 * D3: expectation hypotheses derived by code. For each story point where a lever moves, the sign of
 * the move times the edge signs along the paths from that lever gives each metric's direction.
 * Metrics on no path, and the moved metrics outside the lever's scope, become `stable` controls,
 * except rare events (a node fed by a probabilistic edge): their small counts are too noisy for a
 * stable band (a real seed sweep failed them on 3/5 seeds), so they get no control.
 * The agent then writes only the SQL (sql.ts).
 */
import type { CausalEdge, CausalMap, Hypothesis, ProcessesPlan, StoryOverlay } from "@s2d/schema/artifacts";
import type { EntityDef, StoryPoint } from "@s2d/schema/scenario";
import { observedTables } from "../checks";
import { leverPeriods } from "./curves";

export const MIN_CHANGE = 0.1;
export const STABLE_TOLERANCE = 0.15;
/** A metric reached with both signs gets the sign whose strongest path is at least this much stronger. */
export const DOMINANCE = 2;

interface PathInfo {
  sign: 1 | -1;
  /** Product of p over probabilistic edges (mechanical / attribute edges count 1). */
  strength: number;
  edges: string[];
}

/** Every path from `from` to each reachable node (the map is a DAG, checkCausalMap). */
export function pathsFrom(map: CausalMap, from: string): Map<string, PathInfo[]> {
  const out = new Map<string, CausalEdge[]>();
  for (const e of map.edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  const found = new Map<string, PathInfo[]>();
  const walk = (node: string, acc: PathInfo, seen: Set<string>) => {
    for (const e of out.get(node) ?? []) {
      if (seen.has(e.to)) continue; // defensive: a cycle would loop forever
      const next: PathInfo = {
        sign: (acc.sign * (e.sign === "positive" ? 1 : -1)) as 1 | -1,
        strength: acc.strength * (e.type === "probabilistic" ? (e.p ?? 1) : 1),
        edges: [...acc.edges, e.id],
      };
      found.set(e.to, [...(found.get(e.to) ?? []), next]);
      walk(e.to, next, new Set([...seen, e.to]));
    }
  };
  walk(from, { sign: 1, strength: 1, edges: [] }, new Set([from]));
  return found;
}

/** Net direction of a metric over its paths, or "ambiguous" when no sign dominates. */
export function netSign(paths: PathInfo[]): { sign: 1 | -1; path: PathInfo } | "ambiguous" {
  const best = (s: 1 | -1) => paths.filter((p) => p.sign === s).sort((a, b) => b.strength - a.strength)[0];
  const up = best(1);
  const down = best(-1);
  if (up && (!down || up.strength >= DOMINANCE * down.strength)) return { sign: 1, path: up };
  if (down && (!up || down.strength >= DOMINANCE * up.strength)) return { sign: -1, path: down };
  return "ambiguous";
}

interface Move {
  lever: string;
  sign: 1 | -1;
  focus?: { entity: string; ids: string[] } | undefined;
}

/** Levers whose value changes at the start of `sp` (vs. the previous contiguous period or the baseline). */
function movesAt(
  sp: StoryPoint,
  map: CausalMap,
  overlay: StoryOverlay,
  entities: readonly EntityDef[],
): Move[] {
  const moves: Move[] = [];
  for (const row of overlay.levers) {
    const periods = leverPeriods(row, overlay.storyPoints);
    const i = periods.findIndex((p) => p.storyPoint.id === sp.id);
    const here = periods[i];
    if (!here) continue;
    const prev = periods[i - 1];
    const baseline = map.nodes.find((n) => n.id === row.lever)?.baseline ?? 0;
    const before = prev && prev.storyPoint.end === sp.start ? prev.value : baseline;
    if (here.value === before) continue;
    const prefix = row.scope?.ids[0]?.split("-")[0];
    const entity = entities.find((e) => e.idPrefix === prefix)?.name ?? sp.entity?.name;
    moves.push({
      lever: row.lever,
      sign: here.value > before ? 1 : -1,
      focus: row.scope && entity ? { entity, ids: row.scope.ids } : undefined,
    });
  }
  return moves;
}

const nextDay = (iso: string) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

const WORD = { increase: "vzroste", decrease: "klesne", stable: "zůstane stabilní" } as const;

export function deriveHypotheses(map: CausalMap, overlay: StoryOverlay, plan: ProcessesPlan): Hypothesis[] {
  const observed = new Set(observedTables(plan));
  const metrics = map.nodes.filter(
    (n) => (n.kind === "event" || n.kind === "state") && n.table !== undefined && observed.has(n.table),
  );
  const rare = new Set(map.edges.filter((e) => e.type === "probabilistic").map((e) => e.to));
  const points = [...overlay.storyPoints].sort((a, b) => a.start.localeCompare(b.start));
  const out: Hypothesis[] = [];
  points.forEach((sp, k) => {
    const moves = movesAt(sp, map, overlay, plan.entities);
    if (moves.length === 0) return;
    const prev = points[k - 1];
    const before = {
      start: prev ? (prev.end !== undefined && prev.end <= sp.start ? prev.end : prev.start) : overlay.start,
      end: sp.start,
    };
    const after = { start: sp.start, end: sp.end ?? nextDay(overlay.end) };
    const paths = moves.map((m) => ({ move: m, paths: pathsFrom(map, m.lever) }));
    for (const node of metrics) {
      const table = node.table ?? "";
      const add = (
        h: Omit<Hypothesis, "storyPointId" | "node" | "table" | "before" | "after" | "description">,
      ) => {
        const where = h.focus
          ? ` ${h.focus.mode === "only" ? "pro" : "mimo"} ${h.focus.entity} ${h.focus.ids.join(", ")}`
          : "";
        out.push({
          ...h,
          storyPointId: sp.id,
          node: node.id,
          table,
          before,
          after,
          description: `${node.description} (${table})${where} ${WORD[h.direction]} od ${sp.start} („${sp.title}“)`,
        });
      };
      const effects = paths.flatMap(({ move, paths: p }) => {
        const reached = p.get(node.id);
        if (!reached) return [];
        const net = netSign(reached);
        return [{ move, net }];
      });
      if (effects.length === 0) {
        if (!rare.has(node.id))
          add({
            id: `${sp.id}_${node.id}_control`,
            direction: "stable",
            minRelChange: STABLE_TOLERANCE,
            path: [],
          });
        continue;
      }
      const signs = new Set(effects.map((e) => (e.net === "ambiguous" ? 0 : e.net.sign * e.move.sign)));
      const [first] = effects;
      if (signs.size !== 1 || signs.has(0) || !first || first.net === "ambiguous") continue; // ambiguous
      const focus = effects.length === 1 ? first.move.focus : undefined;
      add({
        id: `${sp.id}_${node.id}`,
        direction: first.net.sign * first.move.sign > 0 ? "increase" : "decrease",
        minRelChange: MIN_CHANGE,
        ...(focus && { focus: { ...focus, mode: "only" as const } }),
        path: first.net.path.edges,
      });
      if (focus && !rare.has(node.id))
        add({
          id: `${sp.id}_${node.id}_outside`,
          direction: "stable",
          minRelChange: STABLE_TOLERANCE,
          focus: { ...focus, mode: "exclude" },
          path: [],
        });
    }
  });
  return out;
}
