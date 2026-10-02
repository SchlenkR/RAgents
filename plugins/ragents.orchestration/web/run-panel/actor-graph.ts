import type { RunView } from "@ragents/web/run-view";
import { addresseeStatus, type AddresseeGroupNode, type AddresseeNode, type AddresseeStatus } from "./addressee-tree";

export const GRAPH_CARD_WIDTH = 216;
export const GRAPH_CARD_HEIGHT = 70;
const GAP_X = 16;
/** Room between a card and the row of its children; the connecting bus runs in the middle. */
const GAP_Y = 36;
/** Left of wrapped rows, where the line from the creator runs down to the later rows. */
const GUTTER = 20;
/** Inside the frame of an open group; both sides together take as much room as the gutter. */
const FRAME_PADDING = GUTTER / 2;
const FRAME_ROW_GAP = 12;
const PADDING = 16;
const SCROLLBAR = 16;
const CORNER = 6;

type Point = readonly [x: number, y: number];

export interface GraphCard {
  key: string;
  node: AddresseeNode;
  /** The card above this one: its creator or its group; roots have none. */
  parentKey: string | null;
  x: number;
  y: number;
}

export interface GraphEdge {
  key: string;
  /** The card whose state colors the edge: the child, or the group for the line into its frame. */
  target: string;
  path: string;
}

/** The block below an open group that holds its members. */
export interface GraphFrame {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphLayout {
  width: number;
  height: number;
  /** Creator before its children, so Tab follows the tree. */
  cards: GraphCard[];
  edges: GraphEdge[];
  frames: GraphFrame[];
}

interface Subtree {
  key: string;
  node: AddresseeNode;
  width: number;
  height: number;
  cardLeft: number;
  rows: readonly (readonly Slot[])[];
  frame?: Omit<GraphFrame, "key">;
}

interface Slot {
  left: number;
  top: number;
  tree: Subtree;
}

export type ActorTiming =
  | { kind: "running"; since: number }
  | { kind: "finished"; milliseconds: number };

export const graphNodeKey = (node: AddresseeNode): string => node.kind === "actor" ? `actor:${node.actor.id}` : `group:${node.key}`;

/** How many cards fit side by side in a canvas of this width, including the gutter of wrapped rows. */
export const graphColumns = (width: number): number =>
  Math.max(1, Math.floor((width - 2 * PADDING - SCROLLBAR - GUTTER + GAP_X) / (GRAPH_CARD_WIDTH + GAP_X)));

/** The state an edge and a card show: a group works as soon as one member works and is stopped only when all are. */
export const graphNodeStatus = (view: RunView, node: AddresseeNode): AddresseeStatus => {
  if (node.kind === "actor") return addresseeStatus(view, node.actor);
  const statuses = new Set(node.members.map((member) => addresseeStatus(view, member.actor)));
  return statuses.has("running") ? "running" : statuses.has("input") ? "input" : statuses.size === 1 && statuses.has("stopped") ? "stopped" : "waiting";
};

/** "12s", "1m 12s", "2h 5m", "3d 4h". */
export const formatDuration = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
};

/** Per actor the start of its running turn, otherwise the duration of its last finished turn; nothing if it never finished one. */
export const actorTimings = (view: RunView): ((actorId: string) => ActorTiming | undefined) => {
  const finished = new Map<string, number>();
  for (const turn of view.turns) {
    const duration = turn.finishedAt === null ? Number.NaN : Date.parse(turn.finishedAt) - Date.parse(turn.startedAt);
    if (!Number.isNaN(duration)) finished.set(turn.actorId, duration);
  }
  const running = new Map(view.actors.flatMap((actor) => actor.lifecycle?.kind === "running" ? [[actor.id, Date.parse(actor.lifecycle.startedAt)] as const] : []));
  return (actorId) => {
    const since = running.get(actorId);
    if (since !== undefined && !Number.isNaN(since)) return { kind: "running", since };
    const milliseconds = finished.get(actorId);
    return milliseconds === undefined ? undefined : { kind: "finished", milliseconds };
  };
};

const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

const arrange = (trees: readonly Subtree[], columns: number, left: number, top: number, rowGap: number): Slot[][] =>
  chunks(trees, columns).reduce<{ rows: Slot[][]; top: number }>((state, chunk) => ({
    rows: [...state.rows, chunk.reduce<Slot[]>((row, tree) => {
      const previous = row.at(-1);
      return [...row, { left: previous ? previous.left + previous.tree.width + GAP_X : left, top: state.top, tree }];
    }, [])],
    top: state.top + Math.max(...chunk.map((tree) => tree.height)) + rowGap,
  }), { rows: [], top }).rows;

const extent = (rows: readonly (readonly Slot[])[]) => ({
  width: Math.max(0, ...rows.flatMap((row) => row.map((slot) => slot.left + slot.tree.width))),
  height: Math.max(0, ...rows.flatMap((row) => row.map((slot) => slot.top + slot.tree.height))),
});

const cardCenter = (slot: Slot) => slot.left + slot.tree.cardLeft + GRAPH_CARD_WIDTH / 2;
const centered = (middle: number, width: number) => Math.round(Math.min(Math.max(middle - GRAPH_CARD_WIDTH / 2, 0), width - GRAPH_CARD_WIDTH));

const measure = (node: AddresseeNode, open: (group: AddresseeGroupNode) => boolean, columns: number): Subtree => {
  const key = graphNodeKey(node);
  if (node.kind === "group" && open(node)) {
    const frameTop = GRAPH_CARD_HEIGHT + GAP_Y;
    const rows = arrange(node.members.map((member) => measure(member, open, columns)), columns, FRAME_PADDING, frameTop + FRAME_PADDING, FRAME_ROW_GAP);
    const size = extent(rows);
    const frame = { x: 0, y: frameTop, width: size.width + FRAME_PADDING, height: size.height - frameTop + FRAME_PADDING };
    const width = Math.max(GRAPH_CARD_WIDTH, frame.width);
    return { key, node, width, height: frame.y + frame.height, cardLeft: centered(frame.width / 2, width), rows, frame };
  }
  const children = node.kind === "actor" ? node.children : [];
  const trees = children.map((child) => measure(child, open, columns));
  const rows = arrange(trees, columns, trees.length > columns ? GUTTER : 0, GRAPH_CARD_HEIGHT + GAP_Y, GAP_Y);
  const size = extent(rows);
  const width = Math.max(GRAPH_CARD_WIDTH, size.width);
  const first = rows[0] ?? [];
  const middle = first.length > 0 ? (cardCenter(first[0]) + cardCenter(first[first.length - 1])) / 2 : GRAPH_CARD_WIDTH / 2;
  return { key, node, width, height: Math.max(GRAPH_CARD_HEIGHT, size.height), cardLeft: centered(middle, width), rows };
};

const place = (tree: Subtree, x: number, y: number, parentKey: string | null): Omit<GraphLayout, "width" | "height"> => {
  const card: GraphCard = { key: tree.key, node: tree.node, parentKey, x: x + tree.cardLeft, y };
  const start: Point = [card.x + GRAPH_CARD_WIDTH / 2, y + GRAPH_CARD_HEIGHT];
  const firstBus = y + GRAPH_CARD_HEIGHT + GAP_Y / 2;
  const gutter = x + GUTTER / 2;
  const branches = tree.rows.flatMap((row, index) => row.map((slot) => {
    const child = place(slot.tree, x + slot.left, y + slot.top, tree.key);
    if (tree.frame) return child;
    const end: Point = [x + cardCenter(slot), y + slot.top];
    const bus = end[1] - GAP_Y / 2;
    const route: Point[] = index === 0
      ? [start, [start[0], bus], [end[0], bus], end]
      : [start, [start[0], firstBus], [gutter, firstBus], [gutter, bus], [end[0], bus], end];
    return { ...child, edges: [{ key: `edge:${slot.tree.key}`, target: slot.tree.key, path: roundedPath(route, CORNER) }, ...child.edges] };
  }));
  const frame = tree.frame && { key: tree.key, x: x + tree.frame.x, y: y + tree.frame.y, width: tree.frame.width, height: tree.frame.height };
  const into = frame ? [{ key: `frame:${tree.key}`, target: tree.key, path: roundedPath([start, [start[0], frame.y]], CORNER) }] : [];
  return {
    cards: [card, ...branches.flatMap((branch) => branch.cards)],
    edges: [...into, ...branches.flatMap((branch) => branch.edges)],
    frames: [...frame ? [frame] : [], ...branches.flatMap((branch) => branch.frames)],
  };
};

/** Top-down tree: each creator above its children, at most `columns` per row; wrapped rows hang on a gutter line, open groups frame their members. */
export const actorGraphLayout = (nodes: readonly AddresseeNode[], open: (group: AddresseeGroupNode) => boolean, columns: number): GraphLayout => {
  const rows = arrange(nodes.map((node) => measure(node, open, columns)), columns, 0, 0, GAP_Y);
  const placed = rows.flatMap((row) => row.map((slot) => place(slot.tree, PADDING + slot.left, PADDING + slot.top, null)));
  const size = extent(rows);
  return {
    width: size.width + 2 * PADDING,
    height: size.height + 2 * PADDING,
    cards: placed.flatMap((entry) => entry.cards),
    edges: placed.flatMap((entry) => entry.edges),
    frames: placed.flatMap((entry) => entry.frames),
  };
};

const samePoint = (left: Point, right: Point) => left[0] === right[0] && left[1] === right[1];
const straight = (before: Point, point: Point, after: Point) =>
  (before[0] === point[0] && point[0] === after[0]) || (before[1] === point[1] && point[1] === after[1]);
const distance = (from: Point, to: Point) => Math.hypot(to[0] - from[0], to[1] - from[1]);
const toward = (from: Point, to: Point, length: number): Point => {
  const ratio = length / distance(from, to);
  return [from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio];
};
const coordinate = (point: Point) => `${point[0]} ${point[1]}`;

/** An orthogonal route as SVG path with rounded corners; repeated and collinear points drop out. */
export const roundedPath = (route: readonly Point[], radius: number): string => {
  const distinct = route.filter((point, index) => index === 0 || !samePoint(route[index - 1], point));
  const corners = distinct.filter((point, index) => index === 0 || index === distinct.length - 1 || !straight(distinct[index - 1], point, distinct[index + 1]));
  const bends = corners.slice(1, -1).map((corner, index) => {
    const before = corners[index];
    const after = corners[index + 2];
    const bend = Math.min(radius, distance(before, corner) / 2, distance(corner, after) / 2);
    return `L ${coordinate(toward(corner, before, bend))} Q ${coordinate(corner)} ${coordinate(toward(corner, after, bend))}`;
  });
  return [`M ${coordinate(corners[0])}`, ...bends, `L ${coordinate(corners[corners.length - 1])}`].join(" ");
};
