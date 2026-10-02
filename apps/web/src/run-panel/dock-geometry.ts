import { dockGroups, type DockGroup, type DockNode, type DockSide, type DockSplit, type DockTarget } from "./dock-state";

export interface DockRect { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
export interface DockPoint { readonly x: number; readonly y: number }
export interface GroupRect { readonly group: DockGroup; readonly rect: DockRect }
export interface DividerRect { readonly split: DockSplit; readonly rect: DockRect; readonly parent: DockRect }
export interface DockGuide { readonly target: DockTarget; readonly rect: DockRect; readonly label: string }
export const DOCK_HEADER_HEIGHT = 30;
export const DOCK_DIVIDER_SIZE = 6;
export const containsPoint = (rect: DockRect, point: DockPoint) => point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;

export function dockGeometry(root: DockNode, rect: DockRect, maximized: string | null) {
  const groups: GroupRect[] = [];
  const dividers: DividerRect[] = [];
  const visit = (node: DockNode, bounds: DockRect) => {
    if (node.kind === "group") { groups.push({ group: node, rect: bounds }); return; }
    const horizontal = node.axis === "horizontal";
    const length = Math.max(0, (horizontal ? bounds.width : bounds.height) - DOCK_DIVIDER_SIZE);
    const first = length * node.ratio;
    const second = length - first;
    visit(node.first, { ...bounds, ...(horizontal ? { width: first } : { height: first }) });
    dividers.push({ split: node, parent: bounds, rect: { ...bounds, ...(horizontal
      ? { left: bounds.left + first, width: DOCK_DIVIDER_SIZE }
      : { top: bounds.top + first, height: DOCK_DIVIDER_SIZE }) } });
    visit(node.second, { ...bounds, ...(horizontal
      ? { left: bounds.left + first + DOCK_DIVIDER_SIZE, width: second }
      : { top: bounds.top + first + DOCK_DIVIDER_SIZE, height: second }) });
  };
  const max = dockGroups(root).find((g) => g.id === maximized);
  visit(max ?? root, rect);
  return { groups, dividers };
}

export function dockingGuides(workspace: DockRect, area?: GroupRect): readonly DockGuide[] {
  const size = 30;
  const gap = 4;
  const x = workspace.left + workspace.width / 2 - size / 2;
  const y = workspace.top + workspace.height / 2 - size / 2;
  const guide = (target: DockTarget, left: number, top: number, label: string): DockGuide => ({ target, rect: { left, top, width: size, height: size }, label });
  const edges: DockGuide[] = [
    guide({ kind: "edge", side: "left" }, workspace.left + gap, y, "Dock at workspace left"),
    guide({ kind: "edge", side: "right" }, workspace.left + workspace.width - size - gap, y, "Dock at workspace right"),
    guide({ kind: "edge", side: "top" }, x, workspace.top + gap, "Dock at workspace top"),
    guide({ kind: "edge", side: "bottom" }, x, workspace.top + workspace.height - size - gap, "Dock at workspace bottom"),
  ];
  if (!area) return edges;
  const cx = area.rect.left + area.rect.width / 2 - size / 2;
  const cy = area.rect.top + area.rect.height / 2 - size / 2;
  return [...edges, ...([ ["left", -1, 0], ["right", 1, 0], ["top", 0, -1], ["bottom", 0, 1], ["center", 0, 0] ] as const)
    .map(([side, dx, dy]) => guide({ kind: "group", group: area.group.id, side }, cx + dx * (size + gap), cy + dy * (size + gap), side === "center" ? "Merge as tabs" : `Split area ${side}`))];
}

export function dockPreview(rect: DockRect, side: DockSide | "center", fraction: number): DockRect {
  if (side === "center") return rect;
  if (side === "left" || side === "right") return { ...rect, width: (rect.width - DOCK_DIVIDER_SIZE) * fraction, left: rect.left + (side === "right" ? rect.width - (rect.width - DOCK_DIVIDER_SIZE) * fraction : 0) };
  return { ...rect, height: (rect.height - DOCK_DIVIDER_SIZE) * fraction, top: rect.top + (side === "bottom" ? rect.height - (rect.height - DOCK_DIVIDER_SIZE) * fraction : 0) };
}

export function dockHitTest(point: DockPoint, workspace: DockRect, groups: readonly GroupRect[], bar: DockRect, toolsOnly: boolean) {
  const area = groups.find(({ rect }) => containsPoint(rect, point));
  const guides = dockingGuides(workspace, area);
  const target: DockTarget | undefined = toolsOnly && containsPoint(bar, point) ? { kind: "bar" }
    : guides.find(({ rect }) => containsPoint(rect, point))?.target
      ?? (area && point.y <= area.rect.top + DOCK_HEADER_HEIGHT ? { kind: "group", group: area.group.id, side: "center" } : undefined);
  const preview = target?.kind === "bar" ? bar
    : target?.kind === "edge" ? dockPreview(workspace, target.side, 0.35)
      : target?.kind === "group" && area ? dockPreview(area.rect, target.side, 0.5) : undefined;
  return { guides, target, preview };
}
