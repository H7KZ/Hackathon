/**
 * Compiler / validator (SPEC §3.B). Errors are `{ path, message }[]` and are fed back to agent A5,
 * so every message must say what is wrong AND what would be valid.
 * SQL of expectations is only shape-checked here (noiser may not import a database). The cascade
 * checks which tables it reads (cascade/src/checks.ts); the SQL first runs against DuckDB in evidence.
 */
import { Scenario, type ProcessDef } from "@s2d/schema/scenario";
import type { CompileError } from "@s2d/schema/api";
import { sourceProcessId, topoSort } from "./dag";
import { checkStoryRefs } from "./story";

export type CompileResult =
  { ok: true; scenario: Scenario; order: string[] } | { ok: false; errors: CompileError[] };

type Visit = (node: Record<string, unknown>, path: string) => void;

/** Depth-first walk over every plain object in `value`. */
function walk(value: unknown, path: string, visit: Visit): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      walk(v, `${path}[${i}]`, visit);
    });
  } else if (value !== null && typeof value === "object") {
    const node = value as Record<string, unknown>;
    visit(node, path);
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, visit);
  }
}

/** Every string value in `value` with its path. */
function strings(value: unknown, path: string, out: [string, string][] = []): [string, string][] {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out);
  }
  return out;
}

/** zod issue path -> "processes[0].fields.x" (same format as the rest of the compiler). */
function formatPath(segments: readonly PropertyKey[]): string {
  return segments
    .map((s, i) => (typeof s === "number" ? `[${s}]` : `${i === 0 ? "" : "."}${String(s)}`))
    .join("");
}

function list(values: Iterable<string>): string {
  return [...values].map((v) => `"${v}"`).join(", ") || "(none)";
}

function sameSet(a: Iterable<string>, b: Iterable<string>): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

export function compileScenario(raw: unknown): CompileResult {
  const parsed = Scenario.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })),
    };
  }
  const s = parsed.data;
  const errors: CompileError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });

  const entities = new Map(s.entities.map((e) => [e.name, e]));
  const curves = new Set(s.curves.map((c) => c.id));
  const flows = new Map(s.flows.map((f) => [f.id, f]));
  const processes = new Map<string, ProcessDef>(s.processes.map((p) => [p.id, p]));
  const storyPoints = new Set(s.storyPoints.map((p) => p.id));

  // ---- unique ids ----
  const dupes = (kind: string, ids: string[], path: string) => {
    const seen = new Set<string>();
    ids.forEach((id, i) => {
      if (seen.has(id)) err(`${path}[${i}]`, `Duplicate ${kind} id "${id}"; ids must be unique.`);
      seen.add(id);
    });
  };
  dupes(
    "entity",
    s.entities.map((e) => e.name),
    "entities",
  );
  dupes(
    "curve",
    s.curves.map((c) => c.id),
    "curves",
  );
  dupes(
    "flow",
    s.flows.map((f) => f.id),
    "flows",
  );
  dupes(
    "process",
    s.processes.map((p) => p.id),
    "processes",
  );
  dupes(
    "story point",
    s.storyPoints.map((p) => p.id),
    "storyPoints",
  );
  dupes(
    "expectation",
    s.expectations.map((e) => e.id),
    "expectations",
  );

  // ---- references anywhere in the document ----
  const checkKeys = (path: string, flowId: unknown, keys: unknown) => {
    const flow = typeof flowId === "string" ? flows.get(flowId) : undefined;
    if (!flow || keys === null || typeof keys !== "object") return;
    if (!sameSet(Object.keys(keys), flow.keys)) {
      err(`${path}.keys`, `Keys of flow "${flow.id}" must be exactly ${list(flow.keys)}.`);
    }
  };
  walk(s, "", (node, path) => {
    if (typeof node.curve === "string" && !curves.has(node.curve)) {
      err(`${path}.curve`, `Unknown curve "${node.curve}". Defined curves: ${list(curves)}.`);
    }
    if ((node.gen === "pick" || node.gen === "lookup") && typeof node.entity === "string") {
      const entity = entities.get(node.entity);
      if (!entity) {
        err(`${path}.entity`, `Unknown entity "${node.entity}". Defined entities: ${list(entities.keys())}.`);
      } else {
        const fields = Object.keys(entity.fields);
        if (node.gen === "lookup" && typeof node.field === "string" && !fields.includes(node.field)) {
          err(
            `${path}.field`,
            `Entity "${entity.name}" has no field "${node.field}". Fields: ${list(fields)}.`,
          );
        }
        if (node.gen === "pick" && typeof node.weightBy === "string" && !fields.includes(node.weightBy)) {
          err(
            `${path}.weightBy`,
            `Entity "${entity.name}" has no field "${node.weightBy}". Fields: ${list(fields)}.`,
          );
        }
      }
    }
    if (typeof node.flow === "string") {
      if (!flows.has(node.flow))
        err(`${path}.flow`, `Unknown flow "${node.flow}". Defined flows: ${list(flows.keys())}.`);
      else if ("keys" in node) checkKeys(path, node.flow, node.keys);
    }
    if (typeof node.storyPointId === "string" && !storyPoints.has(node.storyPointId)) {
      err(
        `${path}.storyPointId`,
        `Unknown story point "${node.storyPointId}". Defined: ${list(storyPoints)}.`,
      );
    }
    if (node.gen === "categorical" && Array.isArray(node.weights) && Array.isArray(node.values)) {
      if (node.weights.length !== node.values.length) {
        err(
          `${path}.weights`,
          `categorical needs one weight per value (${node.values.length}), got ${node.weights.length}.`,
        );
      }
    }
  });

  s.flows.forEach((f, i) => {
    f.keys.forEach((k, j) => {
      if (!entities.has(k))
        err(
          `flows[${i}].keys[${j}]`,
          `Flow key "${k}" is not an entity. Use one of ${list(entities.keys())}.`,
        );
    });
  });

  // ---- tables: no clash with entities/snapshots; one visibility per table ----
  const tableVisibility = new Map<string, string>();
  const claimTable = (path: string, table: string, visibility = "observed") => {
    if (entities.has(table))
      err(path, `Table "${table}" clashes with entity "${table}". Use another table name.`);
    const prev = tableVisibility.get(table);
    if (prev !== undefined && prev !== visibility) {
      err(
        path,
        `Table "${table}" is written as both ${prev} and ${visibility}; use one visibility per table.`,
      );
    }
    tableVisibility.set(table, visibility);
  };
  s.flows.forEach((f, i) => {
    if (f.snapshot) claimTable(`flows[${i}].snapshot.table`, f.snapshot.table, f.snapshot.visibility);
  });

  // ---- processes ----
  s.processes.forEach((p, i) => {
    const at = `processes[${i}]`;
    if (p.type === "branch") {
      if (!p.then && !p.else) err(at, `Branch "${p.id}" needs a "then" or "else" outcome.`);
      if (p.then) claimTable(`${at}.then.table`, p.then.table, p.then.visibility);
      if (p.else) claimTable(`${at}.else.table`, p.else.table, p.else.visibility);
    } else {
      claimTable(`${at}.table`, p.table, p.visibility);
    }

    if (p.type === "arrival") {
      p.per.forEach((e, j) => {
        if (!entities.has(e))
          err(`${at}.per[${j}]`, `"${e}" is not an entity. Use one of ${list(entities.keys())}.`);
      });
      if (p.rate === undefined && p.schedule === undefined) {
        err(at, `Arrival "${p.id}" needs either "rate" or "schedule".`);
      }
      for (const [path, value] of strings({ fields: p.fields, effects: p.effects, where: p.where }, at)) {
        if (value.startsWith("source."))
          err(path, `"${value}": arrival has no source record; use self.* or key.*.`);
        if (value.startsWith("key.") && !p.per.includes(value.slice(4))) {
          err(path, `"${value}": stream keys of "${p.id}" are ${list(p.per.map((e) => `key.${e}`))}.`);
        }
      }
    } else {
      for (const [path, value] of strings(p, at)) {
        if (value.startsWith("key."))
          err(path, `"${value}": key.* exists only in arrival processes; use source.*.`);
      }
      const srcId = sourceProcessId(p.source);
      const src = processes.get(srcId);
      const outcome = p.source.split(":")[1];
      if (!src) {
        err(`${at}.source`, `Unknown source process "${srcId}". Defined: ${list(processes.keys())}.`);
      } else if (outcome !== undefined && src.type !== "branch") {
        err(`${at}.source`, `"${p.source}" uses :then/:else but "${srcId}" is not a branch.`);
      } else if (outcome === undefined && src.type === "branch") {
        err(`${at}.source`, `"${srcId}" is a branch; use "${srcId}:then" or "${srcId}:else".`);
      } else if (src.type === "branch" && (outcome === "then" ? !src.then : !src.else)) {
        err(`${at}.source`, `Branch "${srcId}" has no "${outcome ?? ""}" outcome.`);
      }
      if (p.lag && p.lag.min > p.lag.max) err(`${at}.lag`, "lag.min must be <= lag.max.");
    }
  });

  // ---- self.* / source.* / key.* scopes ----
  // The engine fails on these too, but only when that code path runs (e.g. inside a rarely taken `if`),
  // so check them statically and tell A5 exactly which fields are available.
  interface Scope {
    /** fields of the current record visible here */
    self: string[];
    /** source record: its fields, `null` = no source here, `undefined` = checked elsewhere */
    source?: { ref: string; fields: string[] } | null;
    /** valid key.* names, `undefined` = checked elsewhere */
    keys?: string[];
  }
  const curveDefs = new Map(s.curves.map((c) => [c.id, c]));
  const checkScope = (value: unknown, at: string, scope: Scope) => {
    for (const [path, v] of strings(value, at)) checkPath(path, v, scope);
    // a scoped curve reads its scope field from the record that uses it
    walk(value, at, (node, path) => {
      const c = typeof node.curve === "string" ? curveDefs.get(node.curve) : undefined;
      if (c?.scope && c.scope.field !== "day") {
        checkPath(
          `${path}.curve`,
          c.scope.field,
          scope,
          (m) =>
            `The scope field "${c.scope?.field ?? ""}" of curve "${c.id}" cannot be resolved here, so the curve would stay at its baseline: ${m} To move a category of records (e.g. a customer segment), put the curve on a field declared after the field holding the category, or on a derive/branch p that reads source.<field>.`,
        );
      }
    });
  };
  const checkPath = (path: string, v: string, scope: Scope, wrap: (m: string) => string = (m) => m) => {
    const err = (p: string, m: string) => errors.push({ path: p, message: wrap(m) });
    {
      const name = v.slice(v.indexOf(".") + 1);
      if (v.startsWith("self.") && !scope.self.includes(name)) {
        err(
          path,
          scope.self.length > 0
            ? `"${v}" is not available here. self.* sees only fields declared earlier in the same record; available: ${list(scope.self.map((f) => `self.${f}`))}.`
            : `"${v}" is not available here: no field of the record exists yet (first field, condition, filter, an arrival rate or a derive p, which are evaluated before the record). Use ${scope.keys?.length ? list(scope.keys.map((k) => `key.${k}`)) + ", " : ""}source.*, key.* or day.`,
        );
      }
      if (v.startsWith("source.") && scope.source === null) {
        err(path, `"${v}": there is no source record here; source.* exists only in branch/derive processes.`);
      }
      if (v.startsWith("source.") && scope.source && !scope.source.fields.includes(name)) {
        err(
          path,
          `"${v}" is not a field of the source record "${scope.source.ref}". Fields: ${list(scope.source.fields.map((f) => `source.${f}`))}.`,
        );
      }
      if (v.startsWith("key.") && scope.keys && !scope.keys.includes(name)) {
        err(
          path,
          scope.keys.length > 0
            ? `"${v}" is not available here; valid keys: ${list(scope.keys.map((k) => `key.${k}`))}.`
            : `"${v}": key.* is not available here (only in arrival processes and flow initial values).`,
        );
      }
    }
  };
  const checkRecord = (
    fields: Record<string, unknown>,
    effects: unknown,
    at: string,
    scope: Omit<Scope, "self">,
  ) => {
    const names = Object.keys(fields);
    names.forEach((name, i) => {
      checkScope(fields[name], `${at}.fields.${name}`, { ...scope, self: names.slice(0, i) });
    });
    checkScope(effects, `${at}.effects`, { ...scope, self: names });
  };
  const sourceFields = (ref: string): { ref: string; fields: string[] } | undefined => {
    const src = processes.get(sourceProcessId(ref));
    const record = src?.type === "branch" ? (ref.endsWith(":else") ? src.else : src.then) : src;
    return record ? { ref, fields: Object.keys(record.fields) } : undefined;
  };

  s.entities.forEach((e, i) => {
    checkRecord(e.fields, undefined, `entities[${i}]`, { source: null, keys: [] });
  });
  s.flows.forEach((f, i) => {
    checkScope(f.initial, `flows[${i}].initial`, { self: [], source: null, keys: f.keys });
  });
  s.processes.forEach((p, i) => {
    const at = `processes[${i}]`;
    if (p.type === "arrival") {
      checkRecord(p.fields, p.effects, at, {});
      checkScope(p.where, `${at}.where`, { self: [] });
      // the rate is evaluated per key before any record exists (live run 3: a self.* scope never matched)
      checkScope(p.rate, `${at}.rate`, { self: [], source: null, keys: p.per });
    } else {
      const source = sourceFields(p.source);
      if (p.type === "derive") {
        checkScope(p.p, `${at}.p`, { self: [], source });
        checkRecord(p.fields, p.effects, at, { source });
      } else {
        checkScope(p.cond, `${at}.cond`, { self: [], source });
        if (p.then) checkRecord(p.then.fields, p.then.effects, `${at}.then`, { source });
        if (p.else) checkRecord(p.else.fields, p.else.effects, `${at}.else`, { source });
      }
    }
  });

  // ---- noise: only observed tables, existing non-id columns ----
  if (s.noise) {
    interface TableInfo {
      visibility: string;
      columns: Set<string>;
      ids: Set<string>;
      process: boolean;
    }
    const tables = new Map<string, TableInfo>();
    const addTable = (
      name: string,
      visibility: string | undefined,
      fields: Record<string, { gen: string }> | string[],
      process: boolean,
    ) => {
      const info = tables.get(name) ?? {
        visibility: visibility ?? "observed",
        columns: new Set<string>(),
        ids: new Set<string>(),
        process,
      };
      for (const [col, gen] of Array.isArray(fields)
        ? fields.map((c) => [c, undefined] as const)
        : Object.entries(fields)) {
        info.columns.add(col);
        if (gen?.gen === "id") info.ids.add(col);
      }
      tables.set(name, info);
    };
    s.entities.forEach((e) => {
      addTable(e.name, e.visibility, e.fields, false);
    });
    s.processes.forEach((p) => {
      const outs = p.type === "branch" ? [p.then, p.else] : [p];
      for (const o of outs) if (o) addTable(o.table, o.visibility, o.fields, true);
    });
    s.flows.forEach((f) => {
      if (f.snapshot) {
        addTable(
          f.snapshot.table,
          f.snapshot.visibility,
          ["date", ...f.keys.map((k) => `${k}_id`), "value"],
          false,
        );
      }
    });
    const observed = [...tables].filter(([, t]) => t.visibility === "observed").map(([n]) => n);
    const observedTable = (path: string, name: string): TableInfo | undefined => {
      const t = tables.get(name);
      if (!t) err(path, `Unknown table "${name}". Observed tables: ${list(observed)}.`);
      else if (t.visibility !== "observed") {
        err(
          path,
          `Table "${name}" is ground_truth; noise applies only to observed tables: ${list(observed)}.`,
        );
      } else return t;
      return undefined;
    };
    for (const target of Object.keys(s.noise.missing ?? {})) {
      const path = `noise.missing["${target}"]`;
      const dot = target.indexOf(".");
      if (dot < 0) {
        err(path, `Key must be "<table>.<field>" with one of the observed tables: ${list(observed)}.`);
        continue;
      }
      const t = observedTable(path, target.slice(0, dot));
      const field = target.slice(dot + 1);
      if (!t) continue;
      const valid = [...t.columns].filter((c) => !t.ids.has(c));
      if (t.ids.has(field))
        err(path, `"${field}" is the record id and cannot be missing. Use one of ${list(valid)}.`);
      else if (!t.columns.has(field))
        err(path, `Table "${target.slice(0, dot)}" has no column "${field}". Use one of ${list(valid)}.`);
    }
    for (const name of Object.keys(s.noise.duplicates ?? {}))
      observedTable(`noise.duplicates["${name}"]`, name);
    if (s.noise.hourJitter) {
      const clash = [...tables].filter(
        ([, t]) => t.process && t.visibility === "observed" && t.columns.has("ts"),
      );
      if (clash.length > 0) {
        err(
          "noise.hourJitter",
          `hourJitter adds a "ts" column, but ${list(clash.map(([n]) => n))} already has one; rename that field.`,
        );
      }
    }
  }

  // ---- curve scopes and story point entities ----
  errors.push(...checkStoryRefs(s));

  // ---- dates ----
  const inRange = (d: string) => d >= s.meta.start && d <= s.meta.end;
  const range = `${s.meta.start}..${s.meta.end}`;
  if (s.meta.start > s.meta.end) err("meta.end", "meta.end must be on or after meta.start.");
  s.curves.forEach((c, i) => {
    if (c.clamp && c.clamp[0] > c.clamp[1])
      err(`curves[${i}].clamp`, "clamp must be [min, max] with min <= max.");
    c.segments.forEach((seg, j) => {
      const at = `curves[${i}].segments[${j}]`;
      if (!inRange(seg.start)) err(`${at}.start`, `Date ${seg.start} is outside ${range}.`);
      if (seg.end !== undefined) {
        if (!inRange(seg.end)) err(`${at}.end`, `Date ${seg.end} is outside ${range}.`);
        if (seg.end <= seg.start) err(`${at}.end`, `end (${seg.end}) must be after start (${seg.start}).`);
      }
    });
  });
  s.storyPoints.forEach((sp, i) => {
    if (!inRange(sp.start)) err(`storyPoints[${i}].start`, `Date ${sp.start} is outside ${range}.`);
    if (sp.end !== undefined && !inRange(sp.end))
      err(`storyPoints[${i}].end`, `Date ${sp.end} is outside ${range}.`);
  });
  s.expectations.forEach((e, i) => {
    if (!/\bperiod\b/i.test(e.sql) || !/\bvalue\b/i.test(e.sql)) {
      err(`expectations[${i}].sql`, "SQL must return columns `period` ('before'|'after') and `value`.");
    }
    if (/\btruth\./i.test(e.sql))
      err(`expectations[${i}].sql`, "Expectations may read only schema main, not truth.");
  });

  const topo = topoSort(s.processes);
  if (!topo.ok)
    err("processes", `Processes form a cycle via sources (or depend on one): ${list(topo.cycle)}.`);

  if (errors.length > 0 || !topo.ok) return { ok: false, errors };
  return { ok: true, scenario: s, order: topo.order };
}
