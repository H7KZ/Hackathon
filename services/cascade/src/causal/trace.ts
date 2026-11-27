/**
 * 03b_processes coverage (docs/cascade-design.md D4): every map edge is realized at its `trace`
 * pointer by a construct that fits the edge type, every branch/derive process realizes some edge,
 * and curves sit only on levers (AGENTS.md rule 3 in code).
 */
import type { CompileError } from "@s2d/schema/api";
import type { CausalEdge, CausalMap, ProcessesPlan } from "@s2d/schema/artifacts";
import { modelTables } from "../checks";

/** What a pointer target is, as far as the D4 mapping table cares. */
export type Realization =
  | "arrival"
  | "branch"
  | "derive"
  | "rate"
  | "bernoulli"
  | "effect"
  | "flowCond"
  | "fieldCond"
  | "topUp"
  | "lookup"
  | "if"
  | "pick"
  | "ref";

/** D4 mapping table: which realizations fit each edge type. */
export const REALIZES: Record<CausalEdge["type"], readonly Realization[]> = {
  probabilistic: ["derive", "bernoulli", "branch"],
  mechanical: ["effect", "flowCond", "topUp", "rate", "arrival", "branch"],
  attribute: ["lookup", "if", "fieldCond", "pick", "ref"],
};

/** RFC 6901 JSON pointer; undefined when it does not resolve. */
export function resolvePointer(root: unknown, pointer: string): unknown {
  if (pointer === "") return root;
  let node: unknown = root;
  for (const raw of pointer.slice(1).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(node)) node = /^\d+$/.test(key) ? node[Number(key)] : undefined;
    else if (typeof node === "object" && node !== null) node = (node as Record<string, unknown>)[key];
    else return undefined;
    if (node === undefined) return undefined;
  }
  return node;
}

const GEN: Partial<Record<string, Realization>> = {
  bernoulli: "bernoulli",
  topUp: "topUp",
  lookup: "lookup",
  if: "if",
  pick: "pick",
  ref: "ref",
};
const KIND: Partial<Record<string, Realization>> = {
  bernoulli: "bernoulli",
  flowGt: "flowCond",
  flowGte: "flowCond",
  fieldEq: "fieldCond",
  fieldGt: "fieldCond",
};

/** Realizations at a pointer: the process itself for /processes/<i>, else every construct below it. */
export function realizationsAt(plan: ProcessesPlan, pointer: string): Set<Realization> {
  const found = new Set<Realization>();
  const tokens = pointer.slice(1).split("/");
  const value = resolvePointer(plan, pointer);
  if (tokens[0] === "processes" && tokens[1] !== undefined) {
    const proc = plan.processes[Number(tokens[1])];
    if (proc && tokens.length === 2) return new Set([proc.type]);
    if (proc?.type === "derive" && tokens[2] === "p" && tokens.length === 3) found.add("derive");
    if (proc?.type === "branch" && tokens[2] === "cond") found.add("branch");
    if (tokens[2] === "rate") found.add("rate");
  }
  if (tokens.includes("effects")) found.add("effect");
  // a pointer at a Param (".../p") counts as the generator / cond that owns it
  const owner = typeof value === "number" || isCurve(value) ? resolvePointer(plan, parentOf(pointer)) : value;
  collect(owner, found);
  return found;
}

function collect(node: unknown, found: Set<Realization>): void {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, found);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const rec = node as Record<string, unknown>;
  const gen = typeof rec.gen === "string" ? GEN[rec.gen] : undefined;
  const kind = typeof rec.kind === "string" ? KIND[rec.kind] : undefined;
  if (gen) found.add(gen);
  if (kind) found.add(kind);
  if ("flow" in rec && "delta" in rec && "sign" in rec) found.add("effect");
  for (const v of Object.values(rec)) collect(v, found);
}

const isCurve = (v: unknown): v is { curve: string } =>
  typeof v === "object" && v !== null && typeof (v as Record<string, unknown>).curve === "string";
const parentOf = (pointer: string) => pointer.slice(0, pointer.lastIndexOf("/"));

/** Curve ids referenced below a node. */
export function curveIds(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) for (const n of node) curveIds(n, out);
  else if (typeof node === "object" && node !== null) {
    if (isCurve(node)) out.add(node.curve);
    for (const v of Object.values(node)) curveIds(v, out);
  }
  return out;
}

export function checkTrace(plan: ProcessesPlan, map: CausalMap): CompileError[] {
  const errors: CompileError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const nodes = new Map(map.nodes.map((n) => [n.id, n]));
  const levers = map.nodes.filter((n) => n.kind === "lever").map((n) => n.id);
  const edgeIds = new Set(map.edges.map((e) => e.id));

  for (const id of Object.keys(plan.trace))
    if (!edgeIds.has(id))
      err(`trace.${id}`, `Unknown edge "${id}". Edges of 03a_causal_map: ${[...edgeIds].join(", ")}.`);

  for (const e of map.edges) {
    const pointer = plan.trace[e.id];
    if (pointer === undefined) {
      err(
        `trace.${e.id}`,
        `Edge "${e.id}" (${e.from} -> ${e.to}, ${e.type}) is not realized. Add "trace": {"${e.id}": "<JSON pointer>"} pointing at the ${REALIZES[e.type].join(" / ")} that implements it.`,
      );
      continue;
    }
    const target = resolvePointer(plan, pointer);
    if (target === undefined) {
      err(`trace.${e.id}`, `Pointer "${pointer}" does not resolve in entities/flows/processes.`);
      continue;
    }
    const found = realizationsAt(plan, pointer);
    if (!REALIZES[e.type].some((r) => found.has(r)))
      err(
        `trace.${e.id}`,
        `Edge "${e.id}" is ${e.type}, so it must be realized by ${REALIZES[e.type].join(" / ")}; "${pointer}" is ${[...found].join(", ") || "none of these"}.`,
      );
    if (nodes.get(e.from)?.kind === "lever" && !curveIds(target).has(e.from))
      err(
        `trace.${e.id}`,
        `Edge "${e.id}" starts at lever "${e.from}", so "${pointer}" must use the Param {"curve": "${e.from}"}.`,
      );
  }

  // the other direction: every chained process realizes some edge
  const pointers = Object.values(plan.trace);
  plan.processes.forEach((p, i) => {
    if (p.type === "arrival") return;
    const at = `/processes/${i}`;
    if (!pointers.some((ptr) => ptr === at || ptr.startsWith(`${at}/`)))
      err(
        `processes.${i}`,
        `${p.type} "${p.id}" realizes no edge of the map. Trace the edge it implements (pointer ${at}...) or remove the process.`,
      );
  });

  // curves only on levers, and every lever drives something
  const used = curveIds({ entities: plan.entities, flows: plan.flows, processes: plan.processes });
  for (const c of used)
    if (!levers.includes(c))
      err(
        "curves",
        `{"curve": "${c}"} is not a lever of the map. Only levers (${levers.join(", ")}) get curves; use a constant number or reference a lever id.`,
      );
  for (const l of levers)
    if (!used.has(l))
      err("curves", `Lever "${l}" is not used. Reference it as {"curve": "${l}"} in the Param it drives.`);

  // metric tables named by the map must be written
  const tables = modelTables(plan);
  map.nodes.forEach((n) => {
    if (n.table !== undefined && !tables.has(n.table))
      err(
        `nodes.${n.id}.table`,
        `Node "${n.id}" names table "${n.table}", which no entity, process or snapshot writes. Tables: ${[...tables.keys()].join(", ")}.`,
      );
  });
  return errors;
}
