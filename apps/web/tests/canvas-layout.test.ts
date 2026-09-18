import assert from "node:assert/strict";
import test from "node:test";

import { canvasLayoutOf } from "../../../plugins/ragents.orchestration/contract.ts";
import {
  FRAME_LABEL_HEIGHT,
  FRAME_PADDING,
  layoutScene,
  lineGeometry,
  withLabelSpacing,
  type SceneGroup,
  type SceneLeaf,
} from "../../../plugins/ragents.orchestration/web/canvas-layout.ts";
import { ANCHORED_GAP, boundaryOf, buildScene, DEFAULT_GAP, RANK_GAP, UNPLACED_LABEL } from "../../../plugins/ragents.orchestration/web/canvas-scene.ts";
import type { RunActor, RunView } from "../../../plugins/ragents.orchestration/web/run-view.ts";

const leaf = (key: string, width = 100, height = 40): SceneLeaf => ({ kind: "leaf", key, width, height });

const group = (key: string, layout: SceneGroup["layout"], children: SceneGroup["children"], frame?: SceneGroup["frame"]): SceneGroup =>
  ({ kind: "group", key, layout, children, ...(frame ? { frame } : {}) });

const boxOf = (layout: ReturnType<typeof layoutScene>, key: string) => {
  const box = layout.boxes.find((entry) => entry.key === key);
  if (!box) throw new Error(`Box ${key} fehlt`);
  return box;
};

test("Stapel reihen ihre Kinder mit Abstand auf, Umbruch bricht an der Breite", () => {
  const row = layoutScene(group("row", { type: "stack", axis: "h", gap: 10 }, [leaf("a"), leaf("b", 50)]));
  assert.deepEqual([boxOf(row, "a").x, boxOf(row, "b").x], [0, 110]);
  assert.equal(row.width, 160);

  const column = layoutScene(group("col", { type: "stack", axis: "v", gap: 10 }, [leaf("a"), leaf("b")]));
  assert.deepEqual([boxOf(column, "a").y, boxOf(column, "b").y], [0, 50]);

  const wrapped = layoutScene(group("wrap", { type: "wrap", axis: "h", limit: 230, gap: 10 }, [leaf("a"), leaf("b"), leaf("c")]));
  assert.deepEqual([boxOf(wrapped, "a").y, boxOf(wrapped, "b").y, boxOf(wrapped, "c").y], [0, 0, 50]);
  assert.equal(boxOf(wrapped, "c").x, 0);
});

test("ein Raster fuellt Spalten zuerst und zentriert kleinere Kinder in der Zelle", () => {
  const grid = layoutScene(group("grid", { type: "grid", columns: 2, gap: 10 }, [leaf("a"), leaf("b", 60, 20), leaf("c")]));
  assert.deepEqual([boxOf(grid, "a").x, boxOf(grid, "b").x, boxOf(grid, "c").x], [0, 130, 0]);
  assert.equal(boxOf(grid, "b").y, 10);
  assert.equal(boxOf(grid, "c").y, 50);
});

test("ein Baum legt Kinder rechts vom Vater untereinander, oben buendig", () => {
  const tree = group("tree", { type: "tree", direction: "right", rankGap: 30, siblingGap: 10 }, [
    leaf("root"),
    group("t-a", { type: "tree", direction: "right", rankGap: 30, siblingGap: 10 }, [leaf("a"), group("t-c", { type: "tree", direction: "right", rankGap: 30, siblingGap: 10 }, [leaf("c")])]),
    group("t-b", { type: "tree", direction: "right", rankGap: 30, siblingGap: 10 }, [leaf("b")]),
  ]);
  const placed = layoutScene(tree);
  assert.equal(boxOf(placed, "root").y, 0);
  assert.deepEqual([boxOf(placed, "a").x, boxOf(placed, "b").x], [130, 130]);
  assert.deepEqual([boxOf(placed, "a").y, boxOf(placed, "b").y], [0, 50]);
  assert.equal(boxOf(placed, "c").x, 260);
  assert.equal(placed.width, 360);
});

test("ein Kreis haelt zwischen Nachbarn mindestens den Abstand und beginnt oben", () => {
  const members = ["a", "b", "c", "d", "e"].map((key) => leaf(key, 120, 40));
  const placed = layoutScene(group("ring", { type: "circle", gap: 20 }, members));
  const centers = members.map((member) => {
    const box = boxOf(placed, member.key);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  const diagonal = Math.hypot(120, 40);
  for (let index = 0; index < centers.length; index += 1) {
    const next = centers[(index + 1) % centers.length];
    assert.ok(Math.hypot(next.x - centers[index].x, next.y - centers[index].y) >= diagonal + 20 - 0.01);
  }
  assert.ok(centers.every((center) => center.y >= centers[0].y));
  assert.ok(placed.boxes.every((box) => box.x >= 0 && box.y >= 0));
});

test("ein Rahmen umschliesst seine Kinder mit Rand und Platz fuer die Beschriftung", () => {
  const framed = layoutScene(group("g", { type: "stack", axis: "h", gap: 0 }, [leaf("a")], { label: "Runde", outline: true }), 500, 200);
  const frame = framed.frames[0];
  assert.deepEqual([frame.x, frame.y, frame.label, frame.outline], [500, 200, "Runde", true]);
  assert.equal(boxOf(framed, "a").x, 500 + FRAME_PADDING);
  assert.equal(boxOf(framed, "a").y, 200 + FRAME_PADDING + FRAME_LABEL_HEIGHT);
  assert.equal(frame.width, 100 + 2 * FRAME_PADDING);
  assert.equal(frame.height, 40 + 2 * FRAME_PADDING + FRAME_LABEL_HEIGHT);
});

test("eine Beschriftung ohne Rahmen kostet nur die Zeile ueber den Kindern", () => {
  const captioned = layoutScene(group("g", { type: "stack", axis: "h", gap: 0 }, [leaf("a")], { label: "Runde", outline: false }), 500, 200);
  assert.equal(captioned.frames[0].outline, false);
  assert.equal(boxOf(captioned, "a").x, 500);
  assert.equal(boxOf(captioned, "a").y, 200 + FRAME_LABEL_HEIGHT);
  assert.deepEqual([captioned.width, captioned.height], [100, 40 + FRAME_LABEL_HEIGHT]);

  const bare = layoutScene(group("g", { type: "stack", axis: "h", gap: 0 }, [leaf("a")]));
  assert.equal(bare.frames.length, 0);
  assert.deepEqual([bare.width, bare.height], [100, 40]);
});

test("Linien enden an der Kontur von Rechteck, Kreis und Raute", () => {
  const left = { box: { key: "l", x: 0, y: 0, width: 100, height: 40 }, boundary: "rect" as const };
  const rectToRect = lineGeometry(left, { box: { key: "r", x: 300, y: 0, width: 100, height: 40 }, boundary: "rect" as const });
  assert.equal(rectToRect.x1, 103);
  assert.equal(rectToRect.x2, 297);
  assert.equal(rectToRect.y1, 20);

  const toCircle = lineGeometry(left, { box: { key: "c", x: 300, y: 0, width: 120, height: 120 }, boundary: "circle" as const });
  const circleCenter = { x: 360, y: 60 };
  assert.ok(Math.abs(Math.hypot(toCircle.x2 - circleCenter.x, toCircle.y2 - circleCenter.y) - 63) < 0.01);

  const toDiamond = lineGeometry(left, { box: { key: "d", x: 300, y: -55, width: 150, height: 150 }, boundary: "diamond" as const });
  const diamondCenter = { x: 375, y: 20 };
  assert.ok(Math.abs(toDiamond.x2 - (diamondCenter.x - 75 - 3)) < 0.01);
  assert.equal(toDiamond.y2, 20);
});

test("der Parser nimmt ein vollstaendiges Layout an und normalisiert Handles", () => {
  const layout = canvasLayoutOf({
    nodes: [
      { id: "runde", group: "circle", label: "Diskussion" },
      { entity: "@Anna", parent: "runde" },
      { entity: "@bert", parent: "runde" },
      { entity: "shape:thema", parent: "runde" },
      { id: "kette", group: "wrap-h", width: 900 },
      { entity: "app:zaehler", parent: "kette" },
    ],
    shapes: [{ id: "thema", kind: "circle", text: "Thema" }],
    lines: [{ from: "@anna", to: "shape:thema", arrow: "end", label: "spricht" }],
  });
  assert.equal(layout.nodes.length, 6);
  assert.deepEqual(layout.nodes[1], { entity: "@anna", parent: "runde" });
  assert.deepEqual(layout.lines[0], { from: "@anna", to: "shape:thema", arrow: "end", style: "solid", label: "spricht" });
  assert.deepEqual(layout.shapes[0], { id: "thema", kind: "circle", text: "Thema", size: 120 });
  assert.deepEqual(layout.nodes[0], { id: "runde", group: "circle", label: "Diskussion", frame: false });
  assert.deepEqual(canvasLayoutOf({ nodes: [{ id: "box", group: "v", frame: true }] }).nodes[0], { id: "box", group: "v", frame: true });
  assert.throws(() => canvasLayoutOf({ nodes: [{ id: "box", group: "v", frame: "ja" }] }), /frame muss true oder false/);
});

test("der Parser nennt die erste Verletzung", () => {
  const rejects = (value: unknown, pattern: RegExp) => assert.throws(() => canvasLayoutOf(value), pattern);
  rejects({ nodes: [{ id: "w", group: "wrap-h" }] }, /width/);
  rejects({ nodes: [{ id: "w", group: "wrap-v" }] }, /height/);
  rejects({ nodes: [{ id: "g", group: "grid" }] }, /columns/);
  rejects({ nodes: [{ id: "t", group: "tree" }] }, /root/);
  rejects({ nodes: [{ id: "t", group: "tree", root: "shape:x" }] }, /Wurzel/);
  rejects({ nodes: [{ id: "h", group: "h", width: 300 }] }, /wrap-h/);
  rejects({ nodes: [{ entity: "@a", parent: "nirgends" }] }, /keine bekannte Gruppe/);
  rejects({ nodes: [{ id: "a", group: "h", parent: "b" }, { id: "b", group: "v", parent: "a" }] }, /in sich selbst/);
  rejects({ nodes: [{ id: "t", group: "tree", root: "@r" }, { entity: "@a", parent: "t" }] }, /Baum/);
  rejects({ nodes: [{ entity: "@a" }, { entity: "@A" }] }, /mehr als einmal/);
  rejects({ nodes: [{ entity: "shape:x" }] }, /nicht in shapes definiert/);
  rejects({ nodes: [], shapes: [{ id: "x", kind: "circle", text: "T" }] }, /nirgends platziert/);
  rejects({ nodes: [], lines: [{ from: "@a", to: "@a" }] }, /ANDEREN/);
  rejects({ nodes: [{ entity: "irgendwas" }] }, /@handle, shape:<id> oder app:<id>/);
  rejects({ nodes: [{ id: "g", group: "ring" }] }, /unbekannt/);
});

const actor = (id: string, handle: string, extra: Partial<RunActor> = {}): RunActor => ({
  id,
  kind: "agent",
  handle,
  displayName: handle,
  grants: [],
  createdAt: `2026-09-03T10:00:0${id.length}Z`,
  ...extra,
});

const viewWith = (actors: RunActor[]): RunView => ({
  id: "run-1",
  revision: 1,
  title: "Test",
  ownerId: "human",
  primaryActorId: "k",
  createdAt: "2026-09-03T10:00:00Z",
  forkedFrom: null,
  actors,
  inputs: [],
  turns: [],
  subscriptions: [],
  pluginStates: [],
  actions: [],
  artifacts: [],
});

const cast = viewWith([
  actor("human", "owner", { kind: "human" }),
  actor("k", "koordinator"),
  actor("a1", "anna", { createdBy: "k" }),
  actor("b1", "bert", { createdBy: "k" }),
  actor("s1", "router", { kind: "script", createdBy: "a1" }),
]);

const size = () => ({ width: 200, height: 44 });

test("ohne Layout bilden die Actors Abstammungsbaeume, der Mensch bleibt im Chat", () => {
  const scene = buildScene({ view: cast, actorSize: size, apps: [] });
  assert.deepEqual(scene.notices, []);
  assert.equal(scene.leaves.size, 4);
  const placed = layoutScene(scene.root);
  const koordinator = placed.boxes.find((box) => box.key === "actor:k")!;
  const anna = placed.boxes.find((box) => box.key === "actor:a1")!;
  const bert = placed.boxes.find((box) => box.key === "actor:b1")!;
  const router = placed.boxes.find((box) => box.key === "actor:s1")!;
  assert.equal(anna.x, bert.x);
  assert.ok(anna.x > koordinator.x);
  assert.ok(router.x > anna.x);
  assert.equal(placed.frames.length, 0);
});

test("eine geankerte App haengt unter ihrer Actor-Karte, eine ohne Anker in der Restzeile", () => {
  const apps = [
    { key: "app-anna", id: "zaehler", width: 300, height: 200, anchorActorId: "a1" },
    { key: "app-lose", id: "notizen", width: 300, height: 200, anchorActorId: "nirgends" },
  ];
  const scene = buildScene({ view: cast, actorSize: size, apps });
  const placed = layoutScene(scene.root);
  const anna = placed.boxes.find((box) => box.key === "actor:a1")!;
  const anchored = placed.boxes.find((box) => box.key === "app-anna")!;
  const loose = placed.boxes.find((box) => box.key === "app-lose")!;
  assert.equal(anchored.x, anna.x);
  assert.ok(anchored.y > anna.y);
  assert.ok(loose.y > anchored.y + anchored.height);

  const placedElsewhere = buildScene({ view: cast, layout: canvasLayoutOf({ nodes: [{ entity: "app:zaehler" }] }), actorSize: size, apps });
  const boxes = layoutScene(placedElsewhere.root).boxes;
  assert.equal(boxes.filter((box) => box.key === "app-anna").length, 1);
  assert.deepEqual(placedElsewhere.notices, []);
});

test("ein Layout platziert Actors, Formen und Linien; der Rest landet beschriftet darunter", () => {
  const layout = canvasLayoutOf({
    nodes: [
      { id: "runde", group: "circle", label: "Runde" },
      { entity: "@anna", parent: "runde" },
      { entity: "@bert", parent: "runde" },
      { entity: "shape:thema", parent: "runde" },
    ],
    shapes: [{ id: "thema", kind: "diamond", text: "Thema" }],
    lines: [{ from: "@anna", to: "@bert", arrow: "both" }, { from: "@koordinator", to: "shape:thema" }],
  });
  const scene = buildScene({ view: cast, layout, actorSize: size, apps: [{ key: "app-1", id: "zaehler", width: 300, height: 200 }] });
  assert.deepEqual(scene.notices, []);
  assert.equal(scene.lines.length, 2);
  assert.deepEqual(scene.lines.map((line) => [line.fromKey, line.toKey]), [["actor:a1", "actor:b1"], ["actor:k", "shape:thema"]]);
  const placed = layoutScene(scene.root);
  assert.deepEqual(placed.frames.map((frame) => frame.label), ["Runde", UNPLACED_LABEL]);
  const ring = placed.frames[0];
  const rest = placed.frames[1];
  assert.ok(rest.y >= ring.y + ring.height);
  assert.ok(placed.boxes.some((box) => box.key === "app-1"));
  assert.ok(placed.boxes.some((box) => box.key === "shape:thema"));
});

test("ein Baum im Layout nimmt die Abstammung der Wurzel auf", () => {
  const layout = canvasLayoutOf({ nodes: [{ id: "team", group: "tree", root: "@anna", direction: "down", frame: true }] });
  const scene = buildScene({ view: cast, layout, actorSize: size, apps: [] });
  const placed = layoutScene(scene.root);
  const anna = placed.boxes.find((box) => box.key === "actor:a1")!;
  const router = placed.boxes.find((box) => box.key === "actor:s1")!;
  assert.equal(anna.x, router.x);
  assert.ok(router.y > anna.y);
  assert.deepEqual(placed.frames.map((frame) => frame.key), ["group:team", "auto"]);
});

test("unbekannte Entitaeten bleiben sichtbar und werden gemeldet", () => {
  const layout = canvasLayoutOf({
    nodes: [{ id: "row", group: "h" }, { entity: "@niemand", parent: "row" }, { entity: "app:fehlt", parent: "row" }],
    lines: [{ from: "@anna", to: "@niemand" }],
  });
  const scene = buildScene({ view: cast, layout, layoutProblem: undefined, actorSize: size, apps: [] });
  assert.equal(scene.notices.length, 3);
  assert.match(scene.notices[0], /@niemand ist kein Actor/);
  assert.match(scene.notices[1], /app:fehlt ist keine App/);
  assert.match(scene.notices[2], /Linie @anna nach @niemand/);
  assert.equal(scene.lines.length, 0);
  assert.ok(scene.leaves.has("missing:@niemand"));

  const broken = buildScene({ view: cast, layoutProblem: "nodes fehlt", actorSize: size, apps: [] });
  assert.deepEqual(broken.notices, ["Layout unlesbar: nodes fehlt"]);
});

const assertSeparated = (placed: ReturnType<typeof layoutScene>, gap: number) => {
  for (let index = 0; index < placed.boxes.length; index += 1) {
    const box = placed.boxes[index];
    assert.ok(box.width > 0 && box.height > 0);
    assert.ok(box.x >= placed.x - 0.01 && box.y >= placed.y - 0.01);
    assert.ok(box.x + box.width <= placed.x + placed.width + 0.01);
    assert.ok(box.y + box.height <= placed.y + placed.height + 0.01);
    for (const other of placed.boxes.slice(index + 1)) {
      const dx = Math.max(0, other.x - box.x - box.width, box.x - other.x - other.width);
      const dy = Math.max(0, other.y - box.y - box.height, box.y - other.y - other.height);
      assert.ok(Math.hypot(dx, dy) >= gap - 0.01, `${box.key} und ${other.key} benötigen mindestens ${gap} Abstand`);
    }
  }
};

test("Actor- und App-Nachmessungen verschieben Nachbarn und geben beim Schrumpfen den Platz wieder frei", () => {
  const measure = (expanded: boolean) => {
    const scene = buildScene({
      view: cast,
      actorSize: (actor) => actor.id === "a1" && expanded ? { width: 480, height: 250 } : size(),
      apps: [
        { key: "app-anna", id: "zaehler", anchorActorId: "a1", width: expanded ? 640 : 260, height: expanded ? 330 : 120 },
        { key: "app-lose", id: "notizen", width: expanded ? 820 : 220, height: expanded ? 450 : 100 },
      ],
    });
    assert.deepEqual(scene.notices, []);
    const placed = layoutScene(scene.root);
    const anna = boxOf(placed, "actor:a1");
    const anchored = boxOf(placed, "app-anna");
    const loose = boxOf(placed, "app-lose");
    const bert = boxOf(placed, "actor:b1");
    const router = boxOf(placed, "actor:s1");
    assert.equal(anchored.x, anna.x);
    assert.equal(anchored.y, anna.y + anna.height + ANCHORED_GAP);
    assert.ok(router.x >= anna.x + Math.max(anna.width, anchored.width) + RANK_GAP);
    assert.ok(bert.y >= anchored.y + anchored.height + DEFAULT_GAP);
    assert.ok(loose.y >= Math.max(...placed.boxes.filter((box) => box.key !== loose.key).map((box) => box.y + box.height)) + DEFAULT_GAP);
    assertSeparated(placed, ANCHORED_GAP);
    assert.equal(placed.boxes.length, 6);
    return placed;
  };
  const initial = measure(false);
  const expanded = measure(true);
  assert.ok(expanded.width > initial.width && expanded.height > initial.height);
  assert.ok(boxOf(expanded, "actor:b1").y > boxOf(initial, "actor:b1").y);
  assert.ok(boxOf(expanded, "actor:s1").x > boxOf(initial, "actor:s1").x);
  assert.deepEqual(measure(false), initial);
});

test("Nachmessungen aktualisieren verschachtelte Rahmen und Linien an den neuen Kartenkonturen", () => {
  const view = viewWith([actor("a1", "anna"), actor("b1", "bert")]);
  const layout = canvasLayoutOf({
    nodes: [
      { id: "outer", group: "v", label: "Außen", frame: true },
      { id: "inner", group: "h", label: "Innen", frame: true, parent: "outer" },
      { entity: "@anna", parent: "inner" }, { entity: "@bert", parent: "inner" },
      { entity: "app:notizen", parent: "outer" },
    ],
    lines: [{ from: "@anna", to: "@bert" }],
  });
  const measure = (expanded: boolean) => {
    const scene = buildScene({
      view, layout,
      actorSize: (actor) => ({ width: actor.id === "a1" && expanded ? 420 : 200, height: expanded ? 220 : 44 }),
      apps: [{ key: "notes", id: "notizen", width: expanded ? 800 : 240, height: expanded ? 280 : 90 }],
    });
    const placed = layoutScene(scene.root, 80, 120);
    const outer = placed.frames.find((frame) => frame.key === "group:outer")!;
    const inner = placed.frames.find((frame) => frame.key === "group:inner")!;
    const anna = boxOf(placed, "actor:a1");
    const bert = boxOf(placed, "actor:b1");
    const notes = boxOf(placed, "notes");
    assert.equal(inner.x, outer.x + FRAME_PADDING);
    assert.equal(inner.y, outer.y + FRAME_PADDING + FRAME_LABEL_HEIGHT);
    assert.equal(anna.x, inner.x + FRAME_PADDING);
    assert.equal(anna.y, inner.y + FRAME_PADDING + FRAME_LABEL_HEIGHT);
    assert.equal(inner.width, anna.width + bert.width + DEFAULT_GAP + 2 * FRAME_PADDING);
    assert.equal(inner.height, anna.height + 2 * FRAME_PADDING + FRAME_LABEL_HEIGHT);
    assert.equal(notes.y, inner.y + inner.height + DEFAULT_GAP);
    assert.equal(outer.width, Math.max(inner.width, notes.width) + 2 * FRAME_PADDING);
    assert.equal(outer.y + outer.height, notes.y + notes.height + FRAME_PADDING);
    const line = scene.lines[0];
    const geometry = lineGeometry(
      { box: boxOf(placed, line.fromKey), boundary: boundaryOf(scene.leaves.get(line.fromKey)!) },
      { box: boxOf(placed, line.toKey), boundary: boundaryOf(scene.leaves.get(line.toKey)!) },
    );
    assert.equal(geometry.x1, anna.x + anna.width + 3);
    assert.equal(geometry.x2, bert.x - 3);
    assert.equal(geometry.y1, anna.y + anna.height / 2);
    assert.equal(geometry.y2, bert.y + bert.height / 2);
    assertSeparated(placed, DEFAULT_GAP);
    return { placed, geometry };
  };
  const initial = measure(false);
  const expanded = measure(true);
  assert.ok(expanded.placed.width > initial.placed.width && expanded.placed.height > initial.placed.height);
  assert.ok(expanded.geometry.x1 > initial.geometry.x1 && expanded.geometry.y1 > initial.geometry.y1);
  assert.deepEqual(measure(false), initial);
});

for (const mode of ["h", "v", "wrap-h", "wrap-v", "grid", "circle", "tree-right", "tree-down"] as const) {
  test(`${mode} hält bei unterschiedlichen Messgrößen nach Wachstum und Schrumpfen Abstand`, () => {
    const handles = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
    const view = viewWith(handles.map((handle, index) => actor(`member-${index}`, handle,
      index === 0 ? {} : { createdBy: `member-${Math.floor((index - 1) / 2)}` })));
    const tree = mode === "tree-right" || mode === "tree-down";
    const layout = canvasLayoutOf({ nodes: [
      {
        id: "members", group: tree ? "tree" : mode, gap: 24, frame: true, label: "Team",
        ...(mode === "wrap-h" ? { width: 560 } : {}),
        ...(mode === "wrap-v" ? { height: 430 } : {}),
        ...(mode === "grid" ? { columns: 3 } : {}),
        ...(tree ? { root: "@alpha", direction: mode === "tree-down" ? "down" : "right" } : {}),
      },
      ...(tree ? [] : handles.map((handle) => ({ entity: `@${handle}`, parent: "members" }))),
    ] });
    const compact = [[90, 45], [160, 60], [110, 85], [220, 75], [80, 120], [140, 50]];
    const grown = [[150, 110], [680, 200], [170, 180], [120, 620], [210, 140], [460, 320]];
    const measurements = [compact, grown, compact];
    const placed = measurements.map((sizes) => {
      const scene = buildScene({ view, layout, apps: [], actorSize: (actor) => {
        const dimensions = sizes[handles.indexOf(actor.handle)];
        return { width: dimensions[0], height: dimensions[1] };
      } });
      assert.deepEqual(scene.notices, []);
      const result = layoutScene(scene.root);
      assert.deepEqual(result.boxes.map((box) => box.key).sort(), view.actors.map((actor) => `actor:${actor.id}`).sort());
      assertSeparated(result, 24);
      return result;
    });
    assert.notDeepEqual(placed[1], placed[0]);
    assert.deepEqual(placed[2], placed[0]);
  });
}

for (const axis of ["h", "v"] as const) {
  test(`Labelabstände im ${axis}-Stapel verwenden die passende Dimension und schrumpfen wieder`, () => {
    const root = group("labels", { type: "stack", axis, gap: 12 }, [leaf("a"), leaf("b")]);
    const initial = layoutScene(root);
    const distance = (placed: ReturnType<typeof layoutScene>) => axis === "h"
      ? boxOf(placed, "b").x - boxOf(placed, "a").x - boxOf(placed, "a").width
      : boxOf(placed, "b").y - boxOf(placed, "a").y - boxOf(placed, "a").height;
    const wide = { fromKey: "a", toKey: "b", width: 300, height: 20 };
    const tall = { fromKey: "b", toKey: "a", width: 40, height: 120 };
    const expanded = layoutScene(withLabelSpacing(root, [wide, tall]));
    assert.equal(distance(expanded), (axis === "h" ? 300 : 120) + 64);
    assert.deepEqual(withLabelSpacing(root, [wide, tall]), withLabelSpacing(root, [tall, wide]));
    const smaller = layoutScene(withLabelSpacing(root, [{ ...wide, width: 60, height: 18 }]));
    assert.equal(distance(smaller), (axis === "h" ? 60 : 18) + 64);
    assert.ok(distance(smaller) < distance(expanded));
    assert.equal(withLabelSpacing(root, []), root);
    assert.deepEqual(layoutScene(root), initial);
    assert.deepEqual(layoutScene(withLabelSpacing(root, [])), initial);
    const spacious = group("spacious", { type: "stack", axis, gap: 600 }, [leaf("a"), leaf("b")]);
    assert.deepEqual(layoutScene(withLabelSpacing(spacious, [wide, tall])), layoutScene(spacious));
  });
}

for (const direction of ["right", "down"] as const) {
  test(`Baumlabels reservieren Rang- und Geschwisterabstand in Richtung ${direction}`, () => {
    const root = group("tree-labels", { type: "tree", direction, rankGap: 50, siblingGap: 20 }, [leaf("parent"), leaf("a"), leaf("b")]);
    const measured = layoutScene(withLabelSpacing(root, [{ fromKey: "parent", toKey: "a", width: 280, height: 36 }]));
    const parent = boxOf(measured, "parent");
    const a = boxOf(measured, "a");
    const b = boxOf(measured, "b");
    assert.equal(direction === "right" ? a.x - parent.x - parent.width : a.y - parent.y - parent.height, (direction === "right" ? 280 : 36) + 64);
    assert.equal(direction === "right" ? b.y - a.y - a.height : b.x - a.x - a.width, (direction === "right" ? 36 : 280) + 64);
    assertSeparated(measured, 100);
    const spacious = group("wide-tree", { type: "tree", direction, rankGap: 500, siblingGap: 700 }, root.children);
    assert.deepEqual(layoutScene(withLabelSpacing(spacious, [{ fromKey: "parent", toKey: "b", width: 280, height: 36 }])), layoutScene(spacious));
  });
}

for (const layout of [
  { type: "wrap", axis: "h", limit: 450, gap: 10 },
  { type: "wrap", axis: "v", limit: 450, gap: 10 },
  { type: "grid", columns: 2, gap: 10 },
  { type: "circle", gap: 10 },
] satisfies SceneGroup["layout"][]) {
  test(`${layout.type}${"axis" in layout ? `-${layout.axis}` : ""} reserviert die größere Labeldimension`, () => {
    const root = group("labels", layout, [leaf("a"), leaf("b", 150, 65), leaf("c", 80, 95)]);
    for (const size of [{ width: 320, height: 180 }, { width: 60, height: 340 }]) {
      const adjusted = withLabelSpacing(root, [{ fromKey: "a", toKey: "b", ...size }]);
      assertSeparated(layoutScene(adjusted), Math.max(size.width, size.height) + 64);
    }
    assert.deepEqual(withLabelSpacing(root, []), root);
  });
}

test("nur die kleinste gemeinsame Gruppe erhält Labelraum; fremde und fehlende Endpunkte ändern keine Abstände", () => {
  const inner = group("inner", { type: "stack", axis: "h", gap: 15 }, [leaf("a"), leaf("b")], { label: "Innen", outline: true });
  const left = group("left", { type: "stack", axis: "v", gap: 25 }, [inner, leaf("e")]);
  const right = group("right", { type: "stack", axis: "v", gap: 35 }, [leaf("c"), leaf("d")]);
  const root = group("root", { type: "stack", axis: "h", gap: 45 }, [left, right]);
  const baseline = layoutScene(root);
  const local = { fromKey: "a", toKey: "b", width: 260, height: 28 };
  const internal = withLabelSpacing(root, [local]);
  assert.equal(internal.kind, "group");
  if (internal.kind !== "group") return;
  assert.deepEqual(internal.layout, root.layout);
  assert.deepEqual(internal.children[1], right);
  const updatedLeft = internal.children[0];
  assert.equal(updatedLeft.kind, "group");
  if (updatedLeft.kind !== "group") return;
  assert.deepEqual(updatedLeft.layout, left.layout);
  const placed = layoutScene(internal);
  assert.equal(boxOf(placed, "b").x - boxOf(placed, "a").x - boxOf(placed, "a").width, 324);
  assert.equal(boxOf(placed, "d").y - boxOf(placed, "c").y - boxOf(placed, "c").height, 35);
  assert.ok(placed.frames[0].width > baseline.frames[0].width);
  const crossing = withLabelSpacing(root, [local, { fromKey: "a", toKey: "c", width: 410, height: 50 }]);
  assert.equal(crossing.kind, "group");
  if (crossing.kind !== "group") return;
  assert.deepEqual(crossing.layout, { type: "stack", axis: "h", gap: 474 });
  assert.deepEqual(crossing.children, internal.children);
  assert.deepEqual(withLabelSpacing(root, [local]), internal);
  assert.deepEqual(withLabelSpacing(root, [
    { fromKey: "a", toKey: "a", width: 1000, height: 1000 },
    { fromKey: "a", toKey: "missing", width: 1000, height: 1000 },
  ]), root);
  assert.deepEqual(layoutScene(withLabelSpacing(root, [])), baseline);
});

const appCards = (count: number, prefix = "app", anchorActorId?: string) => Array.from({ length: count }, (_, index) => ({
  key: `${prefix}-${index}`, id: `${prefix}-${index}`, width: 640, height: 320,
  ...(anchorActorId ? { anchorActorId } : {}),
}));

test("a run containing only apps lays out large windows in several columns", () => {
  const apps = appCards(6);
  const scene = buildScene({ view: viewWith([]), actorSize: size, apps });
  const placed = layoutScene(scene.root);
  assert.equal(placed.boxes.length, 6);
  assert.equal(new Set(placed.boxes.map((box) => box.x)).size, 3);
  assert.equal(new Set(placed.boxes.map((box) => box.y)).size, 2);
  assertSeparated(placed, DEFAULT_GAP);
  assert.deepEqual(scene.notices, []);
});

test("an actor-only manual layout retains two automatic app groups without overlaps", () => {
  const apps = [...appCards(4, "anchored", "a1"), ...appCards(5, "loose")];
  const layout = canvasLayoutOf({ nodes: [{ entity: "@anna" }, { entity: "@bert" }] });
  const scene = buildScene({ view: cast, layout, actorSize: size, apps });
  const placed = layoutScene(scene.root);
  assert.equal([...scene.leaves.values()].filter((info) => info.type === "app").length, 9);
  assert.equal(boxOf(placed, "anchored-0").y, boxOf(placed, "actor:a1").y + size().height + ANCHORED_GAP);
  assert.equal(boxOf(placed, "anchored-0").y, boxOf(placed, "anchored-1").y);
  assert.equal(boxOf(placed, "loose-0").y, boxOf(placed, "loose-2").y);
  assertSeparated(placed, ANCHORED_GAP);
  assert.deepEqual(scene.notices, []);
});

test("explicit app placement takes precedence over automatic actor anchoring", () => {
  const apps = appCards(3, "anchored", "a1");
  const layout = canvasLayoutOf({ nodes: [
    { entity: "@anna" }, { id: "chosen", group: "v", gap: 70 },
    { entity: "app:anchored-2", parent: "chosen" }, { entity: "app:anchored-0", parent: "chosen" },
  ] });
  const scene = buildScene({ view: cast, layout, actorSize: size, apps });
  const placed = layoutScene(scene.root);
  assert.equal(boxOf(placed, "anchored-1").y, boxOf(placed, "actor:a1").y + size().height + ANCHORED_GAP);
  assert.equal(boxOf(placed, "anchored-0").y - boxOf(placed, "anchored-2").y, 390);
  assert.equal(boxOf(placed, "anchored-0").x, boxOf(placed, "anchored-2").x);
  assert.equal(placed.boxes.filter((box) => box.key.startsWith("anchored-")).length, 3);
  assertSeparated(placed, ANCHORED_GAP);
});

test("hiding a manually placed app removes its box and connections without missing placeholders", () => {
  const apps = appCards(4);
  const layout = canvasLayoutOf({ nodes: [{ entity: "@anna" }, { entity: "app:app-0" }], lines: [{ from: "@anna", to: "app:app-0" }] });
  const input = { view: cast, layout, actorSize: size, apps };
  const visible = buildScene(input);
  assert.equal(visible.lines.length, 1);
  const hidden = buildScene({ ...input, apps: apps.slice(1), hiddenAppIds: ["app-0"] });
  assert.equal(hidden.leaves.has("app-0"), false);
  assert.equal(hidden.leaves.has("missing:app:app-0"), false);
  assert.deepEqual(hidden.lines, []);
  assert.deepEqual(hidden.notices, []);
  assert.equal([...hidden.leaves.values()].filter((info) => info.type === "app").length, 3);
  assertSeparated(layoutScene(hidden.root), ANCHORED_GAP);
  assert.deepEqual(layoutScene(buildScene(input).root), layoutScene(visible.root));
});

test("stopping an app owner removes known view nodes, their lines and empty groups without missing placeholders", () => {
  const app = { key: "wizard", id: "balcony--wizard", width: 400, height: 280, anchorActorId: "a1" };
  const view = viewWith([actor("k", "coordinator"), actor("a1", "advisor")]);
  view.pluginStates.push({
    pluginId: "ragents.actor-programs", scope: { kind: "actor", actorId: "a1" },
    state: { version: 1, program: { actorId: "a1", views: [{ id: app.id }] } },
  });
  const layout = canvasLayoutOf({
    nodes: [{ id: "wizard-group", group: "v", frame: true, label: "Wizard" }, { entity: `app:${app.id}`, parent: "wizard-group" }],
    lines: [{ from: "@coordinator", to: `app:${app.id}` }],
  });
  const active = buildScene({ view, layout, actorSize: size, apps: [app] });
  assert.equal(active.lines.length, 1);
  assert.deepEqual(active.notices, []);
  const stoppedView = { ...view, actors: view.actors.map((member) => member.id === "a1"
    ? { ...member, lifecycle: { kind: "stopped" as const, stoppedAt: "2026-09-12T12:00:00Z", reason: "Run stopped" } } : member) };
  const stopped = buildScene({ view: stoppedView, layout, actorSize: size, apps: [] });
  assert.equal(stopped.leaves.has("wizard"), false);
  assert.equal(stopped.leaves.has(`missing:app:${app.id}`), false);
  assert.deepEqual(stopped.lines, []);
  assert.deepEqual(stopped.notices, []);
  assert.equal(layoutScene(stopped.root).frames.some((frame) => frame.key === "group:wizard-group"), false);
  assert.equal(stopped.leaves.has("actor:a1"), true);

  const unknownLayout = canvasLayoutOf({ nodes: [{ entity: "app:unknown" }], lines: [{ from: "@coordinator", to: "app:unknown" }] });
  const unknown = buildScene({ view: stoppedView, layout: unknownLayout, actorSize: size, apps: [] });
  assert.equal(unknown.leaves.has("missing:app:unknown"), true);
  assert.equal(unknown.notices.length, 2);

  const unavailableActive = buildScene({ view, layout, actorSize: size, apps: [] });
  assert.equal(unavailableActive.notices.length, 2);
  const replacement = buildScene({ view: stoppedView, layout, actorSize: size, apps: [{ ...app, anchorActorId: "k" }] });
  assert.equal(replacement.leaves.has("wizard"), true);
  assert.equal(replacement.lines.length, 1);
  assert.deepEqual(replacement.notices, []);
});

test("hiding an explicitly placed actor keeps its app in that position without reserving card space", () => {
  const view = viewWith([actor("a1", "anna"), actor("b1", "bert")]);
  const originalView = structuredClone(view);
  const apps = appCards(1, "anchored", "a1");
  const layout = canvasLayoutOf({ nodes: [
    { id: "row", group: "h" }, { entity: "@anna", parent: "row" }, { entity: "@bert", parent: "row" },
  ] });
  const input = { view, layout, actorSize: size, apps };
  const visible = layoutScene(buildScene(input).root);
  const measured: string[] = [];
  const scene = buildScene({ ...input, hiddenActorIds: ["a1"], actorSize: (member) => {
    measured.push(member.id);
    return size();
  } });
  const placed = layoutScene(scene.root);
  const app = boxOf(placed, "anchored-0");
  assert.deepEqual([...scene.leaves.keys()], ["anchored-0", "actor:b1"]);
  assert.deepEqual(measured, ["b1"]);
  assert.equal(app.x, 0);
  assert.equal(app.y, 0);
  assert.equal(placed.height, apps[0].height);
  assert.equal(boxOf(placed, "actor:b1").x, app.width + DEFAULT_GAP);
  assert.deepEqual(scene.notices, []);
  assertSeparated(placed, DEFAULT_GAP);
  assert.deepEqual(view, originalView);
  assert.deepEqual(layoutScene(buildScene(input).root), visible);
});

test("automatic lineage keeps descendants reachable through hidden roots and intermediate actors", () => {
  for (const hiddenActorIds of [["k"], ["a1"], ["k", "a1"]]) {
    const apps = appCards(1, "anchored", "a1");
    const scene = buildScene({ view: cast, actorSize: size, apps, hiddenActorIds });
    const placed = layoutScene(scene.root);
    const visibleIds = cast.actors.filter((member) => member.kind !== "human" && !hiddenActorIds.includes(member.id)).map((member) => member.id);
    assert.deepEqual([...scene.leaves.values()].flatMap((info) => info.type === "actor" ? [info.actor.id] : []).sort(), visibleIds.sort());
    assert.equal(placed.boxes.filter((box) => box.key === "anchored-0").length, 1);
    assert.equal(placed.boxes.filter((box) => box.key === "actor:s1").length, 1);
    assert.ok(boxOf(placed, "actor:s1").x > boxOf(placed, "anchored-0").x);
    assert.deepEqual(scene.notices, []);
    assertSeparated(placed, ANCHORED_GAP);
  }
});

test("an explicit hidden tree root retains its app and descendants inside the selected frame", () => {
  const view = viewWith([actor("a1", "anna"), actor("s1", "router", { kind: "script", createdBy: "a1" })]);
  const apps = appCards(1, "anchored", "a1");
  const layout = canvasLayoutOf({ nodes: [{ id: "team", group: "tree", root: "@anna", direction: "down", frame: true, label: "Team" }] });
  const scene = buildScene({ view, layout, actorSize: size, apps, hiddenActorIds: ["a1"] });
  const placed = layoutScene(scene.root);
  assert.deepEqual([...scene.leaves.keys()], ["anchored-0", "actor:s1"]);
  assert.deepEqual(placed.frames.map((frame) => frame.key), ["group:team"]);
  const app = boxOf(placed, "anchored-0");
  const child = boxOf(placed, "actor:s1");
  assert.equal(app.y, FRAME_PADDING + FRAME_LABEL_HEIGHT);
  assert.equal(child.y, app.y + app.height + RANK_GAP);
  assert.deepEqual(scene.notices, []);
  assertSeparated(placed, DEFAULT_GAP);
});

test("explicit trees collapse hidden ancestors without losing or adding space before visible descendants", () => {
  const view = viewWith([
    actor("k", "koordinator"), actor("a1", "anna", { createdBy: "k" }),
    actor("b1", "bert", { createdBy: "k" }), actor("s1", "router", { createdBy: "a1", kind: "script" }),
  ]);
  for (const direction of ["right", "down"] as const) {
    const layout = canvasLayoutOf({ nodes: [{ id: "team", group: "tree", root: "@koordinator", direction, frame: true }] });
    const scene = buildScene({ view, layout, actorSize: size, apps: [], hiddenActorIds: ["k", "a1"] });
    const placed = layoutScene(scene.root);
    assert.deepEqual([...scene.leaves.keys()].sort(), ["actor:b1", "actor:s1"]);
    assert.deepEqual(placed.frames.map((frame) => frame.key), ["group:team"]);
    const bert = boxOf(placed, "actor:b1");
    const router = boxOf(placed, "actor:s1");
    if (direction === "right") {
      assert.equal(bert.x, FRAME_PADDING);
      assert.equal(router.x, FRAME_PADDING);
      assert.equal(Math.abs(bert.y - router.y), size().height + DEFAULT_GAP);
    } else {
      assert.equal(bert.y, FRAME_PADDING);
      assert.equal(router.y, FRAME_PADDING);
      assert.equal(Math.abs(bert.x - router.x), size().width + DEFAULT_GAP);
    }
    assert.deepEqual(scene.notices, []);
    assertSeparated(placed, DEFAULT_GAP);
  }
});

test("apps explicitly placed elsewhere are not duplicated when their actor is hidden", () => {
  const apps = appCards(3, "anchored", "a1");
  const layout = canvasLayoutOf({ nodes: [
    { entity: "@anna" }, { id: "chosen", group: "v", gap: 70 },
    { entity: "app:anchored-2", parent: "chosen" }, { entity: "app:anchored-0", parent: "chosen" },
  ] });
  const scene = buildScene({ view: cast, layout, actorSize: size, apps, hiddenActorIds: ["a1"] });
  const placed = layoutScene(scene.root);
  assert.equal(scene.leaves.has("actor:a1"), false);
  assert.equal(boxOf(placed, "anchored-1").y, 0);
  assert.equal(boxOf(placed, "anchored-0").y - boxOf(placed, "anchored-2").y, apps[0].height + 70);
  assert.equal(boxOf(placed, "anchored-0").x, boxOf(placed, "anchored-2").x);
  for (const app of apps) assert.equal(placed.boxes.filter((box) => box.key === app.key).length, 1);
  assert.equal(placed.boxes.filter((box) => box.key === "actor:s1").length, 1);
  assert.deepEqual(scene.notices, []);
  assertSeparated(placed, DEFAULT_GAP);
});

test("connections to hidden actors disappear while unknown references still produce notices", () => {
  const layout = canvasLayoutOf({
    nodes: [{ entity: "@anna" }, { entity: "@bert" }, { entity: "@unknown" }],
    lines: [
      { from: "@anna", to: "@bert" }, { from: "@bert", to: "@anna" },
      { from: "app:anchored-0", to: "@bert" }, { from: "@bert", to: "@unknown" },
    ],
  });
  const scene = buildScene({ view: cast, layout, actorSize: size, apps: appCards(1, "anchored", "a1"), hiddenActorIds: ["a1"] });
  assert.equal(scene.leaves.has("missing:@anna"), false);
  assert.equal(scene.leaves.has("missing:@unknown"), true);
  assert.deepEqual(scene.lines.map((line) => [line.fromKey, line.toKey]), [["anchored-0", "actor:b1"]]);
  assert.equal(scene.notices.length, 2);
  assert.match(scene.notices[0], /@unknown ist kein Actor/);
  assert.match(scene.notices[1], /Linie @bert nach @unknown/);
});

test("hiding a stopped actor does not hide the active replacement that owns the same handle", () => {
  const view = viewWith([
    actor("old", "anna", { lifecycle: { kind: "stopped", stoppedAt: "2026-09-03T11:00:00Z", reason: "removed" } }),
    actor("new", "anna"), actor("b1", "bert"),
  ]);
  const layout = canvasLayoutOf({ nodes: [{ entity: "@anna" }], lines: [{ from: "@anna", to: "@bert" }] });
  const scene = buildScene({ view, layout, actorSize: size, apps: [], hiddenActorIds: ["old"] });
  assert.deepEqual([...scene.leaves.keys()].sort(), ["actor:b1", "actor:new"]);
  assert.deepEqual(scene.lines.map((line) => [line.fromKey, line.toKey]), [["actor:new", "actor:b1"]]);
  assert.deepEqual(scene.notices, []);
});

test("turning connections off removes both lines and the extra space reserved for their labels", () => {
  const view = viewWith([actor("a1", "anna"), actor("b1", "bert")]);
  const nodes = [{ id: "row", group: "h" }, { entity: "@anna", parent: "row" }, { entity: "@bert", parent: "row" }];
  const layout = canvasLayoutOf({ nodes, lines: [{ from: "@anna", to: "@bert", label: "Ein langer Verbindungsname" }] });
  const input = { view, layout, actorSize: size, apps: [] };
  const placeLabels = (scene: ReturnType<typeof buildScene>) => layoutScene(withLabelSpacing(scene.root, scene.lines.map((line) => ({
    fromKey: line.fromKey, toKey: line.toKey, width: 360, height: 28,
  }))));
  const visible = buildScene(input);
  const hidden = buildScene({ ...input, showConnections: false });
  const baseline = layoutScene(buildScene({ ...input, layout: canvasLayoutOf({ nodes }) }).root);
  assert.equal(visible.lines.length, 1);
  assert.deepEqual(placeLabels(buildScene({ ...input, showConnections: true })), placeLabels(visible));
  assert.deepEqual(hidden.lines, []);
  assert.deepEqual(hidden.notices, []);
  assert.deepEqual(placeLabels(hidden), baseline);
  assert.ok(placeLabels(visible).width > baseline.width);
  assert.equal(boxOf(baseline, "actor:b1").x, size().width + DEFAULT_GAP);
});

test("hiding every actor leaves a genuinely empty scene even with explicit groups and trees", () => {
  const layouts = [undefined,
    canvasLayoutOf({ nodes: [{ id: "row", group: "h", frame: true, label: "Team" }, { entity: "@anna", parent: "row" }] }),
    canvasLayoutOf({ nodes: [{ id: "team", group: "tree", root: "@koordinator", direction: "down", frame: true }] }),
  ];
  for (const layout of layouts) {
    const scene = buildScene({ view: cast, layout, actorSize: size, apps: [], hiddenActorIds: ["k", "a1", "b1", "s1"] });
    const placed = layoutScene(scene.root);
    assert.equal(scene.leaves.size, 0);
    assert.deepEqual(scene.notices, []);
    assert.deepEqual(scene.lines, []);
    assert.deepEqual(placed.boxes, []);
    assert.deepEqual(placed.frames, []);
    assert.equal(placed.width, 0);
    assert.equal(placed.height, 0);
  }
});

test("automatic grids adapt to changing app sizes, additions and removals", () => {
  const apps = appCards(4);
  const original = layoutScene(buildScene({ view: viewWith([]), actorSize: size, apps }).root);
  const changed = apps.map((app, index) => ({ ...app, width: index === 0 ? 1100 : app.width, height: index === 2 ? 680 : app.height }));
  const expanded = layoutScene(buildScene({ view: viewWith([]), actorSize: size, apps: changed }).root);
  assert.ok(expanded.width > original.width);
  assert.ok(expanded.height > original.height);
  assertSeparated(expanded, DEFAULT_GAP);
  const reduced = layoutScene(buildScene({ view: viewWith([]), actorSize: size, apps: apps.slice(0, 2) }).root);
  assert.equal(new Set(reduced.boxes.map((box) => box.y)).size, 1);
  assert.ok(reduced.height < original.height);
  const added = layoutScene(buildScene({ view: viewWith([]), actorSize: size, apps: appCards(7) }).root);
  assert.equal(added.boxes.length, 7);
  assert.equal(new Set(added.boxes.map((box) => box.x)).size, 3);
  assertSeparated(added, DEFAULT_GAP);
});
