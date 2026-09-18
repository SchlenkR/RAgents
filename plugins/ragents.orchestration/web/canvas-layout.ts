export interface SceneLeaf {
  kind: "leaf";
  key: string;
  width: number;
  height: number;
}

export type GroupLayout =
  | { type: "stack"; axis: "h" | "v"; gap: number }
  | { type: "wrap"; axis: "h" | "v"; limit: number; gap: number }
  | { type: "grid"; columns: number; gap: number }
  | { type: "circle"; gap: number }
  | { type: "tree"; direction: "right" | "down"; rankGap: number; siblingGap: number };

/** A frame is a caption above the members, an outline around them, or both. */
export interface SceneFrame {
  label?: string;
  outline: boolean;
}

export interface SceneGroup {
  kind: "group";
  key: string;
  layout: GroupLayout;
  children: SceneNode[];
  frame?: SceneFrame;
}

export type SceneNode = SceneLeaf | SceneGroup;

export interface SceneLabel {
  fromKey: string;
  toKey: string;
  width: number;
  height: number;
}

const LABEL_CLEARANCE = 64;

/** Reserve label space in the smallest group containing both endpoints. */
export const withLabelSpacing = (root: SceneNode, labels: readonly SceneLabel[]): SceneNode => {
  const paths = new Map<string, SceneGroup[]>();
  const collect = (node: SceneNode, parents: SceneGroup[]) => {
    if (node.kind === "leaf") paths.set(node.key, parents);
    else node.children.forEach((child) => collect(child, [...parents, node]));
  };
  collect(root, []);
  const spacing = new Map<SceneGroup, { width: number; height: number }>();
  for (const label of labels) {
    if (label.fromKey === label.toKey) continue;
    const from = paths.get(label.fromKey);
    const to = paths.get(label.toKey);
    if (!from || !to) continue;
    let common: SceneGroup | undefined;
    for (let i = 0; i < Math.min(from.length, to.length) && from[i] === to[i]; i++) common = from[i];
    if (!common) continue;
    const previous = spacing.get(common);
    spacing.set(common, {
      width: Math.max(previous?.width ?? 0, label.width + LABEL_CLEARANCE),
      height: Math.max(previous?.height ?? 0, label.height + LABEL_CLEARANCE),
    });
  }
  const update = (node: SceneNode): SceneNode => {
    if (node.kind === "leaf") return node;
    const room = spacing.get(node);
    let layout = node.layout;
    if (room) {
      switch (layout.type) {
        case "stack":
          layout = { ...layout, gap: Math.max(layout.gap, layout.axis === "h" ? room.width : room.height) };
          break;
        case "tree":
          layout = { ...layout,
            rankGap: Math.max(layout.rankGap, layout.direction === "right" ? room.width : room.height),
            siblingGap: Math.max(layout.siblingGap, layout.direction === "right" ? room.height : room.width),
          };
          break;
        default:
          layout = { ...layout, gap: Math.max(layout.gap, room.width, room.height) };
      }
    }
    return { ...node, layout, children: node.children.map(update) };
  };
  return labels.length ? update(root) : root;
};

/** A positioned box; x and y are the top-left corner in world coordinates. */
export interface PlacedBox {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedFrame extends PlacedBox {
  label?: string;
  outline: boolean;
}

export interface SceneLayout {
  boxes: PlacedBox[];
  frames: PlacedFrame[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FRAME_PADDING = 18;
export const FRAME_LABEL_HEIGHT = 22;

interface Size {
  width: number;
  height: number;
}

interface Offset {
  x: number;
  y: number;
}

const extent = (sizes: readonly Size[], offsets: readonly Offset[]): Size => ({
  width: Math.max(0, ...sizes.map((size, index) => offsets[index].x + size.width)),
  height: Math.max(0, ...sizes.map((size, index) => offsets[index].y + size.height)),
});

const stackOffsets = (sizes: readonly Size[], axis: "h" | "v", gap: number): Offset[] => {
  let cursor = 0;
  return sizes.map((size) => {
    const offset = axis === "h" ? { x: cursor, y: 0 } : { x: 0, y: cursor };
    cursor += (axis === "h" ? size.width : size.height) + gap;
    return offset;
  });
};

const wrapOffsets = (sizes: readonly Size[], axis: "h" | "v", limit: number, gap: number): Offset[] => {
  const offsets: Offset[] = [];
  let main = 0;
  let cross = 0;
  let lineCross = 0;
  let lineCount = 0;
  for (const size of sizes) {
    const mainSize = axis === "h" ? size.width : size.height;
    const crossSize = axis === "h" ? size.height : size.width;
    if (lineCount > 0 && main + mainSize > limit) {
      cross += lineCross + gap;
      main = 0;
      lineCross = 0;
      lineCount = 0;
    }
    offsets.push(axis === "h" ? { x: main, y: cross } : { x: cross, y: main });
    main += mainSize + gap;
    lineCross = Math.max(lineCross, crossSize);
    lineCount += 1;
  }
  return offsets;
};

const gridOffsets = (sizes: readonly Size[], columns: number, gap: number): Offset[] => {
  const cellWidth = Math.max(0, ...sizes.map((size) => size.width));
  const cellHeight = Math.max(0, ...sizes.map((size) => size.height));
  return sizes.map((size, index) => ({
    x: (index % columns) * (cellWidth + gap) + (cellWidth - size.width) / 2,
    y: Math.floor(index / columns) * (cellHeight + gap) + (cellHeight - size.height) / 2,
  }));
};

/** Room between ring neighbours for a short line and its label. */
const CIRCLE_LINK_ROOM = 96;

const circleOffsets = (sizes: readonly Size[], gap: number): Offset[] => {
  const count = sizes.length;
  if (count <= 1) return sizes.map(() => ({ x: 0, y: 0 }));
  const diagonals = sizes.map((size) => Math.hypot(size.width, size.height));
  const chord = Math.max(...sizes.map((size, index) => {
    const next = sizes[(index + 1) % count];
    return Math.max(
      (diagonals[index] + diagonals[(index + 1) % count]) / 2 + gap,
      (size.width + next.width) / 2 + CIRCLE_LINK_ROOM,
    );
  }));
  const radius = chord / (2 * Math.sin(Math.PI / count));
  const centers = sizes.map((_, index) => {
    const angle = -Math.PI / 2 + index * 2 * Math.PI / count;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  const minX = Math.min(...centers.map((center, index) => center.x - sizes[index].width / 2));
  const minY = Math.min(...centers.map((center, index) => center.y - sizes[index].height / 2));
  return centers.map((center, index) => ({
    x: center.x - sizes[index].width / 2 - minX,
    y: center.y - sizes[index].height / 2 - minY,
  }));
};

const treeOffsets = (sizes: readonly Size[], direction: "right" | "down", rankGap: number, siblingGap: number): Offset[] => {
  if (sizes.length === 0) return [];
  const [node, ...subtrees] = sizes;
  const branch = direction === "right"
    ? stackOffsets(subtrees, "v", siblingGap).map((offset) => ({ x: node.width + rankGap, y: offset.y }))
    : stackOffsets(subtrees, "h", siblingGap).map((offset) => ({ x: offset.x, y: node.height + rankGap }));
  return [{ x: 0, y: 0 }, ...branch];
};

const childOffsets = (layout: GroupLayout, sizes: readonly Size[]): Offset[] => {
  switch (layout.type) {
    case "stack": return stackOffsets(sizes, layout.axis, layout.gap);
    case "wrap": return wrapOffsets(sizes, layout.axis, layout.limit, layout.gap);
    case "grid": return gridOffsets(sizes, layout.columns, layout.gap);
    case "circle": return circleOffsets(sizes, layout.gap);
    case "tree": return treeOffsets(sizes, layout.direction, layout.rankGap, layout.siblingGap);
  }
};

const framePadding = (group: SceneGroup): number => (group.frame?.outline ? FRAME_PADDING : 0);

const frameInset = (group: SceneGroup): Offset => ({
  x: framePadding(group),
  y: framePadding(group) + (group.frame?.label ? FRAME_LABEL_HEIGHT : 0),
});

interface Measured {
  size: Size;
  offsets: Offset[];
}

const measure = (node: SceneNode, cache: Map<SceneNode, Measured>): Measured => {
  const known = cache.get(node);
  if (known) return known;
  let result: Measured;
  if (node.kind === "leaf") {
    result = { size: { width: node.width, height: node.height }, offsets: [] };
  } else {
    const sizes = node.children.map((child) => measure(child, cache).size);
    const offsets = childOffsets(node.layout, sizes);
    const inner = extent(sizes, offsets);
    const inset = frameInset(node);
    result = {
      size: {
        width: inner.width + inset.x + framePadding(node),
        height: inner.height + inset.y + framePadding(node),
      },
      offsets,
    };
  }
  cache.set(node, result);
  return result;
};

const arrange = (node: SceneNode, x: number, y: number, cache: Map<SceneNode, Measured>, out: SceneLayout) => {
  const { size, offsets } = measure(node, cache);
  if (node.kind === "leaf") {
    out.boxes.push({ key: node.key, x, y, width: size.width, height: size.height });
    return;
  }
  if (node.frame) {
    out.frames.push({ key: node.key, x, y, width: size.width, height: size.height, label: node.frame.label, outline: node.frame.outline });
  }
  const inset = frameInset(node);
  node.children.forEach((child, index) => {
    arrange(child, x + inset.x + offsets[index].x, y + inset.y + offsets[index].y, cache, out);
  });
};

/** Places every leaf and frame of the scene; the root's top-left corner lands at the given origin. */
export const layoutScene = (root: SceneNode, originX = 0, originY = 0): SceneLayout => {
  const cache = new Map<SceneNode, Measured>();
  const out: SceneLayout = { boxes: [], frames: [], x: originX, y: originY, width: 0, height: 0 };
  arrange(root, originX, originY, cache, out);
  const { size } = measure(root, cache);
  out.width = size.width;
  out.height = size.height;
  return out;
};

export type BoundaryShape = "rect" | "circle" | "diamond";

export interface LineEnd {
  box: PlacedBox;
  boundary: BoundaryShape;
}

export interface LineGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  middle: { x: number; y: number };
}

const LINE_MARGIN = 3;

const exitDistance = (end: LineEnd, dx: number, dy: number): number => {
  const halfWidth = end.box.width / 2;
  const halfHeight = end.box.height / 2;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  switch (end.boundary) {
    case "rect":
      return Math.min(ax > 0 ? halfWidth / ax : Infinity, ay > 0 ? halfHeight / ay : Infinity);
    case "circle":
      return Math.min(halfWidth, halfHeight);
    case "diamond":
      return 1 / (ax / halfWidth + ay / halfHeight);
  }
};

/** A straight connector between two boxes, trimmed to their outlines. */
export const lineGeometry = (from: LineEnd, to: LineEnd): LineGeometry => {
  const start = { x: from.box.x + from.box.width / 2, y: from.box.y + from.box.height / 2 };
  const finish = { x: to.box.x + to.box.width / 2, y: to.box.y + to.box.height / 2 };
  const dx = finish.x - start.x;
  const dy = finish.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return { x1: start.x, y1: start.y, x2: finish.x, y2: finish.y, middle: start };
  const ux = dx / length;
  const uy = dy / length;
  const fromTrim = exitDistance(from, ux, uy) + LINE_MARGIN;
  const toTrim = exitDistance(to, ux, uy) + LINE_MARGIN;
  if (fromTrim + toTrim >= length) return { x1: start.x, y1: start.y, x2: finish.x, y2: finish.y, middle: { x: (start.x + finish.x) / 2, y: (start.y + finish.y) / 2 } };
  const x1 = start.x + ux * fromTrim;
  const y1 = start.y + uy * fromTrim;
  const x2 = finish.x - ux * toTrim;
  const y2 = finish.y - uy * toTrim;
  return { x1, y1, x2, y2, middle: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } };
};
