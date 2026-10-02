import assert from "node:assert/strict";
import test from "node:test";
import {
  actorGraphLayout,
  actorTimings,
  clampGraphPan,
  formatDuration,
  GRAPH_CARD_HEIGHT,
  GRAPH_CARD_WIDTH,
  GRAPH_PAN_MARGIN,
  graphColumns,
  graphNodeStatus,
  graphPannable,
  graphPanTo,
  graphViewport,
  roundedPath,
  type GraphCard,
  type GraphLayout,
} from "../../../plugins/ragents.orchestration/web/run-panel/actor-graph.ts";
import { addresseeTree, type AddresseeGroupNode } from "../../../plugins/ragents.orchestration/web/run-panel/addressee-tree.ts";
import { runPanelActors } from "../../../plugins/ragents.orchestration/web/run-panel/run-panel-actors.ts";
import type { RunActor, RunTurn, RunView } from "../src/run-view.ts";

const at = "2026-10-02T10:00:00.000Z";
const idle = { kind: "idle", since: at } as const;
const running = { kind: "running", turnId: "t", inputId: "i", startedAt: "2026-10-02T10:05:00.000Z" } as const;
const stopped = { kind: "stopped", stoppedAt: at, reason: "done" } as const;
const actor = (id: string, createdBy: string | undefined, extra: Partial<RunActor> = {}): RunActor =>
  ({ id, kind: "agent", handle: id, displayName: id, grants: [], createdAt: at, ...createdBy === undefined ? {} : { createdBy }, lifecycle: idle, ...extra });
const turn = (actorId: string, startedAt: string, finishedAt: string | null): RunTurn =>
  ({ id: `${actorId}-${startedAt}`, actorId, inputId: "i", status: finishedAt === null ? "running" : "completed", startedAt, finishedAt, reason: null, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 } });
const viewOf = (actors: RunActor[], extra: Partial<RunView> = {}): RunView => ({
  id: "run", revision: 1, title: "Graph", ownerId: "owner", primaryActorId: "coordinator", createdAt: at, forkedFrom: null,
  actors: [{ id: "owner", kind: "human", handle: "owner", displayName: "Owner", grants: [], createdAt: at }, actor("coordinator", "owner"), ...actors],
  inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [], ...extra,
});
const layoutOf = (view: RunView, columns: number, open: (group: AddresseeGroupNode) => boolean = () => false): GraphLayout =>
  actorGraphLayout(addresseeTree(view, runPanelActors(view, true)), open, columns);
const cardOf = (layout: GraphLayout, key: string): GraphCard => {
  const card = layout.cards.find((entry) => entry.key === key);
  assert.ok(card, key);
  return card;
};
const center = (card: GraphCard) => card.x + GRAPH_CARD_WIDTH / 2;
const overlap = (left: GraphCard, right: GraphCard) =>
  left.x < right.x + GRAPH_CARD_WIDTH && right.x < left.x + GRAPH_CARD_WIDTH && left.y < right.y + GRAPH_CARD_HEIGHT && right.y < left.y + GRAPH_CARD_HEIGHT;

const team = viewOf([
  actor("implementer", "coordinator"),
  actor("test-writer", "implementer"),
  actor("formatter", "implementer", { kind: "script" }),
  actor("summary", "coordinator"),
]);

test("the graph runs top-down by creator: each level one row lower, the creator centered above its children", () => {
  const layout = layoutOf(team, 4);
  assert.deepEqual(layout.cards.map((card) => [card.key, card.parentKey]), [
    ["actor:coordinator", null],
    ["actor:implementer", "actor:coordinator"],
    ["actor:test-writer", "actor:implementer"],
    ["actor:formatter", "actor:implementer"],
    ["actor:summary", "actor:coordinator"],
  ], "creator before children, so Tab follows the tree");
  const [coordinator, implementer, testWriter, formatter, summary] = layout.cards;
  const level = GRAPH_CARD_HEIGHT + 36;
  assert.equal(implementer.y - coordinator.y, level);
  assert.equal(summary.y, implementer.y, "siblings share a row");
  assert.equal(testWriter.y - implementer.y, level);
  assert.equal(formatter.y, testWriter.y);
  assert.equal(center(coordinator), (center(implementer) + center(summary)) / 2);
  assert.equal(center(implementer), (center(testWriter) + center(formatter)) / 2);
  assert.equal(layout.height, testWriter.y + GRAPH_CARD_HEIGHT + 16);
  assert.ok(layout.cards.every((card, index) => layout.cards.slice(index + 1).every((other) => !overlap(card, other))));
});

test("every edge leaves the creator's bottom edge and ends on the child's top edge", () => {
  const layout = layoutOf(team, 4);
  assert.deepEqual(layout.edges.map((edge) => edge.target), ["actor:implementer", "actor:test-writer", "actor:formatter", "actor:summary"]);
  assert.deepEqual(layout.frames, []);
  for (const edge of layout.edges) {
    const child = cardOf(layout, edge.target);
    const parent = cardOf(layout, child.parentKey!);
    assert.ok(edge.path.startsWith(`M ${center(parent)} ${parent.y + GRAPH_CARD_HEIGHT} `), edge.path);
    assert.ok(edge.path.endsWith(`L ${center(child)} ${child.y}`), edge.path);
  }
});

test("more siblings than columns wrap into rows that hang on a line in the left gutter", () => {
  const names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"];
  const layout = layoutOf(viewOf(names.map((name) => actor(name, "coordinator"))), 3);
  const rows = [...new Set(names.map((name) => cardOf(layout, `actor:${name}`).y))];
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((y) => names.filter((name) => cardOf(layout, `actor:${name}`).y === y).length), [3, 3, 1]);
  assert.equal(cardOf(layout, "actor:alpha").x, 16 + 20, "wrapped rows start right of the gutter");
  const firstBus = 16 + GRAPH_CARD_HEIGHT + 18;
  assert.ok(!layout.edges[0].path.includes("Q 26 "), "the first row needs no gutter");
  assert.ok(layout.edges[3].path.includes(`Q 26 ${firstBus}`), layout.edges[3].path);
  assert.ok(layout.cards.every((card, index) => layout.cards.slice(index + 1).every((other) => !overlap(card, other))));
  assert.ok(layout.width <= 16 * 2 + 20 + 3 * GRAPH_CARD_WIDTH + 2 * 16, "a wrapped block is as wide as its columns");
});

test("a closed group is one card; opened, a frame below it holds its members in rows of the column count", () => {
  const reviewers = Array.from({ length: 10 }, (_, index) => actor(`review-${index + 1}`, "coordinator", { lifecycle: index === 0 ? running : idle }));
  const view = viewOf(reviewers);
  const closed = layoutOf(view, 4);
  assert.deepEqual(closed.cards.map((card) => card.key), ["actor:coordinator", "group:coordinator/agent/review"]);
  const open = layoutOf(view, 4, () => true);
  const members = open.cards.filter((card) => card.parentKey === "group:coordinator/agent/review");
  assert.equal(members.length, 10);
  assert.deepEqual([...new Set(members.map((card) => card.y))].map((y) => members.filter((card) => card.y === y).length), [4, 4, 2]);
  const group = cardOf(open, "group:coordinator/agent/review");
  assert.equal(open.frames.length, 1);
  const [frame] = open.frames;
  assert.equal(frame.key, group.key);
  assert.ok(members.every((card) => card.x >= frame.x && card.x + GRAPH_CARD_WIDTH <= frame.x + frame.width && card.y >= frame.y && card.y + GRAPH_CARD_HEIGHT <= frame.y + frame.height));
  assert.equal(center(group), frame.x + frame.width / 2, "the group card stands centered above its frame");
  assert.deepEqual(open.edges.map((edge) => [edge.target, edge.path]), [
    ["group:coordinator/agent/review", `M ${center(group)} ${group.y - 36} L ${center(group)} ${group.y}`],
    ["group:coordinator/agent/review", `M ${center(group)} ${group.y + GRAPH_CARD_HEIGHT} L ${center(group)} ${frame.y}`],
  ], "one line into the frame instead of one per member");
  assert.ok(open.cards.every((card, index) => open.cards.slice(index + 1).every((other) => !overlap(card, other))));
});

test("the column count follows the canvas width and never drops below one", () => {
  assert.equal(graphColumns(1200), 5);
  assert.equal(graphColumns(732), 3);
  assert.equal(graphColumns(731), 2);
  assert.equal(graphColumns(0), 1);
  const siblings = viewOf(["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"].map((name) => actor(name, "coordinator")));
  const group = viewOf(Array.from({ length: 12 }, (_, index) => actor(`worker-${index + 1}`, "coordinator")));
  for (const width of [731, 732, 1200]) {
    assert.ok(layoutOf(siblings, graphColumns(width)).width <= width, `wrapped rows fit into ${width} pixels`);
    assert.ok(layoutOf(group, graphColumns(width), () => true).width <= width, `an open group fits into ${width} pixels`);
  }
});

test("the view grows with the layout up to its room and stays compact for a small graph", () => {
  const room = { width: 1200, height: 800 };
  const small = graphViewport({ width: 500, height: 300 }, room);
  assert.deepEqual(small, { width: 500, height: 300, scrollWidth: 500, scrollHeight: 300, left: 0, top: 0 });
  assert.equal(graphPannable(small), false);
  assert.equal(graphPannable(graphViewport(room, room)), false, "a layout exactly as large as the room fits");
  const wide = graphViewport({ width: 1900, height: 300 }, room);
  assert.deepEqual(wide, { width: 1200, height: 300, scrollWidth: 1900 + 48, scrollHeight: 300, left: 24, top: 0 }, "only the axis that does not fit pans");
  assert.equal(graphPannable(wide), true);
  const large = graphViewport({ width: 1900, height: 1300 }, room);
  assert.deepEqual([large.width, large.height, large.scrollHeight, large.top], [1200, 800, 1348, 24]);
});

test("panning stops where the cards are the pan margin away from the edge of the view", () => {
  const layout = { width: 1900, height: 1300 };
  const viewport = graphViewport(layout, { width: 1200, height: 800 });
  const first = clampGraphPan(viewport, { left: -500, top: -500 });
  assert.deepEqual(first, { left: 0, top: 0 });
  assert.equal(viewport.left + 16 - first.left, GRAPH_PAN_MARGIN, "the left edge of the cards stays 40 pixels inside the view");
  assert.equal(viewport.top + 16 - first.top, GRAPH_PAN_MARGIN);
  const last = clampGraphPan(viewport, { left: 5000, top: 5000 });
  assert.deepEqual(last, { left: 748, top: 548 });
  assert.equal(viewport.width - (viewport.left + layout.width - 16 - last.left), GRAPH_PAN_MARGIN, "the right edge of the cards stays 40 pixels inside the view");
  assert.equal(viewport.height - (viewport.top + layout.height - 16 - last.top), GRAPH_PAN_MARGIN);
  assert.deepEqual(clampGraphPan(viewport, { left: 300.5, top: 12 }), { left: 300.5, top: 12 }, "inside the limits a pan stays as it is");
  assert.deepEqual(clampGraphPan(graphViewport({ width: 500, height: 300 }, { width: 1200, height: 800 }), { left: 80, top: -20 }), { left: 0, top: 0 }, "a graph that fits does not pan");
});

test("a point of the layout moves to a point of the view as far as the pan limits allow", () => {
  const viewport = graphViewport({ width: 1900, height: 1300 }, { width: 1200, height: 800 });
  assert.deepEqual(graphPanTo(viewport, 950, 650, 600, 400), { left: 374, top: 274 }, "the middle of the layout in the middle of the view");
  assert.deepEqual(graphPanTo(viewport, 100, 50, 600, 400), { left: 0, top: 0 }, "a card near the top left corner cannot be centered");
  assert.deepEqual(graphPanTo(viewport, 1800, 1250, 600, 400), { left: 748, top: 548 });
  const fits = graphViewport({ width: 500, height: 300 }, { width: 1200, height: 800 });
  assert.deepEqual(graphPanTo(fits, 250, 150, 600, 400), { left: 0, top: 0 });
});

test("routes become paths with rounded corners; straight and repeated points drop out", () => {
  assert.equal(roundedPath([[10, 0], [10, 20], [10, 20], [10, 40]], 6), "M 10 0 L 10 40");
  assert.equal(roundedPath([[0, 0], [0, 20], [30, 20], [30, 40]], 6), "M 0 0 L 0 14 Q 0 20 6 20 L 24 20 Q 30 20 30 26 L 30 40");
  assert.equal(roundedPath([[0, 0], [0, 4], [30, 4]], 6), "M 0 0 L 0 2 Q 0 4 2 4 L 30 4", "a short leg limits the radius");
});

test("durations read as seconds, minutes, hours or days", () => {
  assert.deepEqual([0, 999, 59_999, 72_000, 3_600_000, 7_500_000, 187_200_000, -5_000].map(formatDuration),
    ["0s", "0s", "59s", "1m 12s", "1h 0m", "2h 5m", "2d 4h", "0s"]);
});

test("a working actor counts from the start of its turn, the others show their last finished turn", () => {
  const view = viewOf([actor("worker", "coordinator", { lifecycle: running }), actor("done", "coordinator"), actor("fresh", "coordinator")], {
    turns: [
      turn("done", "2026-10-02T10:00:00.000Z", "2026-10-02T10:00:42.000Z"),
      turn("done", "2026-10-02T10:01:00.000Z", "2026-10-02T10:02:12.500Z"),
      turn("worker", "2026-10-02T09:00:00.000Z", "2026-10-02T09:00:05.000Z"),
      turn("worker", running.startedAt, null),
      turn("fresh", "2026-10-02T10:03:00.000Z", null),
    ],
  });
  const timing = actorTimings(view);
  assert.deepEqual(timing("worker"), { kind: "running", since: Date.parse(running.startedAt) });
  assert.deepEqual(timing("done"), { kind: "finished", milliseconds: 72_500 });
  assert.equal(timing("fresh"), undefined, "a turn without an end and without a running lifecycle shows nothing");
  assert.equal(timing("coordinator"), undefined);
});

test("a group works as soon as one member works and is stopped only when all members are", () => {
  const group = (lifecycles: RunActor["lifecycle"][], askedBy?: string): string => {
    const view = viewOf(lifecycles.map((lifecycle, index) => actor(`review-${index}`, "coordinator", { lifecycle })), askedBy ? {
      actions: [{ id: "q", askedBy, owner: "ragents.ask", payload: null, title: "?", description: null, parameters: {}, input: null, status: "pending", proposedAt: at, resolvedAt: null, resolvedBy: null, result: null }],
    } : {});
    const tree = addresseeTree(view, runPanelActors(view, true));
    const node = tree[0].kind === "actor" ? tree[0].children[0] : undefined;
    assert.equal(node?.kind, "group");
    return graphNodeStatus(view, node!);
  };
  assert.equal(group([idle, running, stopped, idle]), "running");
  assert.equal(group([idle, idle, stopped, idle], "review-1"), "input");
  assert.equal(group([stopped, stopped, stopped, stopped]), "stopped");
  assert.equal(group([stopped, idle, stopped, stopped]), "waiting");
});
