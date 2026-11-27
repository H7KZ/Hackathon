/**
 * 03a_causal_map checks (docs/cascade-design.md D1/D4): the map must be a well-formed DAG whose roots
 * are levers, so curves (D2) and expectation directions (D3) can be derived from it by code.
 */
import type { CompileError } from "@s2d/schema/api";
import type { CausalEdge, CausalMap } from "@s2d/schema/artifacts";

export function checkCausalMap(map: CausalMap): CompileError[] {
  const errors: CompileError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const nodes = new Map(map.nodes.map((n) => [n.id, n]));
  const ids = [...nodes.keys()].join(", ");
  const dupes = (path: string, list: string[]) => {
    list.forEach((id, i) => {
      if (list.indexOf(id) !== i) err(`${path}.${i}.id`, `Duplicate id "${id}"; ids must be unique.`);
    });
  };
  dupes(
    "nodes",
    map.nodes.map((n) => n.id),
  );
  dupes(
    "edges",
    map.edges.map((e) => e.id),
  );
  map.edges.forEach((e, i) => {
    for (const end of ["from", "to"] as const)
      if (!nodes.has(e[end])) err(`edges.${i}.${end}`, `Unknown node "${e[end]}". Nodes: ${ids}.`);
    if (nodes.get(e.to)?.kind === "lever")
      err(
        `edges.${i}.to`,
        `Edge "${e.id}" points into lever "${e.to}". Levers are roots (moved by the story only); point the edge at what the lever influences or make "${e.to}" an attribute.`,
      );
    if (e.type === "probabilistic" && e.p === undefined)
      err(`edges.${i}.p`, `Probabilistic edge "${e.id}" needs a baseline p (0-1).`);
  });
  const levers = map.nodes.filter((n) => n.kind === "lever");
  if (levers.length === 0)
    err(
      "nodes",
      'The map has no lever. Add a node of kind "lever" for the parameter the story moves (e.g. a supplier\'s late-delivery probability) with its baseline.',
    );
  map.nodes.forEach((n, i) => {
    const out = map.edges.filter((e) => e.from === n.id).length;
    if (n.kind === "lever" && n.baseline === undefined)
      err(`nodes.${i}.baseline`, `Lever "${n.id}" needs a baseline (its value before the story).`);
    if ((n.kind === "lever" || n.kind === "branch") && out === 0)
      err(`nodes.${i}`, `${n.kind} "${n.id}" has no outgoing edge; connect it to what it influences.`);
  });
  const cycle = findCycle(map.edges);
  if (cycle)
    err(
      "edges",
      `The map has a cycle (${cycle.join(" -> ")}). It must be acyclic so effects have a direction; drop one edge of the loop.`,
    );
  return errors;
}

/** Node ids of one cycle, or undefined for a DAG. */
export function findCycle(edges: readonly Pick<CausalEdge, "from" | "to">[]): string[] | undefined {
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const state = new Map<string, "open" | "done">();
  const stack: string[] = [];
  const visit = (n: string): string[] | undefined => {
    if (state.get(n) === "done") return undefined;
    if (state.get(n) === "open") return [...stack.slice(stack.indexOf(n)), n];
    state.set(n, "open");
    stack.push(n);
    for (const m of out.get(n) ?? []) {
      const c = visit(m);
      if (c) return c;
    }
    stack.pop();
    state.set(n, "done");
    return undefined;
  };
  for (const e of edges) {
    const c = visit(e.from);
    if (c) return c;
  }
  return undefined;
}
