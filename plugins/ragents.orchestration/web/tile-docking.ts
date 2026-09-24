import type { CanvasTileNode } from "../tiled-layout";

export const CANVAS_TILE_DRAG_TYPE = "application/x-ragents-canvas-tile";
export const TILE_DIVIDER_SIZE = 8;
export const TILE_MIN_WIDTH = 220;
export const TILE_MIN_HEIGHT = 160;
export type TileDockSide = "left" | "right" | "top" | "bottom";
export interface TileRect { left: number; top: number; width: number; height: number }
export interface TileDivider extends TileRect {
  path: readonly number[];
  direction: "horizontal" | "vertical";
  ratio: number;
  minimum: number;
  maximum: number;
  span: number;
}

export function tileEntities(root: CanvasTileNode | null): string[] {
  return root === null ? [] : "entity" in root ? [root.entity] : root.children.flatMap(tileEntities);
}

function tileLeaf(root: CanvasTileNode | null, entity: string): CanvasTileNode | undefined {
  if (root === null) return undefined;
  if ("entity" in root) return root.entity === entity ? root : undefined;
  return tileLeaf(root.children[0], entity) ?? tileLeaf(root.children[1], entity);
}

export function removeTile(root: CanvasTileNode | null, entity: string): CanvasTileNode | null {
  if (root === null || "entity" in root) return root?.entity === entity ? null : root;
  const first = removeTile(root.children[0], entity);
  const second = removeTile(root.children[1], entity);
  if (!first) return second;
  if (!second) return first;
  return first === root.children[0] && second === root.children[1] ? root : { ...root, children: [first, second] };
}

export function dockTile(root: CanvasTileNode | null, entity: string, target: string | null, side: TileDockSide): CanvasTileNode | null {
  if ((root && "entity" in root && root.entity === entity && target === null) || entity === target || (target !== null && !tileEntities(root).includes(target))) return root;
  const remaining = removeTile(root, entity);
  const leaf: CanvasTileNode = tileLeaf(root, entity) ?? { entity };
  if (!remaining) return leaf;
  const wrap = (node: CanvasTileNode): CanvasTileNode => ({
    direction: side === "left" || side === "right" ? "horizontal" : "vertical",
    weights: [1, 1],
    children: side === "left" || side === "top" ? [leaf, node] : [node, leaf],
  });
  if (target === null) return wrap(remaining);
  const insert = (node: CanvasTileNode): CanvasTileNode => "entity" in node
    ? node.entity === target ? wrap(node) : node
    : { ...node, children: [insert(node.children[0]), insert(node.children[1])] };
  return insert(remaining);
}

export function tileMinimum(root: CanvasTileNode): { width: number; height: number } {
  if ("entity" in root) return { width: TILE_MIN_WIDTH, height: TILE_MIN_HEIGHT };
  const first = tileMinimum(root.children[0]);
  const second = tileMinimum(root.children[1]);
  return root.direction === "horizontal"
    ? { width: first.width + second.width + TILE_DIVIDER_SIZE, height: Math.max(first.height, second.height) }
    : { width: Math.max(first.width, second.width), height: first.height + second.height + TILE_DIVIDER_SIZE };
}

export function resizeTile(root: CanvasTileNode, path: readonly number[], ratio: number): CanvasTileNode {
  if ("entity" in root) return root;
  if (path.length === 0) {
    const bounded = Math.max(0.001, Math.min(0.999, ratio));
    return { ...root, weights: [bounded, 1 - bounded] };
  }
  const branch = path[0];
  if (branch !== 0 && branch !== 1) return root;
  const children: [CanvasTileNode, CanvasTileNode] = [...root.children];
  children[branch] = resizeTile(children[branch], path.slice(1), ratio);
  return { ...root, children };
}

export function tileGeometry(root: CanvasTileNode, bounds: TileRect): { leaves: Map<string, TileRect>; dividers: TileDivider[] } {
  const leaves = new Map<string, TileRect>();
  const dividers: TileDivider[] = [];
  const visit = (node: CanvasTileNode, rect: TileRect, path: readonly number[]) => {
    if ("entity" in node) { leaves.set(node.entity, rect); return; }
    const horizontal = node.direction === "horizontal";
    const span = Math.max(0, (horizontal ? rect.width : rect.height) - TILE_DIVIDER_SIZE);
    const firstMinimum = tileMinimum(node.children[0]);
    const secondMinimum = tileMinimum(node.children[1]);
    const minimum = span > 0 ? (horizontal ? firstMinimum.width : firstMinimum.height) / span : 0.5;
    const maximum = span > 0 ? 1 - (horizontal ? secondMinimum.width : secondMinimum.height) / span : 0.5;
    const scale = Math.max(...node.weights);
    const firstWeight = node.weights[0] / scale;
    const requested = firstWeight / (firstWeight + node.weights[1] / scale);
    const ratio = minimum <= maximum ? Math.max(minimum, Math.min(maximum, requested)) : requested;
    const first = span * ratio;
    dividers.push({
      left: rect.left + (horizontal ? first : 0), top: rect.top + (horizontal ? 0 : first),
      width: horizontal ? TILE_DIVIDER_SIZE : rect.width, height: horizontal ? rect.height : TILE_DIVIDER_SIZE,
      path, direction: node.direction, ratio, minimum, maximum, span,
    });
    visit(node.children[0], { ...rect, width: horizontal ? first : rect.width, height: horizontal ? rect.height : first }, [...path, 0]);
    visit(node.children[1], {
      left: rect.left + (horizontal ? first + TILE_DIVIDER_SIZE : 0), top: rect.top + (horizontal ? 0 : first + TILE_DIVIDER_SIZE),
      width: horizontal ? span - first : rect.width, height: horizontal ? rect.height : span - first,
    }, [...path, 1]);
  };
  visit(root, bounds, []);
  return { leaves, dividers };
}
