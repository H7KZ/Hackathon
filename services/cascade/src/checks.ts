/**
 * Deterministic story checks (no engine, docs/cascade-design.md D5). compileScenario accepts a
 * scenario that is valid but carries no story; these catch that and go back to the agent as feedback.
 * A real Haiku run produced a single-process model with an unused late-delivery curve.
 */
import type { CompileError } from "@s2d/schema/api";
import type { DataModel, StoryPlan } from "@s2d/schema/artifacts";
import type { EntityDef, Scenario } from "@s2d/schema/scenario";

/** A2's task asks for at least this many linked tables (entities + process tables + snapshots). */
export const MIN_TABLES = 5;

/**
 * The effect needs a chain to travel through (at least one branch or derive after an arrival), and the
 * dataset needs enough tables to be worth investigating.
 */
export function checkModelShape(model: ModelTables): CompileError[] {
  const errors: CompileError[] = [];
  const tables = [...modelTables(model).keys()];
  if (tables.length < MIN_TABLES)
    errors.push({
      path: "tables",
      message: `The model writes ${tables.length} tables (${tables.join(", ")}); use at least ${MIN_TABLES} linked tables, e.g. add the actors (suppliers, stores, products) as entities or split outcomes into their own tables.`,
    });
  const hasChain = model.processes.some((p) => p.type === "branch" || p.type === "derive");
  if (hasChain) return errors;
  return [
    ...errors,
    {
      path: "processes",
      message:
        "The model has no causal chain: add branch/derive processes so the story's lever (an arrival or a field probability) leads to the outcome tables, e.g. order -> branch on stock -> sale / lost_sale -> derive complaint.",
    },
  ];
}

/**
 * Every curve planned in 04_story that bends (has segments) must drive some Param, otherwise its story
 * point never shows. A flat curve is only a constant: A5 may use it or inline its baseline. Requiring it
 * deadlocked A5 against checkCurvesOnRoots in a live run (flat complaint_prob on a downstream param).
 */
export function checkCurveCoverage(scenario: unknown, story: Pick<StoryPlan, "curves">): CompileError[] {
  const used = new Set<string>();
  collectCurveRefs(scenario, used);
  return story.curves
    .filter((c) => c.segments.length > 0 && !used.has(c.id))
    .map((c) => ({
      path: `curves.${c.id}`,
      message: `Curve "${c.id}" from 04_story is not used. Reference it as {"curve": "${c.id}"} in the Param it drives (an arrival rate or a bernoulli p in entities/processes).`,
    }));
}

function collectCurveRefs(node: unknown, used: Set<string>, key?: string): void {
  // the scenario's own curve list defines curves, it does not use them
  if (key === "curves") return;
  if (Array.isArray(node)) {
    for (const n of node) collectCurveRefs(n, used);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const rec = node as Record<string, unknown>;
  if (typeof rec.curve === "string") used.add(rec.curve);
  for (const [k, v] of Object.entries(rec)) collectCurveRefs(v, used, k);
}

type ModelTables = Pick<DataModel, "entities" | "flows" | "processes">;

/** Table name -> visibility of every table the model writes (entities, processes, outcomes, snapshots). */
export function modelTables(model: ModelTables): Map<string, "observed" | "ground_truth"> {
  const tables = new Map<string, "observed" | "ground_truth">();
  const add = (name: string, visibility?: "observed" | "ground_truth") => {
    // several processes may write one table; ground_truth on any of them hides it
    if (tables.get(name) !== "ground_truth") tables.set(name, visibility ?? "observed");
  };
  for (const e of model.entities) add(e.name, e.visibility);
  for (const f of model.flows) if (f.snapshot) add(f.snapshot.table, f.snapshot.visibility);
  for (const p of model.processes) {
    if (p.type === "branch") {
      if (p.then) add(p.then.table, p.then.visibility);
      if (p.else) add(p.else.table, p.else.visibility);
    } else add(p.table, p.visibility);
  }
  return tables;
}

export function observedTables(model: ModelTables): string[] {
  return [...modelTables(model)].filter(([, v]) => v === "observed").map(([t]) => t);
}

/**
 * Expectation SQL runs on the sandbox, which holds only observed tables (schema main). A real run
 * built every expectation on a ground_truth table, so all of them failed with "table does not exist".
 */
export function checkExpectationTables(
  expectations: readonly Pick<StoryPlan["expectations"][number], "id" | "sql">[],
  model: ModelTables,
): CompileError[] {
  const tables = modelTables(model);
  const observed = observedTables(model).join(", ");
  const errors: CompileError[] = [];
  for (const [i, e] of expectations.entries()) {
    for (const t of sqlTables(e.sql)) {
      const v = tables.get(t);
      if (v === "observed") continue;
      errors.push({
        path: `expectations.${i}.sql`,
        message:
          v === "ground_truth"
            ? `Expectation "${e.id}" reads "${t}", a ground_truth table that is not in the evidence database. Use only observed tables: ${observed}.`
            : `Expectation "${e.id}" reads unknown table "${t}". Use only observed tables: ${observed}.`,
      });
    }
  }
  return errors;
}

/**
 * Internal references of 04_story. A5 copies curves, story points and expectations verbatim and may
 * not change them, so a broken reference must go back to A4, not surface as an unfixable A5 error.
 */
export function checkStoryPlan(story: StoryPlan): CompileError[] {
  const errors: CompileError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const points = story.storyPoints.map((p) => p.id);
  const defined = `Defined story points: ${points.map((p) => `"${p}"`).join(", ")}.`;
  const dupes = (kind: string, path: string, ids: string[]) => {
    ids.forEach((id, i) => {
      if (ids.indexOf(id) !== i) err(`${path}.${i}.id`, `Duplicate ${kind} id "${id}"; ids must be unique.`);
    });
  };
  dupes("story point", "storyPoints", points);
  dupes(
    "curve",
    "curves",
    story.curves.map((c) => c.id),
  );
  dupes(
    "expectation",
    "expectations",
    story.expectations.map((e) => e.id),
  );
  story.storyPoints.forEach((p, i) => {
    if (p.end !== undefined && p.end < p.start)
      err(`storyPoints.${i}.end`, `end (${p.end}) must be on or after start (${p.start}).`);
  });
  story.curves.forEach((c, i) => {
    c.segments.forEach((seg, j) => {
      const at = `curves.${i}.segments.${j}`;
      if (!points.includes(seg.storyPointId))
        err(`${at}.storyPointId`, `Unknown story point "${seg.storyPointId}". ${defined}`);
      if (seg.end !== undefined && seg.end <= seg.start)
        err(`${at}.end`, `end (${seg.end}) must be after start (${seg.start}).`);
    });
  });
  story.expectations.forEach((e, i) => {
    if (!points.includes(e.storyPointId))
      err(`expectations.${i}.storyPointId`, `Unknown story point "${e.storyPointId}". ${defined}`);
    if (!/\bperiod\b/i.test(e.sql) || !/\bvalue\b/i.test(e.sql))
      err(`expectations.${i}.sql`, "SQL must return columns `period` ('before'|'after') and `value` DOUBLE.");
    if (/\btruth\./i.test(e.sql))
      err(`expectations.${i}.sql`, "Expectations may read only schema main, not truth.");
  });
  return errors;
}

type EntityIds = Pick<EntityDef, "name" | "count" | "idPrefix">;

/** `<idPrefix>-001` .. `<idPrefix>-<count>`, as the engine numbers entity rows. */
const entityId = (e: EntityIds, n: number) => `${e.idPrefix}-${String(n).padStart(3, "0")}`;
const idRange = (e: EntityIds) =>
  `${entityId(e, 1)}..${entityId(e, e.count)} (count ${e.count}, idPrefix ${e.idPrefix})`;
const hasId = (e: EntityIds, id: string) => {
  const m = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(id);
  const n = Number(m?.[2]);
  return m?.[1] === e.idPrefix && n >= 1 && n <= e.count && id === entityId(e, n);
};

/**
 * Entity ids named by 04_story (story point entities, curve scopes like SUP-002) must exist in the
 * entities. A5 may change count or idPrefix; a scope id that no row has silently disables the curve.
 * Scope ids that do not look like entity ids (e.g. category values) are not checked.
 */
export function checkEntityIds(
  story: Pick<StoryPlan, "storyPoints" | "curves">,
  entities: readonly EntityIds[],
): CompileError[] {
  const errors: CompileError[] = [];
  const names = entities.map((e) => `"${e.name}"`).join(", ");
  story.storyPoints.forEach((p, i) => {
    if (!p.entity) return;
    const e = entities.find((x) => x.name === p.entity?.name);
    if (!e) {
      errors.push({
        path: `storyPoints.${i}.entity.name`,
        message: `Story point "${p.id}" names unknown entity "${p.entity.name}". Entities: ${names}.`,
      });
      return;
    }
    p.entity.ids.forEach((id, j) => {
      if (!hasId(e, id))
        errors.push({
          path: `storyPoints.${i}.entity.ids.${j}`,
          message: `Story point "${p.id}" names "${id}", but entity "${e.name}" has ids ${idRange(e)}. Keep count and idPrefix so the id exists, or use an existing id.`,
        });
    });
  });
  story.curves.forEach((c, i) => {
    c.scope?.ids.forEach((id, j) => {
      const prefix = /^([A-Z][A-Z0-9]*)-\d+$/.exec(id)?.[1];
      if (prefix === undefined) return;
      const e = entities.find((x) => x.idPrefix === prefix);
      if (e && hasId(e, id)) return;
      errors.push({
        path: `curves.${i}.scope.ids.${j}`,
        message: e
          ? `Curve "${c.id}" is scoped to "${id}", but entity "${e.name}" has ids ${idRange(e)}; the curve would never apply. Keep count and idPrefix so the id exists.`
          : `Curve "${c.id}" is scoped to "${id}", but no entity has idPrefix "${prefix}"; the curve would never apply. Entities: ${entities.map((x) => `${x.name} (${x.idPrefix})`).join(", ")}.`,
      });
    });
  });
  return errors;
}

/** Words that end a FROM list item instead of being its alias. */
const NOT_ALIAS = new Set(
  "where group order limit having union intersect except join left right inner full cross natural on using qualify window as select".split(
    " ",
  ),
);

/**
 * Table names after FROM / JOIN (including comma lists: `FROM a, b x`), minus CTE names and
 * table functions like generate_series(...). Good enough for LLM-written evidence SQL.
 */
export function sqlTables(sql: string): string[] {
  // CTE names: "name AS (" or "name(col, ...) AS ("
  const ctes = new Set(
    [...sql.matchAll(/\b([a-z_][a-z0-9_]*)\s*(?:\([^()]*\))?\s+as\s*\(/gi)].map((m) =>
      (m[1] ?? "").toLowerCase(),
    ),
  );
  const refs: string[] = [];
  for (const m of sql.matchAll(/\b(?:from|join)\b/gi)) {
    // EXTRACT(day FROM date), TRIM(x FROM y), SUBSTRING(s FROM 2): FROM inside a function call
    if (/\b(?:extract|trim|substring|overlay|position)\s*\([^()]*$/i.test(sql.slice(0, m.index))) continue;
    refs.push(...fromList(sql, m.index + m[0].length));
  }
  return [...new Set(refs.filter((t) => !ctes.has(t)))];
}

/** Tables of one FROM/JOIN list starting at `pos`: `[main.]"?name"? [[AS] alias] [, ...]`. */
function fromList(sql: string, pos: number): string[] {
  const item = /\s*(?:main\.)?"?([a-z_][a-z0-9_]*)"?/iy;
  const alias = /\s+(?:as\s+)?([a-z_][a-z0-9_]*)/iy;
  const out: string[] = [];
  for (;;) {
    item.lastIndex = pos;
    const m = item.exec(sql);
    if (!m) return out; // subquery "(SELECT ...)" or end of text
    pos = item.lastIndex;
    const name = (m[1] ?? "").toLowerCase();
    if (!/^\s*\(/.test(sql.slice(pos))) out.push(name); // name(...) is a table function
    alias.lastIndex = pos;
    const a = alias.exec(sql);
    if (a && !NOT_ALIAS.has((a[1] ?? "").toLowerCase())) pos = alias.lastIndex;
    const comma = /\s*,/y;
    comma.lastIndex = pos;
    if (!comma.test(sql)) return out;
    pos = comma.lastIndex;
  }
}

// ---------- 03_influences: endpoint names and roots (docs/cascade-design.md, variant C) ----------

/** Top-level process keys an influence edge may target: `<process_id>.<key>`. */
const PROCESS_PARAMS = ["rate", "p", "cond", "lag", "effects", "schedule"] as const;

/**
 * Every name an influence edge endpoint may use (A3 prompt): `<process_id>`, `<process_id>.<param>`
 * (rate, p, cond, a field of the record or of a branch outcome), `<table>`, `<entity>.<field>`,
 * `<flow_id>`.
 */
export function influenceNames(model: ModelTables): Set<string> {
  const names = new Set<string>(modelTables(model).keys());
  for (const e of model.entities) for (const f of Object.keys(e.fields)) names.add(`${e.name}.${f}`);
  for (const f of model.flows) names.add(f.id);
  for (const p of model.processes) {
    names.add(p.id);
    for (const k of PROCESS_PARAMS) if (k in p) names.add(`${p.id}.${k}`);
    const fields =
      p.type === "branch" ? { ...p.then?.fields, ...p.else?.fields } : (p.fields as Record<string, unknown>);
    for (const f of Object.keys(fields)) names.add(`${p.id}.${f}`);
  }
  return names;
}

type InfluenceEdges = { edges: { from: string; to: string }[] };

/** A3 edges must name existing parts of 02_model, otherwise the map is decoration nobody can check. */
export function checkInfluenceRefs(influences: InfluenceEdges, model: ModelTables): CompileError[] {
  const names = influenceNames(model);
  const valid = [...names].sort().join(", ");
  const errors: CompileError[] = [];
  influences.edges.forEach((e, i) => {
    for (const end of ["from", "to"] as const) {
      if (names.has(e[end])) continue;
      errors.push({
        path: `edges.${i}.${end}`,
        message: `"${e[end]}" is not part of 02_model. Use <process_id>, <process_id>.<param or field>, <table>, <entity>.<field> or <flow_id>. Valid names: ${valid}.`,
      });
    }
  });
  return errors;
}

/** Where a `{curve}` Param sits, as an influence name (`<process_id>.<field|param>`, `<entity>.<field>`). */
export function curveParamRefs(scenario: unknown): { curve: string; ref: string; path: string }[] {
  const out: { curve: string; ref: string; path: string }[] = [];
  // `ref` = owner.<param or field>, fixed by the first key below the owner (or below its "fields")
  const walk = (node: unknown, path: string[], ref: string): void => {
    if (Array.isArray(node)) {
      node.forEach((n, i) => {
        walk(n, [...path, String(i)], ref);
      });
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const rec = node as Record<string, unknown>;
    if (typeof rec.curve === "string") {
      out.push({ curve: rec.curve, ref, path: path.join(".") });
      return;
    }
    for (const [k, v] of Object.entries(rec)) walk(v, [...path, k], ref);
  };
  const fields = (owner: string, f: unknown, path: string[]) => {
    for (const [k, v] of Object.entries((f ?? {}) as Record<string, unknown>))
      walk(v, [...path, k], `${owner}.${k}`);
  };
  const s = scenario as Record<string, Record<string, unknown>[] | undefined>;
  (s.entities ?? []).forEach((e, i) => {
    fields(String(e.name), e.fields, ["entities", String(i), "fields"]);
  });
  (s.flows ?? []).forEach((f, i) => {
    walk(f.initial, ["flows", String(i), "initial"], `${String(f.id)}.initial`);
  });
  (s.processes ?? []).forEach((p, i) => {
    const id = String(p.id);
    const at = ["processes", String(i)];
    for (const [k, v] of Object.entries(p)) {
      if (k === "fields") fields(id, v, [...at, k]);
      else if (k === "then" || k === "else") {
        const o = (v ?? {}) as Record<string, unknown>;
        fields(id, o.fields, [...at, k, "fields"]);
        walk(o.effects, [...at, k, "effects"], `${id}.effects`);
      } else walk(v, [...at, k], `${id}.${k}`);
    }
  });
  return out;
}

/**
 * AGENTS.md hard rule 3 in code: a curve may drive only a root of the influence map. A Param with an
 * incoming edge (or a derive/branch whose whole process has one) must emerge from the chain instead.
 */
export function checkCurvesOnRoots(
  scenario: Pick<Scenario, "processes"> & { curves?: Pick<Scenario["curves"][number], "id" | "segments">[] },
  influences: InfluenceEdges,
): CompileError[] {
  // a flat curve (no segments) never moves: it is a constant, not a story lever
  const flat = new Set((scenario.curves ?? []).filter((c) => c.segments.length === 0).map((c) => c.id));
  const incoming = new Map<string, string[]>();
  for (const e of influences.edges) incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);
  /** Roots of the influence map reachable backwards from `nodes` (where a story curve may go instead). */
  const rootsAbove = (nodes: string[]): string[] => {
    const roots = new Set<string>();
    const seen = new Set<string>();
    const walk = (n: string) => {
      if (seen.has(n)) return;
      seen.add(n);
      const up = incoming.get(n) ?? [];
      if (up.length === 0) roots.add(n);
      up.forEach(walk);
    };
    nodes.forEach(walk);
    return [...roots];
  };
  const chained = new Set(scenario.processes.filter((p) => p.type !== "arrival").map((p) => p.id));
  const errors: CompileError[] = [];
  for (const { curve, ref, path } of curveParamRefs(scenario)) {
    if (flat.has(curve)) continue;
    const owner = ref.split(".")[0] ?? "";
    // an edge from the owning process to its own field (delivery -> delivery.is_late) is structure, not a cause
    const from = [
      ...(incoming.get(ref) ?? []),
      ...(chained.has(owner) ? (incoming.get(owner) ?? []) : []),
    ].filter((f) => f !== owner && !f.startsWith(`${owner}.`));
    if (from.length === 0) continue;
    errors.push({
      path,
      message: `Curve "${curve}" drives ${ref}, which 03_influences explains by ${from.join(", ")}. Curves may drive only root parameters (no incoming edge); make ${ref} a constant so the effect emerges through the chain, and move the curve to a root parameter upstream of it: ${rootsAbove(from).join(", ") || "a node of 03_influences with no incoming edge"}.`,
    });
  }
  return errors;
}

/**
 * A curve whose segments belong to a story point about specific entities (e.g. supplier SUP-002)
 * must be scoped to those ids. A live v1 run turned "one supplier is late" into late deliveries for
 * every supplier, which also made the whole-company expectations meaningless.
 */
export function checkCurveScopes(
  story: Pick<StoryPlan, "storyPoints" | "curves">,
  entities: readonly EntityIds[] = [],
): CompileError[] {
  const errors: CompileError[] = [];
  // naming EVERY row of an entity (all 3 suppliers) is not specific: a live run did that to pass the scope rule
  const everyRow = (ids: readonly string[]) => {
    const prefix = /^([A-Z][A-Z0-9]*)-\d+$/.exec(ids[0] ?? "")?.[1];
    const e = entities.find((x) => x.idPrefix === prefix);
    return e &&
      e.count > 1 &&
      Array.from({ length: e.count }, (_, n) => entityId(e, n + 1)).every((id) => ids.includes(id))
      ? e
      : undefined;
  };
  story.storyPoints.forEach((p, i) => {
    const e = p.entity && everyRow(p.entity.ids);
    if (e)
      errors.push({
        path: `storyPoints.${i}.entity.ids`,
        message: `Story point "${p.id}" names every ${e.name} (${p.entity?.ids.join(", ")}). Name only the ${e.name}(s) the story is about (e.g. the one late supplier), so the effect has a place and a control.`,
      });
  });
  story.curves.forEach((c, i) => {
    const e = c.scope && everyRow(c.scope.ids);
    if (e)
      errors.push({
        path: `curves.${i}.scope.ids`,
        message: `Curve "${c.id}" is scoped to every ${e.name}, which is the same as no scope. Scope it to the ${e.name}(s) the story is about.`,
      });
  });
  story.curves.forEach((c, i) => {
    if (c.scope) return;
    const sp = c.segments
      .map((g) => story.storyPoints.find((p) => p.id === g.storyPointId))
      .find((p) => p?.entity && p.entity.ids.length > 0);
    if (!sp?.entity) return;
    errors.push({
      path: `curves.${i}.scope`,
      message: `Curve "${c.id}" moves story point "${sp.id}", which is about ${sp.entity.name} ${sp.entity.ids.join(", ")}, but has no scope, so it would change every ${sp.entity.name}. Add "scope": {"field": "self.<${sp.entity.name}>_id", "ids": ${JSON.stringify(sp.entity.ids)}} (the record field that holds the ${sp.entity.name} id).`,
    });
  });
  return errors;
}
