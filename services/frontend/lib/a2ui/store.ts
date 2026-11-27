/**
 * Surface state: applies A2UI messages (pure reducer) and exposes a tiny external store for React.
 * Errors come back in the A2UI error format so a future agent loop can self-correct on them.
 */
import { getAt, setAt } from "./pointer";
import {
  JOJO_CATALOG_ID,
  type A2uiError,
  type A2uiMessage,
  type ComponentNode,
  type SurfaceMeta,
} from "./protocol";

export type Surface = {
  id: string;
  catalogId: string;
  meta: SurfaceMeta;
  sendDataModel: boolean;
  components: Readonly<Record<string, ComponentNode>>;
  data: Record<string, unknown>;
};

export type SurfaceState = { surfaces: Readonly<Record<string, Surface>>; order: readonly string[] };

export const emptyState: SurfaceState = { surfaces: {}, order: [] };

const byId = (list: ComponentNode[] = [], into: Record<string, ComponentNode> = {}) => {
  const next = { ...into };
  for (const node of list) next[node.id] = node;
  return next;
};

export function applyMessage(
  state: SurfaceState,
  msg: A2uiMessage,
): { state: SurfaceState; error?: A2uiError } {
  if ("createSurface" in msg) {
    const c = msg.createSurface;
    if (state.surfaces[c.surfaceId]) {
      return {
        state,
        error: {
          code: "INTEGRITY_ERROR",
          surfaceId: c.surfaceId,
          message: `Surface "${c.surfaceId}" already exists; send updateComponents, or deleteSurface first.`,
        },
      };
    }
    const surface: Surface = {
      id: c.surfaceId,
      catalogId: c.catalogId ?? JOJO_CATALOG_ID,
      meta: c.metadata ?? {},
      sendDataModel: c.sendDataModel ?? false,
      data: c.dataModel ?? {},
      components: byId(c.components),
    };
    return {
      state: {
        surfaces: { ...state.surfaces, [c.surfaceId]: surface },
        order: [...state.order, c.surfaceId],
      },
    };
  }
  const surfaceId =
    "updateComponents" in msg
      ? msg.updateComponents.surfaceId
      : "updateDataModel" in msg
        ? msg.updateDataModel.surfaceId
        : msg.deleteSurface.surfaceId;
  const surface = state.surfaces[surfaceId];
  if (!surface) {
    return {
      state,
      error: {
        code: "INTEGRITY_ERROR",
        surfaceId,
        message: `Unknown surface "${surfaceId}"; send createSurface first.`,
      },
    };
  }
  if ("deleteSurface" in msg) {
    const rest = { ...state.surfaces };
    Reflect.deleteProperty(rest, surfaceId);
    return { state: { surfaces: rest, order: state.order.filter((id) => id !== surfaceId) } };
  }
  const next: Surface =
    "updateComponents" in msg
      ? { ...surface, components: byId(msg.updateComponents.components, surface.components) }
      : {
          ...surface,
          data: setAt(
            surface.data,
            msg.updateDataModel.path ?? "/",
            msg.updateDataModel.value ?? undefined,
          ) as Record<string, unknown>,
        };
  return { state: { ...state, surfaces: { ...state.surfaces, [surfaceId]: next } } };
}

export type SurfaceStore = {
  getSnapshot: () => SurfaceState;
  subscribe: (listener: () => void) => () => void;
  apply: (msg: A2uiMessage) => A2uiError | undefined;
  /** Two-way binding: an input writes the user's value into its surface's data model. */
  write: (surfaceId: string, pointer: string, value: unknown) => void;
  read: (surfaceId: string, pointer: string) => unknown;
  reset: () => void;
};

export function createSurfaceStore(initial: SurfaceState = emptyState): SurfaceStore {
  let state = initial;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    apply(msg) {
      const result = applyMessage(state, msg);
      if (result.state !== state) {
        state = result.state;
        emit();
      }
      return result.error;
    },
    write(surfaceId, pointer, value) {
      const surface = state.surfaces[surfaceId];
      if (!surface) return;
      state = applyMessage(state, {
        version: "1.0",
        updateDataModel: { surfaceId, path: pointer, value },
      }).state;
      emit();
    },
    read: (surfaceId, pointer) => getAt(state.surfaces[surfaceId]?.data, pointer),
    reset() {
      state = emptyState;
      emit();
    },
  };
}
