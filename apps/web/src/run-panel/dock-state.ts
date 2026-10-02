export interface DockGroup {
  readonly kind: "group";
  readonly id: string;
  readonly tabs: readonly string[];
  readonly active: string | null;
}

export interface DockSplit {
  readonly kind: "split";
  readonly id: string;
  readonly axis: "horizontal" | "vertical";
  readonly ratio: number;
  readonly first: DockNode;
  readonly second: DockNode;
}

export type DockNode = DockGroup | DockSplit;
export type DockSide = "left" | "right" | "top" | "bottom";
export type DockTarget = { readonly kind: "group"; readonly group: string; readonly side: DockSide | "center" }
  | { readonly kind: "edge"; readonly side: DockSide }
  | { readonly kind: "bar" };

export interface DockState {
  readonly version: 1;
  readonly automatic?: boolean;
  readonly root: DockNode;
  readonly known: readonly string[];
  readonly closed: readonly string[];
  readonly bar: readonly string[];
  readonly focused: string;
  readonly maximized: string | null;
  readonly side: { readonly tab: string | null; readonly mode: "hidden" | "hover-preview" | "docked"; readonly focused: boolean; readonly width: number };
  /** The arranged order of the window buttons in the run header; windows missing from it follow in catalog order. */
  readonly order?: readonly string[];
}

export const appPanelId = (id: string) => `app:${id}`;
export const toolPanelId = (id: string) => `tool:${id}`;
export const isToolPanel = (id: string) => id.startsWith("tool:");
export const emptyPanelId = (id: string) => `empty:${id}`;
export const isEmptyPanel = (id: string) => id.startsWith("empty:");
const group = (id: string, tabs: readonly string[]): DockGroup => ({ kind: "group", id, tabs, active: tabs[0] ?? null });
export const dockGroups = (node: DockNode): readonly DockGroup[] => node.kind === "group" ? [node] : [...dockGroups(node.first), ...dockGroups(node.second)];
export const mapDockNode = (node: DockNode, id: string, update: (node: DockNode) => DockNode): DockNode =>
  node.id === id ? update(node) : node.kind === "group" ? node : { ...node, first: mapDockNode(node.first, id, update), second: mapDockNode(node.second, id, update) };

export function initialDockState(panels: readonly string[] = ["chat"], tools: readonly string[] = []): DockState {
  return { version: 1, automatic: true, root: group("main", panels), known: [...panels, ...tools], closed: [], bar: tools, focused: "main", maximized: null,
    side: { tab: null, mode: "hidden", focused: false, width: 630 } };
}

function removeGroup(node: DockNode, id: string): DockNode {
  if (node.kind === "group") return node;
  if (node.first.id === id) return node.second;
  if (node.second.id === id) return node.first;
  return { ...node, first: removeGroup(node.first, id), second: removeGroup(node.second, id) };
}

function normalize(state: DockState): DockState {
  const groups = dockGroups(state.root);
  return { ...state, side: state.side.tab === null ? { ...state.side, mode: "hidden", focused: false } : state.side, focused: groups.some((g) => g.id === state.focused) ? state.focused : groups[0].id,
    maximized: groups.some((g) => g.id === state.maximized) ? state.maximized : null };
}

function filterPanels(node: DockNode, keep: (id: string) => boolean): DockNode {
  if (node.kind === "split") return { ...node, first: filterPanels(node.first, keep), second: filterPanels(node.second, keep) };
  const tabs = node.tabs.filter(keep);
  return { ...node, tabs, active: node.active !== null && tabs.includes(node.active) ? node.active : tabs[0] ?? null };
}

function pruneEmptied(root: DockNode, before: DockNode, preserve?: string): DockNode {
  return dockGroups(before).reduce((node, previous) => {
    const current = dockGroups(node).find((g) => g.id === previous.id);
    return previous.tabs.length > 0 && current?.tabs.length === 0 && current.id !== preserve ? removeGroup(node, current.id) : node;
  }, root);
}

export function reconcileDockState(state: DockState, panels: readonly string[], tools: readonly string[], splitApps = false): DockState {
  const available = [...panels, ...tools];
  const keep = (id: string) => available.includes(id) || isEmptyPanel(id);
  const root = pruneEmptied(filterPanels(state.root, keep), state.root);
  const added = panels.filter((id) => !state.known.includes(id));
  const first = dockGroups(root).find((g) => g.id === "main") ?? dockGroups(root)[0];
  const reconciled = normalize({ ...state,
    root: mapDockNode(root, first.id, () => ({ ...first, tabs: [...first.tabs, ...added], active: first.active ?? added[0] ?? null })),
    known: [...new Set([...available, ...state.known.filter(isEmptyPanel)])],
    closed: state.closed.filter(keep),
    ...(state.order ? { order: state.order.filter(keep) } : {}),
    bar: [...state.bar.filter(keep), ...tools.filter((id) => !state.known.includes(id))],
    side: { ...state.side, tab: state.side.tab !== null && keep(state.side.tab) ? state.side.tab : null },
  });
  const result = state.automatic ? defaultDockLayout(reconciled, splitApps) : reconciled;
  return JSON.stringify(result) === JSON.stringify(state) ? state : result;
}

function defaultDockLayout(state: DockState, splitApps: boolean): DockState {
  const groups = dockGroups(state.root);
  const panels = state.known.filter((id) => groups.some((entry) => entry.tabs.includes(id)));
  const apps = panels.filter((id) => id.startsWith("app:") || isEmptyPanel(id));
  const active = groups.find((entry) => entry.id === state.focused)?.active;
  if (!splitApps || !panels.includes("chat") || apps.length === 0) {
    return { ...state, root: { ...group("main", panels), active: active ?? panels[0] ?? null }, focused: "main" };
  }
  const selectedApp = groups.find((entry) => entry.active && apps.includes(entry.active))?.active ?? apps[0];
  return { ...state,
    root: { kind: "split", id: "default-split", axis: "horizontal", ratio: 0.5,
      first: group("main", ["chat"]), second: { ...group("apps", apps), active: selectedApp } },
    focused: active && apps.includes(active) ? "apps" : "main",
  };
}

export function selectDockPanel(state: DockState, id: string): DockState {
  const target = dockGroups(state.root).find((g) => g.tabs.includes(id));
  if (target) return { ...state, root: mapDockNode(state.root, target.id, () => ({ ...target, active: id })), focused: target.id, side: { ...state.side, focused: false },
    maximized: state.maximized === null ? null : target.id };
  if (isToolPanel(id) && !state.bar.includes(id)) return state;
  if (isToolPanel(id)) return transitionDockSide(state, { type: "open", id });
  const first = dockGroups(state.root).find((g) => g.id === state.focused) ?? dockGroups(state.root)[0];
  return { ...state, automatic: false, closed: state.closed.filter((p) => p !== id), side: { ...state.side, focused: false },
    root: mapDockNode(state.root, first.id, () => ({ ...first, tabs: [...first.tabs, id], active: id })) };
}

export function revealDockPanel(state: DockState, id: string, split: boolean, newId: () => string): DockState {
  const groups = dockGroups(state.root);
  const owner = groups.find((entry) => entry.tabs.includes(id));
  if (owner) return owner.active === id && (state.maximized === null || state.maximized === owner.id) ? state : selectDockPanel(state, id);
  const target = groups.find((entry) => entry.id === state.focused) ?? groups[0];
  const restored = { ...state, automatic: false, maximized: null };
  return !split || target.tabs.length === 0
    ? selectDockPanel(restored, id)
    : moveDockPanels(restored, [id], { kind: "group", group: target.id, side: "right" }, newId);
}

export function addDockEmptyPane(state: DockState, id: string, target: DockTarget | undefined, split: boolean, newId: () => string): DockState {
  if (!isEmptyPanel(id) || state.known.includes(id)) return state;
  const known = { ...state, known: [...state.known, id] };
  const next = target ? moveDockPanels(known, [id], target, newId) : revealDockPanel(known, id, split, newId);
  return dockGroups(next.root).some((g) => g.tabs.includes(id)) ? next : state;
}

export function closeDockPanels(state: DockState, ids: readonly string[], area?: string): DockState {
  const root = filterPanels(state.root, (id) => !ids.includes(id));
  return normalize({ ...state,
    automatic: false,
    root: area ? removeGroup(root, area) : pruneEmptied(root, state.root),
    known: state.known.filter((id) => !isEmptyPanel(id) || !ids.includes(id)),
    closed: [...new Set([...state.closed, ...ids.filter((id) => !isToolPanel(id) && !isEmptyPanel(id))])],
    bar: [...new Set([...state.bar, ...ids.filter(isToolPanel)])],
    side: { ...state.side, tab: state.side.tab !== null && ids.includes(state.side.tab) ? null : state.side.tab },
  });
}

export function moveDockPanels(state: DockState, ids: readonly string[], target: DockTarget, newId: () => string): DockState {
  const moving = [...new Set(ids)].filter((id) => state.known.includes(id));
  if (moving.length === 0) return state;
  if (target.kind === "bar") return moving.every(isToolPanel) ? closeDockPanels(state, moving) : state;
  if (target.kind === "group" && !dockGroups(state.root).some((g) => g.id === target.group)) return state;
  const detached = filterPanels(state.root, (id) => !moving.includes(id));
  const source = dockGroups(state.root).find((g) => g.active !== null && moving.includes(g.active));
  const active = source?.active ?? moving[0];
  const added = { ...group(newId(), moving), active };
  const split = (node: DockNode, side: DockSide, ratio: number): DockSplit => {
    const before = side === "left" || side === "top";
    return { kind: "split", id: newId(), axis: side === "left" || side === "right" ? "horizontal" : "vertical",
      ratio: before ? ratio : 1 - ratio, first: before ? added : node, second: before ? node : added };
  };
  const merged = target.kind === "group" && target.side === "center";
  const shown = merged ? dockGroups(detached).find((g) => g.id === target.group)?.active : undefined;
  const replaced = shown && isEmptyPanel(shown) ? shown : undefined;
  const root = target.kind === "edge" ? split(detached, target.side, 0.35)
    : mapDockNode(detached, target.group, (node) => {
      if (node.kind !== "group") return node;
      if (target.side !== "center") return split(node, target.side, 0.5);
      return { ...node, tabs: replaced ? node.tabs.flatMap((id) => id === replaced ? moving : [id]) : [...node.tabs, ...moving], active };
    });
  const preserve = target.kind === "group" ? target.group : dockGroups(state.root).length === 1 ? dockGroups(state.root)[0].id : undefined;
  return normalize({ ...state, automatic: false, root: pruneEmptied(root, state.root, preserve), known: state.known.filter((id) => id !== replaced),
    closed: state.closed.filter((id) => !moving.includes(id)), bar: state.bar.filter((id) => !moving.includes(id)),
    focused: merged ? target.group : added.id, maximized: null,
    side: { ...state.side, focused: false, tab: state.side.tab !== null && moving.includes(state.side.tab) ? null : state.side.tab },
  });
}

export function resizeDockSplit(state: DockState, id: string, ratio: number): DockState {
  if (!Number.isFinite(ratio)) return state;
  return { ...state, automatic: false, root: mapDockNode(state.root, id, (node) => node.kind === "split" ? { ...node, ratio: Math.max(0.1, Math.min(0.9, ratio)) } : node) };
}

export function dockWindowOrder(state: DockState, panels: readonly string[]): readonly string[] {
  const arranged = (state.order ?? []).filter((id) => panels.includes(id));
  return [...arranged, ...panels.filter((id) => !arranged.includes(id))];
}

export function moveDockWindow(state: DockState, id: string, before: string | null): DockState {
  const order = dockWindowOrder(state, state.known.filter((entry) => !isToolPanel(entry) && !isEmptyPanel(entry)));
  if (!order.includes(id) || id === before || (before !== null && !order.includes(before))) return state;
  const rest = order.filter((entry) => entry !== id);
  const index = before === null ? rest.length : rest.indexOf(before);
  const next = [...rest.slice(0, index), id, ...rest.slice(index)];
  return next.every((entry, position) => entry === order[position]) ? state : { ...state, order: next };
}

export function activeDockTool(state: DockState): string {
  if (state.side.tab && state.side.focused) return state.side.tab.slice(5);
  const active = dockGroups(state.root).find((g) => g.id === state.focused)?.active;
  return active && isToolPanel(active) ? active.slice(5) : "";
}

export function persistentDockState(state: DockState): DockState {
  return state.side.mode === "hover-preview" ? transitionDockSide(state, { type: "close" }) : state;
}

export function parseDockState(raw: string | null): DockState {
  if (raw === null) return initialDockState();
  const state: DockState = JSON.parse(raw);
  const nodes = new Set<string>();
  const panels = new Set<string>();
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((id) => typeof id === "string");
  const uniquePanels = (ids: readonly string[]) => ids.every((id) => {
    if (panels.has(id)) return false;
    panels.add(id);
    return id === "chat" || id.startsWith("app:") || isToolPanel(id) || isEmptyPanel(id);
  });
  const validNode = (node: DockNode, depth = 0): boolean => {
    if (!node || depth > 64 || typeof node.id !== "string" || nodes.has(node.id)) return false;
    nodes.add(node.id);
    if (node.kind === "group") return strings(node.tabs) && uniquePanels(node.tabs)
      && (node.tabs.length === 0 ? node.active === null : typeof node.active === "string" && node.tabs.includes(node.active));
    return node.kind === "split" && (node.axis === "horizontal" || node.axis === "vertical")
      && Number.isFinite(node.ratio) && node.ratio >= 0.1 && node.ratio <= 0.9 && validNode(node.first, depth + 1) && validNode(node.second, depth + 1);
  };
  if (!state || state.version !== 1 || (state.automatic !== undefined && typeof state.automatic !== "boolean") || !validNode(state.root) || !strings(state.closed) || !uniquePanels(state.closed)
    || state.closed.some(isToolPanel) || state.closed.some(isEmptyPanel) || !strings(state.bar) || !uniquePanels(state.bar) || !state.bar.every(isToolPanel)
    || !strings(state.known) || new Set(state.known).size !== state.known.length || state.known.length !== panels.size || !state.known.every((id) => panels.has(id))
    || (state.order !== undefined && (!strings(state.order) || new Set(state.order).size !== state.order.length || !state.order.every((id) => state.known.includes(id) && !isToolPanel(id) && !isEmptyPanel(id))))
    || !dockGroups(state.root).some((g) => g.id === state.focused)
    || !(state.maximized === null || dockGroups(state.root).some((g) => g.id === state.maximized))
    || !state.side || !(state.side.tab === null || state.bar.includes(state.side.tab))
    || !["hidden", "hover-preview", "docked"].includes(state.side.mode)
    || (state.side.mode === "hidden") !== (state.side.tab === null) || (state.side.mode === "hidden" && state.side.focused) || typeof state.side.focused !== "boolean"
    || !Number.isFinite(state.side.width) || state.side.width < 180) throw new Error("The saved docking layout is invalid. Reset layout to recover.");
  return state;
}

export type DockSideAction = { type: "hover" | "click" | "open"; id: string }
  | { type: "leave" | "close" | "pin" };

export function transitionDockSide(state: DockState, action: DockSideAction): DockState {
  const side = state.side;
  const show = (tab: string, mode: DockState["side"]["mode"]): DockState =>
    ({ ...state, side: { ...side, tab, mode, focused: true } });
  const hide = (): DockState => ({ ...state, side: { ...side, tab: null, mode: "hidden", focused: false } });
  switch (action.type) {
    case "hover":
      return !state.bar.includes(action.id) || side.mode === "docked" ? state : show(action.id, "hover-preview");
    case "click":
    case "open":
      if (!state.bar.includes(action.id)) return state;
      if (action.type === "click" && side.tab === action.id && side.mode === "docked") return hide();
      return show(action.id, "docked");
    case "leave": return side.mode === "hover-preview" ? hide() : state;
    case "close": return hide();
    case "pin": return side.mode === "docked" ? hide() : side.tab ? show(side.tab, "docked") : state;
  }
}

export function returnDockTool(state: DockState, id: string): DockState {
  return transitionDockSide(transitionDockSide(closeDockPanels(state, [id]), { type: "close" }), { type: "open", id });
}
