/**
 * A2UI v1.0 message subset the JOJO renderer understands (docs/research/a2ui.md §2–§6).
 * Types only: when the API starts emitting A2UI, these move to `@s2d/schema/a2ui` as zod schemas
 * (needs the schema owner's approval, AGENTS.md) and this file re-exports the inferred types.
 */

export const A2UI_VERSION = "1.0";
/** Our catalog id (a string id, need not resolve). Components: lib/a2ui/catalog.ts. */
export const JOJO_CATALOG_ID = "https://jojo.vse.cz/a2ui/catalogs/jojo/v1/catalog.json";

/** `{"@path": "/abs"}` or `{"@path": "relative"}` inside a template. */
export type PathRef = { "@path": string };
export type Dynamic<T> = T | PathRef;

/** Static ids, or a template repeated once per element of the array at `path`. */
export type ChildList = string[] | { componentId: string; path: string };

export type ActionEvent = {
  event: { name: string; userMessage?: string; context?: Record<string, Dynamic<unknown>> };
};

/** One node of the flat adjacency list. Extra props depend on `component` (see catalog.ts). */
export type ComponentNode = {
  id: string;
  component: string;
  child?: string;
  children?: ChildList;
  weight?: number;
  [prop: string]: unknown;
};

/** Our use of `createSurface.metadata`: where the surface is shown and how it is titled. */
export type SurfaceMeta = { placement?: "chat" | "canvas"; title?: string; demo?: boolean };

export type CreateSurface = {
  surfaceId: string;
  catalogId?: string;
  sendDataModel?: boolean;
  components?: ComponentNode[];
  dataModel?: Record<string, unknown>;
  metadata?: SurfaceMeta;
};
export type UpdateComponents = { surfaceId: string; components: ComponentNode[] };
export type UpdateDataModel = { surfaceId: string; path?: string; value: unknown };
export type DeleteSurface = { surfaceId: string };

export type A2uiMessage =
  | { version: typeof A2UI_VERSION; createSurface: CreateSurface }
  | { version: typeof A2UI_VERSION; updateComponents: UpdateComponents }
  | { version: typeof A2UI_VERSION; updateDataModel: UpdateDataModel }
  | { version: typeof A2UI_VERSION; deleteSurface: DeleteSurface };

/** Renderer → agent. Bindings in `context` are already resolved against the data model. */
export type A2uiAction = {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
  userMessage?: string;
};

export type A2uiErrorCode = "VALIDATION_FAILED" | "INTEGRITY_ERROR" | "UNALLOWED_CHILD";
export type A2uiError = { code: A2uiErrorCode; surfaceId: string; path?: string; message: string };

export const isPathRef = (value: unknown): value is PathRef =>
  typeof value === "object" && value !== null && typeof (value as PathRef)["@path"] === "string";

const KINDS = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"] as const;

/** Cheap boundary check for messages arriving over the wire (full zod validation lands with the schema move). */
export function isA2uiMessage(value: unknown): value is A2uiMessage {
  if (typeof value !== "object" || value === null) return false;
  const msg = value as Record<string, unknown>;
  if (msg.version !== A2UI_VERSION) return false;
  const kinds = KINDS.filter((k) => k in msg);
  if (kinds.length !== 1) return false;
  const body = msg[kinds[0] as string] as { surfaceId?: unknown } | undefined;
  return typeof body?.surfaceId === "string";
}

/** Small constructors so presenters read like the wire format. */
export const a2ui = {
  create: (createSurface: CreateSurface): A2uiMessage => ({ version: A2UI_VERSION, createSurface }),
  components: (surfaceId: string, components: ComponentNode[]): A2uiMessage => ({
    version: A2UI_VERSION,
    updateComponents: { surfaceId, components },
  }),
  data: (surfaceId: string, path: string, value: unknown): A2uiMessage => ({
    version: A2UI_VERSION,
    updateDataModel: { surfaceId, path, value },
  }),
  remove: (surfaceId: string): A2uiMessage => ({ version: A2UI_VERSION, deleteSurface: { surfaceId } }),
};

export const path = (p: string): PathRef => ({ "@path": p });
