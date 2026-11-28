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
/**
 * A metric reached through the SUCCESS outcome of a branch (sales when some shelves are empty) is the
 * normal, high-volume outcome: the story removes only a share of it. v1 A4 calibrates such totals at 5 %
 * (live runs reached -7..-9 %); the causal design measured sale -8.2 % / -8.6 % against a flat 10 % in
 * live run 3, with the direction right. Rare outcomes (the failure branch, probabilistic events) keep 10 %.
 */
export const MIN_CHANGE_DILUTED = 0.05;
/*
 * States are measured as the share of snapshot rows at zero (stock-out share), not availability:
 * availability sits near 1, so a real drop is compressed (live run: -6..-10% on every seed, while the
 * stock-out share rose ~ +85%). Their direction is therefore opposite to the level's.
 */
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

/**
 * One lever's episode: the story point where it deviates most from its baseline (the peak), and the
 * first day it leaves the baseline. Comparing the peak with the untouched baseline gives the largest,
 * most robust effect; a live run that compared adjacent story points measured only noise.
 */
interface Episode extends Move {
  peak: StoryPoint;
  firstMove: string;
}

function episodes(map: CausalMap, overlay: StoryOverlay, entities: readonly EntityDef[]): Episode[] {
  const out: Episode[] = [];
  for (const row of overlay.levers) {
    const baseline = map.nodes.find((n) => n.id === row.lever)?.baseline ?? 0;
    const moved = leverPeriods(row, overlay.storyPoints).filter((p) => p.value !== baseline);
    const [first] = moved;
    if (!first) continue;
    const peak = moved.reduce((a, p) =>
      Math.abs(p.value - baseline) > Math.abs(a.value - baseline) ? p : a,
    );
    const prefix = row.scope?.ids[0]?.split("-")[0];
    const entity = entities.find((e) => e.idPrefix === prefix)?.name ?? peak.storyPoint.entity?.name;
    out.push({
      lever: row.lever,
      sign: peak.value > baseline ? 1 : -1,
      focus: row.scope && entity ? { entity, ids: row.scope.ids } : undefined,
      peak: peak.storyPoint,
      firstMove: first.storyPoint.start,
    });
  }
  return out;
}

/** Days skipped at the start of the baseline window: flows start at `initial` and need to settle. */
export const WARMUP_DAYS = 28;

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/** Baseline window before the first move, without the warm-up when the baseline is long enough. */
export function baselineWindow(start: string, firstMove: string) {
  return {
    start: daysBetween(start, firstMove) >= 2 * WARMUP_DAYS ? addDays(start, WARMUP_DAYS) : start,
    end: firstMove,
  };
}

const WORD = { increase: "vzroste", decrease: "klesne", stable: "zůstane stabilní" } as const;

export function deriveHypotheses(map: CausalMap, overlay: StoryOverlay, plan: ProcessesPlan): Hypothesis[] {
  const observed = new Set(observedTables(plan));
  const metrics = map.nodes.filter(
    (n) => (n.kind === "event" || n.kind === "state") && n.table !== undefined && observed.has(n.table),
  );
  // no stable control for rare events, states or branch failures: too noisy for a +-15% band
  const rare = new Set([
    ...map.edges.filter((e) => e.type === "probabilistic").map((e) => e.to),
    ...map.nodes.filter((n) => n.kind === "state").map((n) => n.id),
    // the failure outcome of a branch (lost sale on an empty shelf) comes in multi-day bursts
    ...map.edges
      .filter((e) => e.sign === "negative" && map.nodes.find((n) => n.id === e.from)?.kind === "branch")
      .map((e) => e.to),
  ]);
  const byPeak = new Map<string, Episode[]>();
  for (const e of episodes(map, overlay, plan.entities))
    byPeak.set(e.peak.id, [...(byPeak.get(e.peak.id) ?? []), e]);
  const out: Hypothesis[] = [];
  for (const moves of byPeak.values()) {
    const sp = moves[0]?.peak;
    if (!sp) continue;
    const before = baselineWindow(overlay.start, moves.map((m) => m.firstMove).sort()[0] ?? sp.start);
    const after = { start: sp.start, end: sp.end ?? addDays(overlay.end, 1) };
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
          description: `${node.kind === "state" ? "Podíl dní bez zásoby (value <= 0): " : ""}${node.description} (${table})${where} ${WORD[h.direction]} v období „${sp.title}“ (od ${sp.start}) proti období před příběhem`,
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
        // a state is measured as its stock-out share (EXPECTATION_SQL), which moves against the level
        direction:
          first.net.sign * first.move.sign * (node.kind === "state" ? -1 : 1) > 0 ? "increase" : "decrease",
        minRelChange: diluted(map, first.net.path.edges) ? MIN_CHANGE_DILUTED : MIN_CHANGE,
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
  }
  return out;
}

/** The path leaves a branch through its success (positive) outcome: the metric is diluted volume. */
function diluted(map: CausalMap, edgeIds: readonly string[]): boolean {
  return edgeIds.some((id) => {
    const e = map.edges.find((x) => x.id === id);
    return e?.sign === "positive" && map.nodes.find((n) => n.id === e.from)?.kind === "branch";
  });
}
