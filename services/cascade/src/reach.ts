/**
 * Story-gate feedback for A5: where each story lever sits and whether a process chain carries it to the
 * table an expectation measures. Live run 3 (marketing): three attempts measured -0.5 % on the campaign
 * table and the agent never saw that the lever did not reach it.
 */
import type { CompileError } from "@s2d/schema/api";
import type { InfluenceEdges } from "./checks";
import type { Scenario } from "@s2d/schema/scenario";
import { curveParamRefs, sqlTables } from "./checks";

type Graph = Map<string, Set<string>>;

const add = (g: Graph, a: string, b: string) => {
  if (a === b) return;
  const s = g.get(a) ?? new Set<string>();
  s.add(b);
  g.set(a, s);
};

/** Flow ids named anywhere below `node` (effects, flowGte conditions, topUp). */
function flowsIn(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => flowsIn(n, out));
  else if (typeof node === "object" && node !== null) {
    for (const [k, v] of Object.entries(node)) {
      if (k === "flow" && typeof v === "string") out.add(v);
      else flowsIn(v, out);
    }
  }
  return out;
}

/** Owner-level graph: process -> its tables, source -> consumer, process -> flow it moves -> process that reads it, plus 03_influences. */
function buildGraph(s: Pick<Scenario, "processes">, influences: InfluenceEdges | undefined): Graph {
  const g: Graph = new Map();
  for (const p of s.processes) {
    const outcomes = p.type === "branch" ? [p.then, p.else].filter((o) => o !== undefined) : [p];
    for (const o of outcomes) add(g, p.id, o.table);
    if (p.type !== "arrival") add(g, p.source.split(":")[0] ?? "", p.id);
    const effects = p.type === "branch" ? outcomes.map((o) => o.effects) : [p.effects];
    for (const f of flowsIn(effects)) add(g, p.id, f);
    const { effects: _e, ...rest } = p as Record<string, unknown>;
    const reads = p.type === "branch" ? [p.cond, ...outcomes.map((o) => o.fields)] : [rest];
    for (const f of flowsIn(reads)) add(g, f, p.id);
  }
  const owner = (n: string) => n.split(".")[0] ?? n;
  for (const e of influences?.edges ?? []) add(g, owner(e.from), owner(e.to));
  return g;
}

function path(g: Graph, from: string, to: string): string[] | null {
  const prev = new Map<string, string>([[from, ""]]);
  const queue = [from];
  while (queue.length > 0) {
    const n = queue.shift() ?? "";
    if (n === to) {
      const out = [n];
      for (let p = prev.get(n); p; p = prev.get(p)) out.unshift(p);
      return out;
    }
    for (const m of g.get(n) ?? []) {
      if (!prev.has(m)) {
        prev.set(m, n);
        queue.push(m);
      }
    }
  }
  return null;
}

/**
 * One extra feedback entry per failed expectation: the bending curves, where they are used, and the
 * chain (or its absence) to the measured table. Empty when no expectation failed.
 */
export function describeLeverReach(
  scenario: Pick<Scenario, "processes" | "curves" | "expectations" | "entities" | "flows">,
  errors: readonly CompileError[],
  influences?: InfluenceEdges,
): CompileError[] {
  const failed = errors
    .map((e) => /^expectations\[(\d+)\]$/.exec(e.path)?.[1])
    .filter((i): i is string => i !== undefined)
    .map((i) => scenario.expectations[Number(i)])
    .filter((e) => e !== undefined);
  if (failed.length === 0) return [];
  const levers = scenario.curves.filter((c) => c.segments.length > 0);
  const refs = curveParamRefs(scenario);
  const g = buildGraph(scenario, influences);
  const usage = levers.map((c) => ({ c, at: refs.filter((r) => r.curve === c.id) }));
  const leverText = usage
    .map(({ c, at }) => {
      const scope = c.scope ? ` scoped ${c.scope.field} in ${JSON.stringify(c.scope.ids)}` : "";
      return at.length === 0
        ? `"${c.id}"${scope} is not used anywhere`
        : `"${c.id}"${scope} drives ${at.map((r) => `${r.ref} (${r.path})`).join(", ")}`;
    })
    .join("; ");
  return failed.map((e) => {
    const tables = sqlTables(e.sql);
    const chains = usage.flatMap(({ c, at }) =>
      at.flatMap((r) =>
        tables
          .map((t) => path(g, r.ref.split(".")[0] ?? "", t))
          .filter((p): p is string[] => p !== null)
          .map((p) => `"${c.id}": ${p.join(" -> ")}`),
      ),
    );
    const reach =
      chains.length > 0
        ? `The levers reach it through ${chains.slice(0, 3).join("; ")}; strengthen that chain (lever level, its scale, the share of records it touches, probabilities and counts along it).`
        : `No process chain from a used lever reaches ${tables.join(", ")} (process -> its table, source -> branch/derive, effect -> flow -> process reading it): the lever cannot move what this expectation measures. Connect the lever's process to it or move the lever to a root upstream of it.`;
    return {
      path: `expectations.${e.id}.reach`,
      message: `"${e.id}" reads ${tables.join(", ") || "no table"}. Story levers: ${leverText || "none"}. ${reach}`,
    };
  });
}
