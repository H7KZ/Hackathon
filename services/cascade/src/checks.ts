/**
 * Deterministic story checks (no engine, docs/cascade-design.md D5). compileScenario accepts a
 * scenario that is valid but carries no story; these catch that and go back to the agent as feedback.
 * A real Haiku run produced a single-process model with an unused late-delivery curve.
 */
import type { CompileError } from "@s2d/schema/api";
import type { DataModel, StoryPlan } from "@s2d/schema/artifacts";
import type { EntityDef } from "@s2d/schema/scenario";

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

/** Every curve planned in 04_story must drive some Param, otherwise its story point never shows. */
export function checkCurveCoverage(scenario: unknown, story: Pick<StoryPlan, "curves">): CompileError[] {
  const used = new Set<string>();
  collectCurveRefs(scenario, used);
  return story.curves
    .filter((c) => !used.has(c.id))
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
  expectations: Pick<StoryPlan, "expectations">["expectations"],
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
