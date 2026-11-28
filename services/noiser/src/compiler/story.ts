/**
 * Static checks that the story can actually reach the data and be scored (live run 2026-11-27: a curve
 * scoped by `day` silently stayed at its baseline, and story points without an entity scored recall 0).
 * Needs only entities, curves and story points, so cascade A4 runs it before A5 exists.
 */
import type { CompileError } from "@s2d/schema/api";
import type { Scenario } from "@s2d/schema/scenario";

type StoryRefs = Pick<Scenario, "entities" | "curves" | "storyPoints">;

const ENTITY_ID = /^([A-Z][A-Z0-9]*)-(\d+)$/;

/** Same format as the engine (`engine/entities.ts`): `<idPrefix>-001`. */
export const entityId = (prefix: string, n: number) => `${prefix}-${String(n).padStart(3, "0")}`;

function idRange(e: StoryRefs["entities"][number]): string {
  return e.count === 1
    ? `"${entityId(e.idPrefix, 1)}"`
    : `"${entityId(e.idPrefix, 1)}".."${entityId(e.idPrefix, e.count)}"`;
}

/** `null` = valid entity id or not entity-shaped (e.g. a category value); otherwise what is wrong. */
function badEntityId(entities: StoryRefs["entities"], id: string): string | null {
  const m = ENTITY_ID.exec(id);
  if (!m) return null;
  const e = entities.find((x) => x.idPrefix === m[1]);
  const prefixes = entities.map((x) => `${x.idPrefix} (${x.name}: ${idRange(x)})`).join(", ");
  if (!e)
    return `"${id}" looks like an entity id, but no entity has prefix "${m[1]}". Entities: ${prefixes}.`;
  const n = Number(m[2]);
  if (n < 1 || n > e.count || id !== entityId(e.idPrefix, n)) {
    return `"${id}" is not an id of entity "${e.name}". Valid ids: ${idRange(e)}.`;
  }
  return null;
}

/**
 * Deterministic completion of what a story point's curve already says: a point that drives a scoped
 * curve but names neither entity nor segment (e.g. one the user added in the curve editor) gets the
 * curve's scope — entity ids → `entity`, category values → `segment`. Nothing is invented; points
 * that already name one, drive no curve or drive an unscoped curve are returned unchanged.
 */
export function fillStoryEntities(s: StoryRefs): StoryRefs["storyPoints"] {
  return s.storyPoints.map((sp) => {
    if (sp.entity || sp.segment) return sp;
    const curve = s.curves.find(
      (c) =>
        c.scope &&
        c.scope.field !== "day" &&
        c.scope.ids.length > 0 &&
        c.segments.some((seg) => seg.storyPointId === sp.id),
    );
    const scope = curve?.scope;
    if (!scope) return sp;
    if (scope.ids.every((id) => !ENTITY_ID.test(id)))
      return { ...sp, segment: { field: scope.field, values: [...scope.ids] } };
    const prefix = scope.ids.map((id) => ENTITY_ID.exec(id)?.[1]).find(Boolean);
    const entity = s.entities.find((e) => e.idPrefix === prefix);
    if (!entity) return sp;
    const ids = scope.ids.filter((id) => ENTITY_ID.exec(id)?.[1] === prefix);
    return { ...sp, entity: { name: entity.name, ids } };
  });
}

/** `<entity>.<field>: [values]` for every categorical entity field: the groups a story point can name. */
export function categoryFields(entities: StoryRefs["entities"]): string[] {
  return entities.flatMap((e) =>
    Object.entries(e.fields).flatMap(([field, gen]) =>
      gen.gen === "categorical" ? [`${e.name}.${field}: ${JSON.stringify(gen.values)}`] : [],
    ),
  );
}

export function checkStoryRefs(s: StoryRefs): CompileError[] {
  const errors: CompileError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });

  s.curves.forEach((c, i) => {
    if (!c.scope) return;
    if (c.scope.field === "day") {
      err(
        `curves[${i}].scope.field`,
        `Curve "${c.id}" is scoped by "day", which never equals an id, so the curve would stay at its baseline. scope.field must be the record field holding the ids it targets: "self.<field>" (e.g. "self.supplier_id"), "source.<field>" or "key.<entity>".`,
      );
    }
    c.scope.ids.forEach((id, j) => {
      const bad = badEntityId(s.entities, id);
      if (bad) err(`curves[${i}].scope.ids[${j}]`, `Curve "${c.id}": ${bad}`);
    });
  });

  // a story point that drives a curve segment is a cause the detective must name: it needs an entity
  const scopeOf = new Map<string, string[]>();
  for (const c of s.curves)
    for (const seg of c.segments) if (c.scope) scopeOf.set(seg.storyPointId, c.scope.ids);
  const drivers = new Set(s.curves.flatMap((c) => c.segments.map((seg) => seg.storyPointId)));
  const names = s.entities.map((e) => `"${e.name}"`).join(", ");

  s.storyPoints.forEach((sp, i) => {
    // a curve scoped by category values (segment "kampaň") is about a group, not entity rows (live run 3:
    // A4 invented CUS-001..005 for "campaign customers", so the detective's correct finding scored 0)
    const groupScope = s.curves.find(
      (c) =>
        c.scope &&
        c.scope.field !== "day" &&
        c.scope.ids.length > 0 &&
        c.scope.ids.every((id) => !ENTITY_ID.test(id)) &&
        c.segments.some((seg) => seg.storyPointId === sp.id),
    )?.scope;
    if (groupScope) {
      const hint = `"segment": {"field": "${groupScope.field}", "values": ${JSON.stringify(groupScope.ids)}}`;
      if (!sp.segment) {
        err(
          `storyPoints[${i}].segment`,
          `Story point "${sp.id}" drives a curve scoped to the category values ${JSON.stringify(groupScope.ids)}, so it is about that group of records, not about entity ids. Add ${hint} (entity is then optional; never invent entity ids for a group).`,
        );
        return;
      }
      sp.segment.values.forEach((v, j) => {
        if (!groupScope.ids.includes(v))
          err(
            `storyPoints[${i}].segment.values[${j}]`,
            `Segment value "${v}" of story point "${sp.id}" is not used by its curve scope ${JSON.stringify(groupScope.ids)}; use those values: ${hint}.`,
          );
      });
      if (!sp.entity) return;
    }
    const at = `storyPoints[${i}].entity`;
    if (!sp.entity) {
      if (sp.segment) return;
      if (!drivers.has(sp.id)) return;
      const ids = scopeOf.get(sp.id);
      const owner = ids?.map((id) => ENTITY_ID.exec(id)?.[1]).find(Boolean);
      const entity = s.entities.find((e) => e.idPrefix === owner);
      if (entity && ids) {
        err(
          at,
          `Story point "${sp.id}" drives a curve but names no entity, so a detective finding can never match it. Add "entity": e.g. {"name": "${entity.name}", "ids": ${JSON.stringify(ids)}} (the ids its curve is scoped to).`,
        );
        return;
      }
      // unscoped curve: the point may be about a group (a product category, a customer segment) rather
      // than entity rows (user run: "sport shoes trend" oscillated between no entity and every supplier)
      const groups = categoryFields(s.entities);
      const segmentHint = groups.length
        ? ` If it is about a group of records rather than specific rows (e.g. a product category or customer segment), add "segment": {"field": "<entity>.<field>", "values": [the affected values]} instead, using one of: ${groups.join("; ")}. Never name every row of an entity.`
        : "";
      err(
        at,
        `Story point "${sp.id}" drives a curve but names neither an entity nor a segment, so a detective finding can never match it. Add "entity": {"name": <one of ${names}>, "ids": [the affected ids]}.${segmentHint}`,
      );
      return;
    }
    const entity = s.entities.find((e) => e.name === sp.entity?.name);
    if (!entity) {
      err(`${at}.name`, `Unknown entity "${sp.entity.name}". Use one of ${names}.`);
      return;
    }
    if (sp.entity.ids.length === 0) {
      err(
        `${at}.ids`,
        `Story point "${sp.id}" needs at least one id of "${entity.name}" (${idRange(entity)}).`,
      );
    }
    sp.entity.ids.forEach((id, j) => {
      const bad =
        badEntityId([entity], id) ??
        (ENTITY_ID.test(id)
          ? null
          : `"${id}" is not an id of "${entity.name}". Valid ids: ${idRange(entity)}.`);
      if (bad) err(`${at}.ids[${j}]`, bad);
    });
  });
  return errors;
}
