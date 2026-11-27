"use client";

import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { ComponentNode } from "../../lib/a2ui/protocol";
import { getAt, resolvePath } from "../../lib/a2ui/pointer";
import {
  isPathRef,
  type A2uiAction,
  type ActionEvent,
  type ChildList,
  type Dynamic,
} from "../../lib/a2ui/protocol";
import type { Surface, SurfaceStore } from "../../lib/a2ui/store";

export type ActionHandler = (action: A2uiAction) => void;

type Ctx = {
  surface: Surface;
  store: SurfaceStore;
  onAction: ActionHandler;
  scope: string;
  registry: Readonly<Record<string, ComponentType<{ node: ComponentNode }>>>;
};
const SurfaceCtx = createContext<Ctx | null>(null);

export function SurfaceProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <SurfaceCtx.Provider value={value}>{children}</SurfaceCtx.Provider>;
}

export function useSurface(): Ctx {
  const ctx = useContext(SurfaceCtx);
  if (!ctx) throw new Error("A2UI component rendered outside <A2uiSurface>");
  return ctx;
}

/** Resolves a literal or `{"@path"}` against the surface data model in the current template scope. */
export function useResolve() {
  const { surface, scope } = useSurface();
  return function resolve<T>(value: Dynamic<T> | undefined): T | undefined {
    if (isPathRef(value)) return getAt(surface.data, resolvePath(value["@path"], scope)) as T | undefined;
    return value;
  };
}

/** Two-way binding for inputs: [current value, setter writing back into the data model]. */
export function useBinding<T>(ref: unknown): [T | undefined, (value: T) => void] {
  const { surface, store, scope } = useSurface();
  if (!isPathRef(ref)) return [ref as T | undefined, () => undefined];
  const pointer = resolvePath(ref["@path"], scope);
  return [
    getAt(surface.data, pointer) as T | undefined,
    (v) => {
      store.write(surface.id, pointer, v);
    },
  ];
}

/** Builds the wire `action` with its context resolved, then hands it to the transport. */
export function useAction() {
  const { surface, onAction, scope } = useSurface();
  const resolve = useResolve();
  return (sourceComponentId: string, action: ActionEvent | undefined) => {
    if (!action) return;
    const context: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(action.event.context ?? {})) context[key] = resolve(value);
    if (scope) context.$scope = scope;
    onAction({
      name: action.event.name,
      surfaceId: surface.id,
      sourceComponentId,
      timestamp: new Date().toISOString(),
      context,
      ...(action.event.userMessage && { userMessage: action.event.userMessage }),
    });
  };
}

/** Expands a ChildList into (componentId, scope) pairs; templates repeat per array element. */
export function useChildren(children: ChildList | undefined): { id: string; scope: string; key: string }[] {
  const { surface, scope } = useSurface();
  if (!children) return [];
  if (Array.isArray(children)) return children.map((id) => ({ id, scope, key: id }));
  const base = resolvePath(children.path, scope);
  const items = getAt(surface.data, base);
  if (!Array.isArray(items)) return [];
  return items.map((_, i) => ({
    id: children.componentId,
    scope: `${base === "/" ? "" : base}/${String(i)}`,
    key: `${children.componentId}-${String(i)}`,
  }));
}
