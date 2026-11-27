"use client";

import { useSyncExternalStore, type ComponentType } from "react";
import type { ComponentName } from "../../lib/a2ui/catalog";
import type { SurfaceStore } from "../../lib/a2ui/store";
import { SurfaceProvider, type ActionHandler } from "./context";
import { Node, type NodeProps, type Registry } from "./tree";
import { Card, Column, Divider, List, Row, Tabs } from "./layout";
import { Badge, Callout, Text } from "./content";
import { Button, ChoicePicker, Slider, TextField } from "./inputs";
import { Kpi, Table } from "./data";
import { BarChart, LineChart } from "./charts";
import { Steps, StoryTimeline } from "./story";

/** Catalog name → React implementation. Adding a component: catalog.ts COMPONENTS + here + docs/design/components.md. */
export const REGISTRY: Registry & Record<ComponentName, ComponentType<NodeProps>> = {
  Column,
  Row,
  Card,
  List,
  Tabs,
  Divider,
  Text,
  Badge,
  Callout,
  Button,
  TextField,
  Slider,
  ChoicePicker,
  Kpi,
  Table,
  LineChart,
  BarChart,
  Steps,
  StoryTimeline,
};

export function useStoreState(store: SurfaceStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Renders one A2UI surface from the store, starting at component "root". */
export function A2uiSurface({
  store,
  surfaceId,
  onAction,
}: {
  store: SurfaceStore;
  surfaceId: string;
  onAction: ActionHandler;
}) {
  const state = useStoreState(store);
  const surface = state.surfaces[surfaceId];
  if (!surface) return null;
  return (
    <SurfaceProvider value={{ surface, store, onAction, scope: "", registry: REGISTRY }}>
      <div className="a2-surface" data-surface={surfaceId}>
        <Node id="root" />
      </div>
    </SurfaceProvider>
  );
}
