/** RFC 6901 JSON Pointer helpers for the A2UI data model. Pure and immutable. */

const unescape = (token: string) => token.replace(/~1/g, "/").replace(/~0/g, "~");

export function tokens(pointer: string): string[] {
  if (pointer === "" || pointer === "/") return [];
  return pointer.replace(/^\//, "").split("/").map(unescape);
}

/** Absolute paths start with `/`; others are relative to `scope` (the current template item). */
export function resolvePath(path: string, scope = ""): string {
  if (path.startsWith("/")) return path;
  const base = scope === "/" ? "" : scope;
  return path === "" ? base || "/" : `${base}/${path}`;
}

export function getAt(model: unknown, pointer: string): unknown {
  let node: unknown = model;
  for (const token of tokens(pointer)) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[token];
  }
  return node;
}

/** Upsert (A2UI `updateDataModel` semantics): missing objects are created, `undefined` deletes. */
export function setAt(model: unknown, pointer: string, value: unknown): unknown {
  return setTokens(model, tokens(pointer), value);
}

function setTokens(model: unknown, path: string[], value: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  const container: Record<string, unknown> | unknown[] = Array.isArray(model)
    ? [...(model as unknown[])]
    : { ...(typeof model === "object" && model !== null ? (model as Record<string, unknown>) : {}) };
  const next = setTokens((container as Record<string, unknown>)[head], rest, value);
  if (next === undefined && !Array.isArray(container)) Reflect.deleteProperty(container, head);
  else (container as Record<string, unknown>)[head] = next;
  return container;
}
