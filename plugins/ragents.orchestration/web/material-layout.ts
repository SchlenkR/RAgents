import type { SceneNode } from "./canvas-layout";

export function withMaterialSpacing(node: SceneNode, depth: number): SceneNode {
  if (node.kind === "leaf") return node;
  const horizontal = depth * .5 + 32, vertical = depth * .7 + 32;
  const layout = node.layout;
  const next = layout.type === "tree" ? {
    ...layout,
    rankGap: Math.max(layout.rankGap, layout.direction === "right" ? horizontal : vertical),
    siblingGap: Math.max(layout.siblingGap, layout.direction === "right" ? vertical : horizontal),
  } : { ...layout, gap: Math.max(layout.gap,
    layout.type === "stack" ? layout.axis === "h" ? horizontal : vertical : Math.max(horizontal, vertical)) };
  return { ...node, layout: next, children: node.children.map((child) => withMaterialSpacing(child, depth)) };
}
