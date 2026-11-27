"use client";

import type { ComponentType } from "react";
import type { ComponentNode } from "../../lib/a2ui/protocol";
import { toText } from "../../lib/format";
import { SurfaceProvider, useChildren, useSurface } from "./context";

export type NodeProps = { node: ComponentNode };
export type Registry = Readonly<Record<string, ComponentType<NodeProps>>>;

/** One node by id. Missing ids render a placeholder: components may stream in later (A2UI progressive rendering). */
export function Node({ id }: { id: string }) {
  const { surface, registry } = useSurface();
  const node = surface.components[id];
  if (!node) return <div className="a2-placeholder" aria-hidden="true" />;
  const Impl = registry[node.component];
  if (!Impl) return <p className="a2-unknown">Neznámá komponenta {node.component}</p>;
  return <Impl node={node} />;
}

/** Children of a container, with template scope applied per item. */
export function Children({ node }: NodeProps) {
  const ctx = useSurface();
  const items = useChildren(node.children);
  return (
    <>
      {items.map((item) =>
        item.scope === ctx.scope ? (
          <Node key={item.key} id={item.id} />
        ) : (
          <SurfaceProvider key={item.key} value={{ ...ctx, scope: item.scope }}>
            <Node id={item.id} />
          </SurfaceProvider>
        ),
      )}
    </>
  );
}

/** Text of a string prop (literal or bound). */
export const str = toText;
