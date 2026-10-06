import assert from "node:assert/strict";
import test from "node:test";
import { activateAvailableDockTabs, activeDockTool, addDockEmptyPane, closeDockPanels, dockButtonPlacement, dockGroups, dockWindowOrder, emptyPanelId, focusedDockWindow, initialDockState, moveDockButton, moveDockPanels, moveDockWindow, parseDockState, persistentDockState, reconcileDockState, resizeDockSplit, revealDockPanel, transitionDockSide, returnDockTool, selectDockPanel, visibleDockState, workspaceTabPanelId, type DockState, type DockTarget } from "../src/run-panel/dock-state";
import { dockGeometry, dockHitTest, dockPreview, dockingGuides } from "../src/run-panel/dock-geometry";
import { dockStorageKey } from "../src/run-panel/dock-storage";

const initial = () => initialDockState(["chat", "app:notes", "app:board"], ["tool:files", "tool:journal"]);
let serial = 0;
const move = (state: DockState, ids: readonly string[], target: DockTarget) => moveDockPanels(state, ids, target, () => `node-${++serial}`);
const roundtrip = (state: DockState) => assert.deepEqual(parseDockState(JSON.stringify(state)), state);

test("automatic layouts split the first app beside chat and adapt to available width", () => {
  const panels = ["chat", "app:notes"];
  const split = reconcileDockState(initialDockState(), panels, [], true);
  assert.deepEqual(dockGroups(split.root).map((entry) => entry.tabs), [["chat"], ["app:notes"]]);
  assert.equal(split.root.kind === "split" && split.root.ratio, 0.5);
  assert.equal(split.focused, "main");
  const added = reconcileDockState(split, [...panels, "app:board"], [], true);
  assert.deepEqual(dockGroups(added.root).map((entry) => entry.tabs), [["chat"], ["app:notes", "app:board"]]);
  assert.equal(dockGroups(added.root)[1].active, "app:notes");
  const selected = selectDockPanel(added, "app:board");
  const narrow = reconcileDockState(selected, [...panels, "app:board"], [], false);
  assert.equal(narrow.root.kind, "group");
  assert.equal(dockGroups(narrow.root)[0].active, "app:board");
  const wide = reconcileDockState(narrow, [...panels, "app:board"], [], true);
  assert.equal(dockGroups(wide.root)[1].active, "app:board");
  assert.equal(reconcileDockState(wide, [...panels, "app:board"], [], true), wide);
  roundtrip(wide);
});

test("manual and existing saved layouts keep their arrangement across width and catalog changes", () => {
  const panels = ["chat", "app:notes"];
  const split = reconcileDockState(initialDockState(), panels, [], true);
  const resized = resizeDockSplit(split, split.root.id, 0.65);
  const narrow = reconcileDockState(resized, panels, [], false);
  assert.equal(narrow.root.kind === "split" && narrow.root.ratio, 0.65);
  const merged = move(split, ["app:notes"], { kind: "group", group: "main", side: "center" });
  assert.equal(reconcileDockState(merged, [...panels, "app:board"], [], true).root.kind, "group");
  const saved = parseDockState(JSON.stringify({ ...initialDockState(panels), automatic: undefined }));
  assert.equal(reconcileDockState(saved, panels, [], true), saved);
  const closed = closeDockPanels(split, ["app:notes"]);
  assert.deepEqual(reconcileDockState(closed, panels, [], true).closed, ["app:notes"]);
  roundtrip(narrow);
});

test("a single chat can split its own area, including all four compass directions", () => {
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const state = move(initialDockState(), ["chat"], { kind: "group", group: "main", side });
    assert.equal(state.root.kind, "split");
    const groups = dockGroups(state.root);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups.find((g) => g.id === "main")?.tabs, []);
    assert.deepEqual(groups.find((g) => g.active === "chat")?.tabs, ["chat"]);
    if (state.root.kind === "split") {
      assert.equal(state.root.ratio, 0.5);
      assert.equal(state.root.axis, side === "left" || side === "right" ? "horizontal" : "vertical");
    }
    roundtrip(state);
  }
});

test("a group grip merges all its tabs and collapses its source area", () => {
  const split = move(initial(), ["app:notes", "app:board"], { kind: "group", group: "main", side: "right" });
  const merged = move(split, ["app:notes", "app:board"], { kind: "group", group: "main", side: "center" });
  assert.deepEqual(dockGroups(merged.root).map((g) => g.tabs), [["chat", "app:notes", "app:board"]]);
  assert.equal(dockGroups(merged.root)[0].active, "app:notes");
  roundtrip(merged);
});

test("splitting another area removes an emptied source and preserves the target", () => {
  const split = move(initial(), ["app:notes"], { kind: "group", group: "main", side: "right" });
  const source = dockGroups(split.root).find((g) => g.active === "app:notes")!;
  const next = move(split, ["app:notes"], { kind: "group", group: "main", side: "bottom" });
  assert.equal(dockGroups(next.root).length, 2);
  assert.ok(!dockGroups(next.root).some((g) => g.id === source.id));
  roundtrip(next);
});

test("outer guides wrap the entire workspace at 35 percent and retain a sole emptied area", () => {
  const state = move(initialDockState(), ["chat"], { kind: "edge", side: "left" });
  assert.equal(state.root.kind === "split" && state.root.ratio, 0.35);
  assert.equal(dockGroups(state.root).length, 2);
  const nested = move(state, ["chat"], { kind: "edge", side: "bottom" });
  assert.equal(dockGroups(nested.root).length, 2);
  assert.equal(nested.root.kind === "split" && nested.root.ratio, 0.65);
  roundtrip(nested);
});

test("revealing a view opens a closed one, activates a background tab and leaves a visible one untouched", () => {
  const split = move(initial(), ["app:notes"], { kind: "group", group: "main", side: "right" });
  const notes = dockGroups(split.root).find((g) => g.tabs.includes("app:notes"))!.id;
  const reveal = (state: DockState, id: string, wide = true) => revealDockPanel(state, id, wide, () => `node-${++serial}`);
  assert.equal(reveal(split, "chat"), split);
  assert.equal(reveal(split, "app:notes"), split);
  const maximized = { ...split, maximized: "main" };
  assert.equal(reveal(maximized, "chat"), maximized);

  const background = reveal(split, "app:board");
  assert.deepEqual(dockGroups(background.root).map((g) => g.tabs), dockGroups(split.root).map((g) => g.tabs));
  assert.equal(dockGroups(background.root).find((g) => g.id === "main")?.active, "app:board");
  assert.equal(background.focused, "main");
  roundtrip(background);
  const hidden = reveal(maximized, "app:notes");
  assert.equal(hidden.maximized, notes);
  assert.equal(hidden.focused, notes);
  roundtrip(hidden);

  const closed = closeDockPanels(split, ["app:board"]);
  const beside = reveal(closed, "app:board");
  assert.equal(dockGroups(beside.root).length, 3);
  assert.equal(dockGroups(beside.root).find((g) => g.tabs.includes("app:board"))?.active, "app:board");
  assert.deepEqual(beside.closed, []);
  roundtrip(beside);
  const narrow = reveal(closed, "app:board", false);
  assert.deepEqual(dockGroups(narrow.root).find((g) => g.id === notes)?.tabs, ["app:notes", "app:board"]);
  assert.equal(dockGroups(narrow.root).find((g) => g.id === notes)?.active, "app:board");
  roundtrip(narrow);
});

test("closing an area closes all documents, returns tools, and preserves a final empty group", () => {
  const state = move(initial(), ["tool:files"], { kind: "group", group: "main", side: "center" });
  const closed = closeDockPanels(state, dockGroups(state.root)[0].tabs, "main");
  assert.deepEqual(dockGroups(closed.root)[0].tabs, []);
  assert.deepEqual(closed.closed, ["chat", "app:notes", "app:board"]);
  assert.deepEqual(closed.bar, ["tool:journal", "tool:files"]);
  const reopened = selectDockPanel(closed, "chat");
  assert.deepEqual(dockGroups(reopened.root)[0].tabs, ["chat"]);
  roundtrip(reopened);
});

test("closing the final tab collapses an area and restores an invalid maximization", () => {
  const state = move(initial(), ["chat"], { kind: "group", group: "main", side: "left" });
  const id = dockGroups(state.root).find((g) => g.active === "chat")!.id;
  const closed = closeDockPanels({ ...state, maximized: id }, ["chat"]);
  assert.equal(dockGroups(closed.root).length, 1);
  assert.equal(closed.maximized, null);
  assert.equal(closed.focused, "main");
  roundtrip(closed);
});

test("explicitly closing an empty area returns its space to its neighbour", () => {
  const state = move(initialDockState(), ["chat"], { kind: "group", group: "main", side: "left" });
  const closed = closeDockPanels(state, [], "main");
  assert.equal(closed.root.kind, "group");
  assert.equal(dockGroups(closed.root)[0].active, "chat");
  roundtrip(closed);
});

test("returning tools to the bar rejects mixed document drags and clears the flyout", () => {
  const preview = transitionDockSide(initial(), { type: "hover", id: "tool:files" });
  const docked = move(preview, ["tool:files", "tool:journal"], { kind: "edge", side: "right" });
  assert.deepEqual(docked.bar, []);
  assert.equal(docked.side.tab, null);
  assert.equal(docked.side.mode, "hidden");
  assert.equal(move(docked, ["chat", "tool:files"], { kind: "bar" }), docked);
  const returned = move(docked, ["tool:files", "tool:journal"], { kind: "bar" });
  assert.equal(dockGroups(returned.root).length, 1);
  assert.deepEqual(returned.bar, ["tool:files", "tool:journal"]);
  roundtrip(returned);
});

test("opening another sidebar view switches the flyout without changing the tree", () => {
  const preview = transitionDockSide(initial(), { type: "hover", id: "tool:files" });
  const switched = selectDockPanel(preview, "tool:journal");
  assert.equal(switched.root, preview.root);
  assert.equal(switched.side.mode, "hover-preview");
  assert.equal(activeDockTool(switched), "journal");
  roundtrip(switched);
});

test("navigation to a docked tool selects its existing group, including while maximized", () => {
  const state = move(initial(), ["tool:files"], { kind: "edge", side: "right" });
  const owner = dockGroups(state.root).find((g) => g.tabs.includes("tool:files"))!;
  const selected = selectDockPanel({ ...state, maximized: "main", focused: "main" }, "tool:files");
  assert.equal(selected.maximized, owner.id);
  assert.equal(selected.focused, owner.id);
  assert.equal(selected.side.tab, null);
  assert.equal(activeDockTool(selected), "files");
  roundtrip(selected);
});

test("selecting a docked tool while the flyout is open reports the focused tool", () => {
  const docked = move(initial(), ["tool:journal"], { kind: "edge", side: "left" });
  const side = selectDockPanel(docked, "tool:files");
  assert.equal(activeDockTool(side), "files");
  const selected = selectDockPanel(side, "tool:journal");
  assert.equal(activeDockTool(selected), "journal");
  assert.equal(selected.side.tab, "tool:files");
  roundtrip(selected);
});

test("catalog reconciliation keeps closed windows and focus, keeps vanished apps in place and adds newcomers", () => {
  const split = move(initial(), ["app:notes"], { kind: "edge", side: "left" });
  const state = closeDockPanels(split, ["app:board"]);
  const reconciled = reconcileDockState(state, ["chat", "app:notes", "app:new"], ["tool:files", "tool:journal"]);
  assert.equal(reconciled.focused, state.focused);
  assert.equal(dockGroups(reconciled.root).find((g) => g.id === state.focused)?.active, "app:notes");
  assert.ok(reconciled.known.includes("app:new"));
  const vanished = reconcileDockState(reconciled, ["chat", "app:new"], ["tool:files"]);
  assert.equal(vanished, reconciled, "an unavailable app or tool changes nothing that is stored");
  const shown = visibleDockState(vanished, ["chat", "app:new", "tool:files"], true);
  assert.deepEqual(dockGroups(shown.root).map((g) => g.tabs), [["chat", "app:new"]], "the area of the missing app gives its space away");
  assert.equal(shown.focused, "main");
  const returned = reconcileDockState(vanished, ["chat", "app:new", "app:notes"], ["tool:files"]);
  assert.equal(returned, reconciled);
  assert.deepEqual(visibleDockState(returned, ["chat", "app:new", "app:notes", "tool:files"], true).root, reconciled.root, "the app returns to its own area");
  roundtrip(returned);
});

test("a window that is briefly unavailable keeps its area and size and returns there instead of beside Chat", () => {
  const panels = ["chat", "tab:topic", "app:board"];
  const left = move(initialDockState(panels), ["tab:topic"], { kind: "edge", side: "left" });
  const arranged = resizeDockSplit(move(left, ["app:board"], { kind: "group", group: "main", side: "right" }), left.root.id, 0.25);
  const missing = reconcileDockState(arranged, ["chat", "app:board"], []);
  assert.equal(missing, arranged);
  const hidden = visibleDockState(missing, ["chat", "app:board"], true);
  assert.deepEqual(dockGroups(hidden.root).map((g) => g.tabs), [["chat"], ["app:board"]], "Chat and the app share the space meanwhile");
  const loading = visibleDockState(missing, ["chat", "app:board"], false);
  assert.deepEqual(dockGroups(loading.root).map((g) => g.tabs), [[], ["chat"], ["app:board"]], "before the run snapshot the area stays as an empty card");
  const back = reconcileDockState(missing, panels, []);
  assert.equal(back, arranged);
  const shown = visibleDockState(back, panels, true);
  assert.deepEqual(shown.root, arranged.root, "it returns to its own area with its size");
  assert.deepEqual(dockGroups(shown.root).find((g) => g.id === "main")?.tabs, ["chat"], "it does not join Chat's area");
  const none = visibleDockState(closeDockPanels(arranged, ["chat"]), [], true);
  assert.deepEqual(dockGroups(none.root).map((g) => g.tabs), [[]], "without any available panel one empty area remains");
  roundtrip(back);
});

test("only an explicit close or Reset layout takes an unavailable panel out of its area", () => {
  const panels = ["chat", "tab:topic", "app:board"];
  const arranged = move(initialDockState(panels), ["tab:topic"], { kind: "edge", side: "left" });
  const closed = closeDockPanels(reconcileDockState(arranged, ["chat", "app:board"], []), ["tab:topic"]);
  assert.ok(!dockGroups(closed.root).some((g) => g.tabs.includes("tab:topic")));
  assert.deepEqual(closed.closed, ["tab:topic"]);
  const returned = reconcileDockState(closed, panels, []);
  assert.ok(!dockGroups(returned.root).some((g) => g.tabs.includes("tab:topic")), "a closed window stays closed when it becomes available again");
  assert.ok(dockWindowOrder(returned, panels).includes("tab:topic"), "its header button reopens it");
  roundtrip(returned);
  const reset = reconcileDockState(initialDockState(["chat", "app:board"]), ["chat", "app:board"], []);
  assert.ok(!reset.known.includes("tab:topic"), "Reset layout keeps only the available panels");
});

test("an area whose shown app goes missing selects another tab, so the app returns without taking the selection back", () => {
  const start = selectDockPanel(initial(), "app:notes");
  const settled = activateAvailableDockTabs(start, ["chat", "app:board", "tool:files", "tool:journal"]);
  assert.equal(dockGroups(settled.root)[0].active, "chat");
  assert.deepEqual(dockGroups(settled.root)[0].tabs, ["chat", "app:notes", "app:board"], "the missing app keeps its tab position");
  assert.equal(activateAvailableDockTabs(settled, ["chat", "app:notes", "app:board"]), settled);
  const alone = move(start, ["app:notes"], { kind: "edge", side: "right" });
  assert.equal(activateAvailableDockTabs(alone, ["chat", "app:board"]), alone, "the only tab of an area stays its selection");
  roundtrip(settled);
});

test("an automatic layout gives the app area away while its apps are missing and restores it", () => {
  const split = reconcileDockState(initialDockState(), ["chat", "app:notes"], [], true);
  const missing = reconcileDockState(split, ["chat"], [], true);
  assert.equal(missing, split);
  assert.equal(visibleDockState(missing, ["chat"], true).root.kind, "group");
  assert.deepEqual(visibleDockState(missing, ["chat", "app:notes"], true).root, split.root);
  const preview = transitionDockSide(initial(), { type: "hover", id: "tool:files" });
  assert.deepEqual(visibleDockState(preview, ["chat", "tool:journal"], true).side, initial().side, "a missing tool closes its flyout only in the view");
  assert.deepEqual(visibleDockState(preview, ["chat", "tool:files"], true).side, preview.side);
});

test("catalog changes preserve sizes, empty areas, closed apps and the flyout", () => {
  const split = move(initial(), ["chat", "app:notes", "app:board"], { kind: "group", group: "main", side: "left" });
  const resized = resizeDockSplit(split, split.root.id, 0.7);
  const closed = closeDockPanels(resized, ["app:notes"]);
  const preview = transitionDockSide(closed, { type: "hover", id: "tool:files" });
  const next = reconcileDockState(preview, ["chat", "app:notes", "app:board", "app:new"], ["tool:files", "tool:journal"]);
  assert.equal(next.root.kind === "split" && next.root.ratio, 0.7);
  assert.deepEqual(next.closed, ["app:notes"]);
  assert.deepEqual(dockGroups(next.root).find((g) => g.id === "main")?.tabs, ["app:new"]);
  assert.deepEqual(next.side, preview.side);
  roundtrip(next);
});

test("layout storage rejects corrupt trees, duplicated panels and invalid side settings", () => {
  roundtrip(initial());
  for (const patch of [ { version: 2 }, { root: null }, { focused: "missing" }, { maximized: "missing" }, { closed: ["chat"] },
    { side: { tab: "tool:missing", mode: "hover-preview", focused: true } },
    { side: { tab: "tool:files", mode: "hidden", focused: false } },
    { side: { tab: null, mode: "hidden", focused: true } },
    { side: { tab: null, focused: false } },
    { side: { tab: null, mode: 1, focused: false } }, { known: [] }, { bar: ["chat"] } ]) {
    assert.throws(() => parseDockState(JSON.stringify({ ...initial(), ...patch })), /invalid/);
  }
  const split = move(initial(), ["chat"], { kind: "edge", side: "left" });
  assert.throws(() => parseDockState(JSON.stringify({ ...split, root: { ...split.root, ratio: -1 } })), /invalid/);
  assert.notEqual(dockStorageKey("https://example.com", "first"), dockStorageKey("https://other.example.com", "first"));
  assert.notEqual(dockStorageKey("https://example.com", "first"), dockStorageKey("https://example.com", "second"));
});

test("geometry conserves workspace space, separates dividers, and maximizes without editing the tree", () => {
  const split = move(initial(), ["app:notes"], { kind: "edge", side: "left" });
  const rect = { left: 0, top: 0, width: 1000, height: 600 };
  const geometry = dockGeometry(split.root, rect, null);
  assert.equal(geometry.groups.length, 2);
  assert.equal(geometry.groups.reduce((sum, g) => sum + g.rect.width, 0) + geometry.dividers[0].rect.width, 1000);
  assert.deepEqual(dockGeometry(split.root, rect, "main").groups[0].rect, rect);
  const resized = resizeDockSplit(split, split.root.id, 100);
  assert.equal(resized.root.kind === "split" && resized.root.ratio, 0.9);
});

test("hit testing distinguishes compass, outer guides, strip merging, bar returns and invalid drops", () => {
  const rect = { left: 0, top: 0, width: 900, height: 600 };
  const bar = { left: 900, top: 0, width: 36, height: 600 };
  const groups = dockGeometry(initial().root, rect, null).groups;
  const guides = dockingGuides(rect, groups[0]);
  assert.equal(guides.length, 9);
  for (const guide of guides) {
    const hit = dockHitTest({ x: guide.rect.left + 15, y: guide.rect.top + 15 }, rect, groups, bar, false);
    assert.deepEqual(hit.target, guide.target);
    assert.ok(hit.preview);
  }
  assert.deepEqual(dockHitTest({ x: 100, y: 10 }, rect, groups, bar, false).target, { kind: "group", group: "main", side: "center" });
  assert.deepEqual(dockHitTest({ x: 910, y: 200 }, rect, groups, bar, true).target, { kind: "bar" });
  assert.equal(dockHitTest({ x: 910, y: 200 }, rect, groups, bar, false).target, undefined);
  assert.equal(dockHitTest({ x: 100, y: 100 }, rect, groups, bar, false).target, undefined);
  const flyout = { left: 300, top: 0, width: 636, height: 600 };
  for (const guide of guides) assert.deepEqual(dockHitTest({ x: guide.rect.left + 15, y: guide.rect.top + 15 }, rect, groups, flyout, true).target, guide.target);
  assert.deepEqual(dockHitTest({ x: 700, y: 100 }, rect, groups, flyout, true).target, { kind: "bar" });
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const split = move(initial(), ["app:notes"], { kind: "edge", side });
    const actual = dockGeometry(split.root, rect, null).groups.find(({ group }) => group.tabs.includes("app:notes"))!.rect;
    const preview = dockPreview(rect, side, 0.35);
    for (const key of ["left", "top", "width", "height"] as const) assert.ok(Math.abs(preview[key] - actual[key]) < 0.001);
  }
  assert.deepEqual(dockPreview(rect, "center", 0.5), rect);
});

test("arbitrary sequences of close, move, select, resize, placement and reconcile preserve the storage invariants", () => {
  let state = initial();
  for (let i = 0; i < 200; i++) {
    const id = state.known[i % state.known.length];
    const group = dockGroups(state.root)[0];
    switch (i % 7) {
      case 0: state = move(state, [id], { kind: "group", group: group.id, side: i % 2 ? "center" : "left" }); break;
      case 1: state = closeDockPanels(state, [id]); break;
      case 2: state = selectDockPanel(state, id); break;
      case 3: state = resizeDockSplit(state, state.root.id, (i % 10) / 10); break;
      case 4: state = i % 3 ? reconcileDockState(state, ["chat", "app:notes", "app:board"], ["tool:files", "tool:journal"]) : reconcileDockState(state, ["chat", "app:board"], ["tool:journal"]); break;
      case 5: state = moveDockButton(state, id, i % 2 ? "sidebar" : "window"); break;
      case 6: state = transitionDockSide(state, { type: "click", id }); break;
    }
    roundtrip(state);
  }
});


test("sidebar transitions keep flyouts transient for hover, click and navigation", () => {
  let state = initial();
  const act = (action: Parameters<typeof transitionDockSide>[1]) => {
    state = transitionDockSide(state, action);
    roundtrip(state);
    return state.side.mode;
  };
  assert.equal(act({ type: "hover", id: "tool:files" }), "hover-preview");
  assert.equal(act({ type: "leave" }), "hidden");
  assert.equal(act({ type: "hover", id: "tool:files" }), "hover-preview");
  assert.equal(act({ type: "click", id: "tool:files" }), "hover-preview");
  assert.equal(act({ type: "leave" }), "hidden");
  assert.equal(act({ type: "hover", id: "tool:journal" }), "hover-preview");
  assert.equal(state.side.tab, "tool:journal");
  assert.equal(act({ type: "click", id: "tool:journal" }), "hover-preview");
  assert.equal(state.side.tab, "tool:journal");
  assert.equal(act({ type: "click", id: "tool:journal" }), "hover-preview");
  assert.equal(act({ type: "open", id: "tool:files" }), "hover-preview");
  assert.equal(act({ type: "leave" }), "hidden");
  assert.equal(act({ type: "hover", id: "tool:files" }), "hover-preview");
  assert.equal(act({ type: "close" }), "hidden");
  const docked = move(state, ["tool:files"], { kind: "edge", side: "left" });
  const returned = returnDockTool(docked, "tool:files");
  assert.equal(returned.side.mode, "hover-preview");
  assert.equal(returned.side.tab, "tool:files");
  roundtrip(returned);
});

test("Move into layout uses the right outer guide and creates an ordinary focused window", () => {
  const split = move(initial(), ["app:notes"], { kind: "edge", side: "left" });
  const preview = transitionDockSide({ ...split, maximized: "main" }, { type: "hover", id: "tool:files" });
  const ids = () => { let index = 0; return () => `layout-node-${++index}`; };
  const layout = transitionDockSide(preview, { type: "layout", newId: ids() });
  const dropped = moveDockPanels(preview, ["tool:files"], { kind: "edge", side: "right" }, ids());
  assert.deepEqual(layout, dropped);
  assert.equal(layout.root.kind, "split");
  if (layout.root.kind !== "split") throw new Error("Expected a workspace split");
  assert.equal(layout.root.axis, "horizontal");
  assert.equal(layout.root.ratio, 0.65);
  assert.deepEqual(layout.root.first, split.root);
  assert.deepEqual(dockGroups(layout.root.second).map((g) => g.tabs), [["tool:files"]]);
  assert.equal(layout.focused, layout.root.second.id);
  assert.equal(layout.maximized, null);
  assert.equal(layout.automatic, false);
  assert.equal(activeDockTool(layout), "files");
  assert.deepEqual(layout.side, initial().side);
  assert.deepEqual(layout.bar, ["tool:journal"]);
  assert.equal(dockButtonPlacement(layout, "tool:files"), "sidebar");
  roundtrip(layout);
  const closed = closeDockPanels(layout, ["tool:files"]);
  assert.deepEqual(closed.root, split.root);
  assert.ok(closed.bar.includes("tool:files"));
  assert.deepEqual(closed.side, initial().side);
  assert.equal(transitionDockSide(closed, { type: "layout", newId: () => "unused" }), closed);
});

test("persistent layouts exclude flyouts and retain windows moved into the layout", () => {
  const hovered = transitionDockSide(initial(), { type: "hover", id: "tool:files" });
  const saved = parseDockState(JSON.stringify(persistentDockState(hovered)));
  assert.equal(hovered.side.mode, "hover-preview");
  assert.deepEqual(saved.side, { ...hovered.side, tab: null, mode: "hidden", focused: false });
  assert.deepEqual(saved.root, hovered.root);
  const clicked = transitionDockSide(initial(), { type: "click", id: "tool:files" });
  assert.deepEqual(persistentDockState(clicked).side, saved.side);
  const docked = transitionDockSide(hovered, { type: "layout", newId: () => `node-${++serial}` });
  assert.deepEqual(parseDockState(JSON.stringify(persistentDockState(docked))), docked);
});

test("obsolete saved sidebar modes reconcile to a closed flyout without changing the layout", () => {
  const start = move(initial(), ["app:notes"], { kind: "edge", side: "left" });
  const arranged = moveDockButton(start, "tool:files", "window", "chat");
  const obsolete = { ...arranged, side: { tab: "tool:files", mode: "docked", focused: true, width: 420 } };
  const saved = parseDockState(JSON.stringify(obsolete));
  const reconciled = reconcileDockState(obsolete as unknown as DockState, ["chat", "app:notes", "app:board"], ["tool:files", "tool:journal"]);
  for (const state of [saved, reconciled]) {
    assert.deepEqual(state, arranged);
    assert.deepEqual(state.side, initial().side);
    assert.ok(!("width" in state.side));
    roundtrip(state);
  }
  const hidden = parseDockState(JSON.stringify({ ...arranged, side: { ...arranged.side, width: 360 } }));
  assert.deepEqual(hidden, arranged);
});

test("header window order moves a button before another one or to the end without touching the layout", () => {
  const panels = ["chat", "app:notes", "app:board"];
  const start = reconcileDockState(initial(), panels, ["tool:files", "tool:journal"], true);
  assert.deepEqual(dockWindowOrder(start, panels), panels);
  const first = moveDockWindow(start, "app:board", "chat");
  assert.deepEqual(dockWindowOrder(first, panels), ["app:board", "chat", "app:notes"]);
  assert.equal(first.root, start.root);
  assert.equal(first.automatic, true, "arranging the header keeps the automatic layout");
  const last = moveDockWindow(first, "app:board", null);
  assert.deepEqual(dockWindowOrder(last, panels), panels);
  assert.equal(moveDockWindow(first, "app:board", "chat"), first, "a move to the current slot changes nothing");
  assert.equal(moveDockWindow(first, "chat", "app:notes"), first, "before the next button is the current slot");
  assert.equal(moveDockWindow(first, "chat", "chat"), first);
  assert.equal(moveDockWindow(first, "tool:files", "chat"), first, "tools are not header windows");
  assert.equal(moveDockWindow(first, "app:missing", null), first);
  assert.equal(moveDockWindow(first, "chat", "app:missing"), first);
  roundtrip(first);
  roundtrip(last);
});

test("header window order appends new windows, keeps the slots of vanished ones and survives layout changes and reset", () => {
  const panels = ["chat", "app:notes", "app:board"];
  const tools = ["tool:files", "tool:journal"];
  const arranged = moveDockWindow(initial(), "app:board", "chat");
  assert.deepEqual(dockWindowOrder(arranged, [...panels, "app:new"]), ["app:board", "chat", "app:notes", "app:new"]);
  assert.deepEqual(dockWindowOrder(arranged, ["chat", "app:notes"]), ["chat", "app:notes"], "only the current windows are listed");
  const added = reconcileDockState(arranged, [...panels, "app:new"], tools);
  assert.deepEqual(added.order, ["app:board", "chat", "app:notes"]);
  assert.deepEqual(dockWindowOrder(moveDockWindow(added, "app:new", "chat"), [...panels, "app:new"]), ["app:board", "app:new", "chat", "app:notes"]);
  const vanished = reconcileDockState(added, ["chat", "app:notes", "app:new"], tools);
  assert.deepEqual(vanished.order, ["app:board", "chat", "app:notes"], "a vanished window keeps its slot");
  assert.deepEqual(dockWindowOrder(vanished, ["chat", "app:notes", "app:new"]), ["chat", "app:notes", "app:new"]);
  assert.deepEqual(dockWindowOrder(vanished, [...panels, "app:new"]), ["app:board", "chat", "app:notes", "app:new"], "and takes it again when it returns");
  const moved = move(closeDockPanels(arranged, ["app:notes"]), ["app:board"], { kind: "edge", side: "left" });
  assert.deepEqual(moved.order, arranged.order);
  assert.deepEqual(selectDockPanel(moved, "app:notes").order, arranged.order);
  roundtrip(vanished);
  roundtrip(moved);
  assert.equal(reconcileDockState(initialDockState(panels, tools), panels, tools).order, undefined, "Reset layout restores the catalog order");
});

test("the focused window is the active tab of the focused area, an empty pane included, and none for an empty area", () => {
  const panels = ["chat", "app:notes", "app:board"];
  const start = reconcileDockState(initial(), panels, ["tool:files", "tool:journal"], true);
  assert.equal(focusedDockWindow(start), "chat");
  const board = selectDockPanel(start, "app:board");
  assert.equal(focusedDockWindow(board), "app:board", "selecting a background tab focuses its area");
  assert.equal(focusedDockWindow(moveDockWindow(board, "app:board", "chat")), "app:board", "the header order does not change it");
  const pane = addDockEmptyPane(board, emptyPanelId("one"), undefined, false, () => `node-${++serial}`);
  assert.equal(focusedDockWindow(pane), "empty:one");
  assert.equal(focusedDockWindow(closeDockPanels(initialDockState(), ["chat"])), undefined);
});

test("layout storage rejects an invalid header window order", () => {
  for (const order of [["chat", "chat"], ["tool:files"], ["app:missing"], "chat", [1]]) {
    assert.throws(() => parseDockState(JSON.stringify({ ...initial(), order })), /invalid/);
  }
  roundtrip({ ...initial(), order: [] });
});

test("empty panes open beside the focused area or as a tab, several at once, and leave for good when closed", () => {
  const panels = ["chat", "app:notes", "app:board"];
  const tools = ["tool:files", "tool:journal"];
  const add = (state: DockState, id: string, target?: DockTarget, wide = true) => addDockEmptyPane(state, emptyPanelId(id), target, wide, () => `node-${++serial}`);
  const start = reconcileDockState(initial(), panels, tools, true);
  const first = add(start, "one");
  assert.equal(dockGroups(first.root).length, 3, "a wide workspace splits beside the focused area");
  assert.equal(dockGroups(first.root).find((g) => g.tabs.includes("empty:one"))?.active, "empty:one");
  assert.equal(first.automatic, false);
  const second = add(first, "two", undefined, false);
  assert.deepEqual(dockGroups(second.root).find((g) => g.id === second.focused)?.tabs, ["empty:one", "empty:two"], "a narrow workspace adds a tab");
  assert.equal(add(second, "two"), second, "an existing pane is not added twice");
  assert.equal(addDockEmptyPane(second, "app:other", undefined, true, () => "node"), second, "only empty pane IDs are added");
  const edge = add(second, "three", { kind: "edge", side: "bottom" });
  assert.equal(dockGroups(edge.root).length, 4);
  assert.equal(add(second, "lost", { kind: "bar" }), second, "a pane that does not land is not added");
  roundtrip(edge);
  const closed = closeDockPanels(edge, ["empty:one", "empty:three"]);
  assert.ok(!closed.known.includes("empty:one") && !closed.known.includes("empty:three"));
  assert.deepEqual(closed.closed, [], "closed panes are not reopened from the header");
  roundtrip(closed);
  const reconciled = reconcileDockState(closed, panels, tools, true);
  assert.ok(reconciled.known.includes("empty:two"), "catalog reconciliation keeps empty panes");
  assert.equal(reconcileDockState(reconciled, panels, tools, true), reconciled);
  assert.deepEqual(dockWindowOrder(moveDockWindow(reconciled, "app:board", "chat"), panels), ["app:board", "chat", "app:notes"], "empty panes are no header windows");
  roundtrip(moveDockWindow(reconciled, "app:board", "chat"));
  assert.ok(!reconcileDockState(initialDockState(panels, tools), panels, tools, true).known.some((id) => id.startsWith("empty:")), "Reset layout removes empty panes");
});

test("a window dropped on the center of a shown empty pane replaces it, a hidden one is merged beside", () => {
  const panels = ["chat", "app:notes", "app:board"];
  const tools = ["tool:files", "tool:journal"];
  const start = reconcileDockState(initial(), panels, tools, true);
  const pane = addDockEmptyPane(start, emptyPanelId("one"), { kind: "edge", side: "bottom" }, true, () => `node-${++serial}`);
  const area = dockGroups(pane.root).find((g) => g.tabs.includes("empty:one"))!;
  const replaced = move(pane, ["app:board"], { kind: "group", group: area.id, side: "center" });
  assert.deepEqual(dockGroups(replaced.root).find((g) => g.id === area.id)?.tabs, ["app:board"]);
  assert.ok(!replaced.known.includes("empty:one"));
  roundtrip(replaced);
  const tool = move(pane, ["tool:files"], { kind: "group", group: area.id, side: "center" });
  assert.deepEqual(dockGroups(tool.root).find((g) => g.id === area.id)?.tabs, ["tool:files"]);
  roundtrip(tool);
  const split = move(pane, ["app:board"], { kind: "group", group: area.id, side: "left" });
  assert.ok(split.known.includes("empty:one"), "a compass side splits beside the pane");
  const behind = selectDockPanel(move(pane, ["chat"], { kind: "group", group: area.id, side: "center" }), "chat");
  assert.deepEqual(dockGroups(behind.root).find((g) => g.id === area.id)?.tabs, ["chat"], "Chat replaced the shown pane");
  const tabbed = addDockEmptyPane(behind, emptyPanelId("two"), { kind: "group", group: area.id, side: "center" }, true, () => `node-${++serial}`);
  assert.deepEqual(dockGroups(tabbed.root).find((g) => g.id === area.id)?.tabs, ["chat", "empty:two"]);
  const background = selectDockPanel(tabbed, "chat");
  const merged = move(background, ["app:board"], { kind: "group", group: area.id, side: "center" });
  assert.deepEqual(dockGroups(merged.root).find((g) => g.id === area.id)?.tabs, ["chat", "empty:two", "app:board"], "a background pane stays");
  const own = move(tabbed, ["empty:two"], { kind: "group", group: area.id, side: "center" });
  assert.ok(own.known.includes("empty:two"), "a pane dropped on its own area stays");
  roundtrip(merged);
  roundtrip(own);
});

test("hit testing turns the whole content of a shown empty pane into its replace target", () => {
  const rect = { left: 0, top: 0, width: 900, height: 600 };
  const bar = { left: 900, top: 0, width: 36, height: 600 };
  const pane = addDockEmptyPane(initialDockState(["chat"]), emptyPanelId("one"), { kind: "edge", side: "right" }, true, () => `node-${++serial}`);
  const groups = dockGeometry(pane.root, rect, null).groups;
  const area = groups.find(({ group }) => group.active === "empty:one")!;
  const chat = groups.find(({ group }) => group.active === "chat")!;
  const hit = dockHitTest({ x: area.rect.left + 20, y: area.rect.top + area.rect.height - 20 }, rect, groups, bar, false);
  assert.deepEqual(hit.target, { kind: "group", group: area.group.id, side: "center" });
  assert.deepEqual(hit.preview, area.rect);
  assert.equal(dockHitTest({ x: chat.rect.left + 20, y: chat.rect.top + chat.rect.height - 20 }, rect, groups, bar, false).target, undefined);
  assert.equal(dockingGuides(rect, area).find((guide) => guide.target.kind === "group" && guide.target.side === "center")?.label, "Replace empty pane");
  assert.equal(dockingGuides(rect, chat).find((guide) => guide.target.kind === "group" && guide.target.side === "center")?.label, "Merge as tabs");
});

test("layout storage rejects closed or ordered empty panes", () => {
  const pane = addDockEmptyPane(initial(), emptyPanelId("one"), { kind: "edge", side: "left" }, true, () => `node-${++serial}`);
  roundtrip(pane);
  for (const patch of [{ order: ["empty:one"] }, { known: pane.known.filter((id) => id !== "empty:one") }]) {
    assert.throws(() => parseDockState(JSON.stringify({ ...pane, ...patch })), /invalid/);
  }
  assert.throws(() => parseDockState(JSON.stringify({ ...initial(), known: [...initial().known, "empty:two"], closed: ["empty:two"] })), /invalid/);
});

test("a workspace tab placed as a window defaults to a header window like an app", () => {
  assert.equal(workspaceTabPanelId({ id: "preview", placement: "window" }), "tab:preview");
  assert.equal(workspaceTabPanelId({ id: "files" }), "tool:files");
  assert.equal(workspaceTabPanelId({ id: "files", placement: "sidebar" }), "tool:files");
  const panels = ["chat", "tab:preview", "app:notes"];
  const tools = ["tool:files"];
  const start = reconcileDockState(initialDockState(), panels, tools, true);
  assert.deepEqual(dockGroups(start.root).map((g) => g.tabs), [["chat"], ["tab:preview", "app:notes"]], "it opens in the app area like the first app");
  assert.deepEqual(start.bar, ["tool:files"], "it never joins the rail");
  assert.deepEqual(dockWindowOrder(start, panels), panels);
  roundtrip(start);
  const closed = closeDockPanels(start, ["tab:preview"]);
  assert.deepEqual(closed.closed, ["tab:preview"]);
  assert.deepEqual(closed.bar, ["tool:files"], "closing it does not move it into the rail");
  assert.equal(move(closed, ["tab:preview"], { kind: "bar" }), closed, "the rail takes no window");
  roundtrip({ ...closed, closed: [], bar: [...closed.bar, "tab:preview"] });
  roundtrip(closed);
  const reopened = selectDockPanel(closed, "tab:preview");
  assert.equal(focusedDockWindow(reopened), "tab:preview");
  assert.equal(activeDockTool(reopened), "preview", "navigation reports it as the active tab");
  assert.deepEqual(reopened.closed, []);
  assert.equal(activeDockTool(selectDockPanel(reopened, "app:notes")), "", "an app is no workspace tab");
  assert.equal(selectDockPanel(closed, "tab:missing"), closed, "an unknown window is not added");
  roundtrip(reopened);
  const arranged = moveDockWindow(reopened, "tab:preview", "chat");
  assert.deepEqual(dockWindowOrder(arranged, panels), ["tab:preview", "chat", "app:notes"]);
  roundtrip(arranged);
  const placed = reconcileDockState(start, [...panels, "tab:files"], [], true);
  assert.deepEqual(placed.bar, ["tool:files"], "the former rail ID stays known; the rail lists only available tools");
  assert.ok(dockGroups(placed.root).some((g) => g.tabs.includes("tab:files")), "the tab joins the windows");
  roundtrip(placed);
});

test("button placement and header slots change without changing open, closed, or previewed panels", () => {
  const start = transitionDockSide(closeDockPanels(initial(), ["app:board"]), { type: "open", id: "tool:files" });
  const header = moveDockButton(start, "tool:files", "window", "app:notes");
  assert.equal(dockButtonPlacement(header, "tool:files"), "window");
  assert.deepEqual(dockWindowOrder(header, header.known), ["chat", "tool:files", "app:notes", "app:board"]);
  assert.equal(moveDockButton(header, "tool:files", "window", "app:notes"), header);
  const side = moveDockButton(header, "app:notes", "sidebar");
  const closed = moveDockButton(side, "app:board", "sidebar");
  const returned = moveDockButton(closed, "tool:files", "sidebar");
  assert.deepEqual(dockWindowOrder(returned, returned.known), ["chat"]);
  for (const next of [header, side, closed, returned]) {
    for (const key of ["root", "closed", "bar", "side", "focused", "maximized", "known", "automatic"] as const) assert.deepEqual(next[key], start[key], key);
    roundtrip(next);
  }
  assert.equal(dockButtonPlacement(returned, "app:notes"), "sidebar");
  assert.equal(moveDockButton(returned, "app:notes", "sidebar"), returned);
  assert.equal(moveDockButton(start, "missing", "sidebar"), start);
  assert.equal(moveDockButton(start, "tool:files", "window", "missing"), start);
  assert.equal(moveDockButton(start, "chat", "window", "chat"), start);
  const pane = addDockEmptyPane(start, "empty:one", undefined, false, () => `node-${++serial}`);
  assert.equal(moveDockButton(pane, "empty:one", "sidebar"), pane);
});

test("placement overrides reconcile with the catalog, round-trip, and reset to plugin defaults", () => {
  const panels = ["chat", "tab:preview", "app:notes"];
  const tools = ["tool:files"];
  const start = initialDockState(panels, tools);
  const custom = moveDockButton(moveDockButton(start, "tab:preview", "sidebar"), "tool:files", "window", "chat");
  assert.deepEqual(dockWindowOrder(custom, custom.known), ["tool:files", "chat", "app:notes"]);
  const added = reconcileDockState(custom, [...panels, "app:new"], tools);
  assert.equal(dockButtonPlacement(added, "tab:preview"), "sidebar");
  assert.equal(dockButtonPlacement(added, "app:new"), "window");
  assert.deepEqual(added.placements, custom.placements);
  const removed = reconcileDockState(added, ["chat", "app:notes", "app:new"], []);
  assert.equal(removed, added, "unavailable entries keep their overrides and slots");
  roundtrip(added);
  const reset = reconcileDockState(initialDockState(panels, tools), panels, tools);
  assert.equal(reset.placements, undefined);
  assert.equal(reset.order, undefined);
  assert.equal(dockButtonPlacement(reset, "tab:preview"), "window");
  assert.equal(dockButtonPlacement(reset, "tool:files"), "sidebar");
  assert.deepEqual(dockWindowOrder(reset, reset.known), panels);
});

test("moved buttons open closed panels in their chosen place and preserve single panel membership", () => {
  const sidebar = moveDockButton(closeDockPanels(initial(), ["app:notes"]), "app:notes", "sidebar");
  const opened = selectDockPanel(sidebar, "app:notes");
  assert.equal(opened.side.tab, "app:notes");
  assert.equal(opened.side.mode, "hover-preview");
  assert.equal(activeDockTool(opened), "");
  assert.ok(!opened.closed.includes("app:notes"));
  roundtrip(opened);
  const header = moveDockButton(opened, "app:notes", "window");
  assert.equal(revealDockPanel(header, "app:notes", true, () => `node-${++serial}`), header, "an open sidebar stays open after its button moves");
  const closed = closeDockPanels(header, ["app:notes"]);
  assert.ok(closed.closed.includes("app:notes"));
  assert.ok(!closed.bar.includes("app:notes"));
  roundtrip(closed);
  const tool = moveDockButton(initial(), "tool:files", "window");
  const narrow = revealDockPanel(tool, "tool:files", false, () => `node-${++serial}`);
  assert.ok(dockGroups(narrow.root)[0].tabs.includes("tool:files"));
  assert.ok(!narrow.bar.includes("tool:files"));
  assert.equal(narrow.side.tab, null);
  roundtrip(narrow);
  const wide = revealDockPanel(tool, "tool:files", true, () => `node-${++serial}`);
  assert.equal(dockGroups(wide.root).length, 2);
  const rail = moveDockButton(wide, "tool:files", "sidebar");
  assert.equal(transitionDockSide(rail, { type: "hover", id: "tool:files" }), rail, "hovering an open dock window does not open a second panel");
  assert.equal(transitionDockSide(rail, { type: "click", id: "tool:files" }).side.tab, null);
  roundtrip(rail);
  const windowTab = initialDockState(["chat", "tab:preview"]);
  const movedTab = moveDockButton(closeDockPanels(windowTab, ["tab:preview"]), "tab:preview", "sidebar");
  const sidebarTab = selectDockPanel(movedTab, "tab:preview");
  assert.equal(sidebarTab.side.tab, "tab:preview");
  assert.equal(activeDockTool(sidebarTab), "preview");
  roundtrip(sidebarTab);
});

test("layout storage accepts old layouts and rejects invalid placement overrides", () => {
  roundtrip(initial());
  for (const placements of [null, [], "sidebar", { chat: "header" }, { "app:missing": "sidebar" }, { "tool:files": 1 }]) {
    assert.throws(() => parseDockState(JSON.stringify({ ...initial(), placements })), /invalid/);
  }
  const empty = addDockEmptyPane(initial(), "empty:one", undefined, false, () => `node-${++serial}`);
  assert.throws(() => parseDockState(JSON.stringify({ ...empty, placements: { "empty:one": "sidebar" } })), /invalid/);
  const sidebar = moveDockButton(initial(), "chat", "sidebar");
  assert.throws(() => parseDockState(JSON.stringify({ ...sidebar, order: ["chat"] })), /invalid/);
});
