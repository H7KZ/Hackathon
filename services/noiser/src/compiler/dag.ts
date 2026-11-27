import type { ProcessDef } from "@s2d/schema/scenario";

/** "fulfil:else" -> "fulfil" */
export function sourceProcessId(source: string): string {
  return source.split(":")[0] ?? source;
}

export type TopoResult = { ok: true; order: string[] } | { ok: false; cycle: string[] };

/** Kahn's algorithm over source edges; stable (keeps declaration order among ready nodes). */
export function topoSort(processes: readonly ProcessDef[]): TopoResult {
  const ids = processes.map((p) => p.id);
  const deps = new Map<string, string[]>();
  for (const p of processes) {
    deps.set(p.id, p.type === "arrival" ? [] : [sourceProcessId(p.source)].filter((s) => ids.includes(s)));
  }

  const order: string[] = [];
  const done = new Set<string>();
  let progressed = true;
  while (progressed && order.length < ids.length) {
    progressed = false;
    for (const id of ids) {
      if (done.has(id)) continue;
      if ((deps.get(id) ?? []).every((d) => done.has(d))) {
        order.push(id);
        done.add(id);
        progressed = true;
      }
    }
  }
  if (order.length === ids.length) return { ok: true, order };
  return { ok: false, cycle: ids.filter((id) => !done.has(id)) };
}
