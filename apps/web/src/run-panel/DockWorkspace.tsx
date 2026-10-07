import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, LayoutGridIcon, MaximizeIcon, MinimizeIcon, PanelRightCloseIcon, PanelRightOpenIcon, SquareDashedIcon, SquareIcon, UsersIcon, XIcon } from "lucide-react";
import type { SessionContext, SessionNavigation, WorkspaceTabContribution } from "../PluginRegistry";
import { RunAppView, type RunApp } from "../run-apps";
import { Badge, InteractiveItem, Button, cn, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui";
import { activeDockTool, addDockEmptyPane, appPanelId, closeDockPanels, dockButtonPlacement, dockGroups, dockWindowOrder, emptyPanelId, focusedDockWindow, initialDockState, isEmptyPanel, isToolPanel, moveDockButton, moveDockPanels, moveDockWindow, reconcileDockState, resizeDockSplit, returnDockTool, revealDockPanel, transitionDockSide, selectDockPanel, tabWindowId, toolPanelId, workspaceTabPanelId, type DockGroup, type DockButtonPlacement } from "./dock-state";
import { DOCK_DIVIDER_SIZE, DOCK_HEADER_HEIGHT, containsPoint, dockGeometry, dockHitTest, type DockPoint, type DockRect } from "./dock-geometry";
import { useDockPointer } from "./dock-pointer";
import { useDockStorage } from "./dock-storage";
import { DockWindowActions } from "./DockWindowActions";
import { DockButtonMenu } from "./DockButtonMenu";
import { PanelActivity } from "./PanelActivity";
import { RailBadge } from "./RunPanelRail";
import { WorkspaceTabPanel } from "./WorkspaceTabPanel";

export { DockWindowActions } from "./DockWindowActions";

export const DockToolsContext = createContext<{ tabs: readonly WorkspaceTabContribution[]; pendingTabIds: readonly string[]; actionsContainer?: HTMLElement | null }>({ tabs: [], pendingTabIds: [] });
const areaHeaderClass = "absolute z-20 flex min-w-0 items-stretch overflow-hidden rounded-t-lg border-b border-border bg-card";
const cardClass = "pointer-events-none absolute rounded-lg border bg-card";
const tabClass = "flex min-w-0 flex-1 items-center hover:bg-hover";
const gripClass = "group/grip flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground focus-visible:text-primary data-[dragging=true]:text-primary";
const resizeClass = `absolute z-30 touch-none outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-ring ${gripClass}`;
function DockGrip({ horizontal = false }: { horizontal?: boolean }) {
  return <span aria-hidden data-dock-grip className={cn("pointer-events-none flex gap-[2px] group-active/grip:text-primary", !horizontal && "flex-col")}>
    {[0, 1, 2].map((dot) => <span className="size-[2px] rounded-full bg-current" key={dot} />)}
  </span>;
}
const guideIcons = { left: ArrowLeftIcon, right: ArrowRightIcon, top: ArrowUpIcon, bottom: ArrowDownIcon, center: SquareIcon };
const emptyRect: DockRect = { left: 0, top: 0, width: 0, height: 0 };
const headerRect = (rect: DockRect): DockRect => ({ left: rect.left + 1, top: rect.top + 1, width: Math.max(0, rect.width - 2), height: DOCK_HEADER_HEIGHT });
const contentRect = (rect: DockRect): DockRect => ({ left: rect.left + 1, top: rect.top + 1 + DOCK_HEADER_HEIGHT, width: Math.max(0, rect.width - 2), height: Math.max(0, rect.height - DOCK_HEADER_HEIGHT - 2) });
const resizeRect = (rect: DockRect, horizontal: boolean): DockRect => ({ ...rect, ...(horizontal ? { left: rect.left - 1, width: 8 } : { top: rect.top - 1, height: 8 }) });
const newId = () => crypto.randomUUID();
// A modal dialog covers the flyout that may own it; collapsing the flyout then would pause the dialog's panel.
const modalOpen = () => document.querySelector('[data-slot="dialog-content"][data-open]') !== null;
const EMPTY_PANE_ENTRY = "empty";
const EMPTY_PANE_TITLE = "Empty space";

export function useDockActiveApp(runId: string): string | undefined {
  const { state } = useDockStorage(runId);
  const active = state.side.focused ? state.side.tab : focusedDockWindow(state);
  return active?.startsWith("app:") ? active.slice(4) : undefined;
}

export function DockWorkspace({ apps, chat, chatIcon = <UsersIcon />, navigation, session }: {
  apps: readonly RunApp[];
  chat: ReactNode;
  chatIcon?: ReactNode;
  navigation: SessionNavigation;
  session: SessionContext;
}) {
  const { tabs, pendingTabIds, actionsContainer } = useContext(DockToolsContext);
  const { state: stored, error, update } = useDockStorage(session.session.id);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const splitApps = size.width >= 1000;
  const panelIds = ["chat", ...tabs.filter((tab) => tab.placement === "window").map((tab) => tabWindowId(tab.id)), ...apps.map((app) => appPanelId(app.definition.id))];
  const toolIds = tabs.filter((tab) => tab.placement !== "window").map((tab) => toolPanelId(tab.id));
  const catalog = [...panelIds, ...toolIds];
  // The initial run snapshot has not arrived yet; keep saved app positions until it does.
  const ready = session.runView !== undefined || apps.length > 0;
  const state = error ? stored : reconcileDockState(stored, ready ? panelIds : [...new Set([...stored.known.filter((id) => !isToolPanel(id)), ...panelIds])],
    ready ? toolIds : [...new Set([...stored.known.filter(isToolPanel), ...toolIds])], splitApps);
  useEffect(() => {
    if (!error && size.width > 0 && state !== stored) update((current) => reconcileDockState(current, state.known.filter((id) => !isToolPanel(id)), state.known.filter(isToolPanel), splitApps));
  }, [error, size.width, splitApps, state, stored, update]);
  useLayoutEffect(() => {
    update((current) => current.side.mode === "hover-preview" ? transitionDockSide(current, { type: "close" }) : current);
  }, [session.session.id, update]);
  const container = useRef<HTMLDivElement>(null);
  const windowsRef = useRef<HTMLDivElement>(null);
  const windows = dockWindowOrder(state, catalog);
  const sideButtons = catalog.filter((id) => dockButtonPlacement(state, id) === "sidebar");
  const [visited, setVisited] = useState<readonly string[]>(["chat"]);
  const [drag, setDrag] = useState<{ ids: readonly string[]; point: DockPoint; header?: boolean; slot?: number | null }>();
  const [resizing, setResizing] = useState<string>();
  const pointer = useDockPointer();
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const sideTab = state.side.tab;
  const sideVisible = sideTab !== null && state.bar.includes(sideTab) && catalog.includes(sideTab);
  const gap = DOCK_DIVIDER_SIZE;
  const railWidth = sideButtons.length > 0 || (drag?.header && drag.ids[0] !== EMPTY_PANE_ENTRY) ? 36 : 0;
  const railSpace = railWidth ? railWidth + gap : 0;
  const height = Math.max(0, size.height - gap * 2);
  const sideWidth = Math.min(630, Math.max(180, size.width - railSpace - gap * 3 - 80));
  const workspace: DockRect = { left: gap, top: gap, width: Math.max(0, size.width - gap * 2 - railSpace), height };
  const sideRect: DockRect = { left: size.width - gap - railSpace - sideWidth, top: gap, width: sideWidth, height };
  const railRect: DockRect = { left: size.width - gap - railWidth, top: gap, width: railWidth, height };
  const barRect: DockRect = { left: sideVisible ? sideRect.left : railRect.left, top: gap, width: railWidth + (sideVisible ? sideWidth + gap : 0), height };
  const geometry = dockGeometry(state.root, workspace, state.maximized);
  const visible = [...geometry.groups.flatMap(({ group }) => group.active ? [group.active] : []), ...(sideVisible && sideTab ? [sideTab] : [])];
  const visibleKey = JSON.stringify(visible);
  useEffect(() => {
    const ids: string[] = JSON.parse(visibleKey);
    setVisited((previous) => ids.every((id) => previous.includes(id)) ? previous : [...new Set([...previous, ...ids])]);
  }, [visibleKey]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (stored.maximized) update((current) => ({ ...current, maximized: null }));
      else if (stored.side.tab) {
        update((current) => transitionDockSide(current, { type: "close" }));
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [stored.maximized, stored.side.tab, update]);
  const emptyPanes = state.known.filter(isEmptyPanel);
  const labels = new Map<string, string>([["chat", "Chat"], ...apps.map((app) => [appPanelId(app.definition.id), app.definition.title ?? app.definition.id] as const), ...tabs.map((tab) => [workspaceTabPanelId(tab), tab.label] as const),
    [EMPTY_PANE_ENTRY, EMPTY_PANE_TITLE], ...emptyPanes.map((id) => [id, EMPTY_PANE_TITLE] as const)]);
  const title = (id: string) => labels.get(id) ?? id;
  const tabFor = (id: string | null) => tabs.find((tab) => workspaceTabPanelId(tab) === id);
  const icon = (id: string) => {
    const ToolIcon = tabFor(id)?.Icon;
    return id === "chat" ? chatIcon : ToolIcon ? <ToolIcon /> : id === EMPTY_PANE_ENTRY || isEmptyPanel(id) ? <SquareDashedIcon /> : <LayoutGridIcon />;
  };
  const marker = (tab: WorkspaceTabContribution, active: boolean) => pendingTabIds.includes(tab.id) && activeDockTool(state) !== tab.id ? <Badge tone="info">New activity</Badge>
    : tab.Badge && <tab.Badge active={active} navigation={navigation} selection={navigation.selectionFor(tab.id)} session={session} />;
  // A CSS zoom on the page scales client coordinates, not the dock geometry.
  const pointerZoom = () => container.current!.getBoundingClientRect().width / container.current!.offsetWidth || 1;
  const localPoint = (point: DockPoint, rect: DOMRect, zoom: number): DockPoint => ({ x: (point.x - rect.left) / zoom, y: (point.y - rect.top) / zoom });
  // Client coordinates keep header insertion independent of page zoom.
  const headerSlot = (point: DockPoint, id: string): number | null | undefined => {
    const group = windowsRef.current;
    if (!group || !containsPoint(group.getBoundingClientRect(), point)) return undefined;
    const slot = [...group.querySelectorAll<HTMLElement>("[data-dock-window]")].filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.bottom <= point.y || (rect.top <= point.y && rect.left + rect.width / 2 < point.x);
    }).length;
    const from = windows.indexOf(id);
    return id === EMPTY_PANE_ENTRY || (from >= 0 && (slot === from || slot === from + 1)) ? null : slot;
  };
  const startDrag = (event: PointerEvent<HTMLElement>, ids: readonly string[], click?: () => void, header = false) => {
    if (ids.length === 0 || event.button !== 0) return;
    holdSide();
    sidePressed.current = true;
    const bounds = container.current!.getBoundingClientRect();
    const zoom = pointerZoom();
    const start = { x: event.clientX, y: event.clientY };
    let started = false;
    pointer(event, (point) => {
      if (!started && Math.hypot(point.x - start.x, point.y - start.y) < 6) return;
      started = true;
      setDrag({ ids, point: localPoint(point, bounds, zoom), header, slot: header ? headerSlot(point, ids[0]) : undefined });
    }, (point) => {
      setDrag(undefined);
      if (!point) return;
      if (!started) { click?.(); return; }
      const slot = header ? headerSlot(point, ids[0]) : undefined;
      if (slot !== undefined) {
        if (slot !== null && ids[0] !== EMPTY_PANE_ENTRY) update((current) => moveDockButton(current, ids[0], "window", windows[slot] ?? null));
        return;
      }
      const rail = container.current?.querySelector("[data-dock-rail]");
      if (header && ids[0] !== EMPTY_PANE_ENTRY && rail && containsPoint(rail.getBoundingClientRect(), point)) {
        update((current) => moveDockButton(current, ids[0], "sidebar"));
        return;
      }
      const hit = dockHitTest(localPoint(point, bounds, zoom), workspace, geometry.groups, barRect, ids.every(isToolPanel));
      if (hit.target) update((current) => ids[0] === EMPTY_PANE_ENTRY ? addDockEmptyPane(current, emptyPanelId(newId()), hit.target, splitApps, newId) : moveDockPanels(current, ids, hit.target!, newId));
    });
  };
  const moveWindow = (id: string, offset: -1 | 1) => {
    const target = windows.indexOf(id) + offset;
    if (target >= 0 && target < windows.length) update((current) => moveDockWindow(current, id, windows[offset < 0 ? target : target + 1] ?? null));
  };
  const railDrop = drag?.header && drag.ids[0] !== EMPTY_PANE_ENTRY && railWidth > 0 && containsPoint(railRect, drag.point);
  const hit = drag && dockHitTest(drag.point, workspace, geometry.groups, barRect, drag.ids.every(isToolPanel));
  const moveButton = (id: string, placement: DockButtonPlacement) => {
    holdSide();
    update((current) => moveDockButton(current, id, placement));
    requestAnimationFrame(() => {
      const buttons = placement === "window" ? windowsRef.current : container.current?.querySelector("[data-dock-rail]");
      [...buttons?.querySelectorAll<HTMLElement>("[data-dock-window], [data-dock-rail-button]") ?? []].find((button) => button.getAttribute(placement === "window" ? "data-dock-window" : "data-dock-rail-button") === id)?.focus();
    });
  };
  const close = (ids: readonly string[], area?: string) => update((current) => closeDockPanels(current, ids, area));
  const select = (id: string) => update((current) => selectDockPanel(current, id));
  const holdSide = () => clearTimeout(leaveTimer.current);
  const sidePressed = useRef(false);
  const sideOpenedAt = useRef(0);
  useEffect(() => {
    if (state.side.tab !== null) sideOpenedAt.current = performance.now();
  }, [state.side.tab]);
  useEffect(() => {
    const release = (event: Event) => {
      sidePressed.current = false;
      const releasedAt = performance.now();
      const point = event instanceof MouseEvent ? { x: event.clientX, y: event.clientY } : undefined;
      clearTimeout(leaveTimer.current);
      leaveTimer.current = setTimeout(() => {
        const target = point && document.elementFromPoint(point.x, point.y);
        // A flyout that the press itself opened, for example from a button in the chat, is not an outside click.
        if (sideOpenedAt.current < releasedAt && !sidePressed.current && !modalOpen() && !target?.closest('[data-dock-sidebar], [data-dock-side-content], [data-dock-rail]')) {
          update((current) => transitionDockSide(current, { type: "leave" }));
        }
      }, 300);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [update]);
  const pressSide = () => {
    holdSide();
    sidePressed.current = true;
  };
  const leaveSide = () => {
    holdSide();
    if (sidePressed.current) return;
    leaveTimer.current = setTimeout(() => {
      if (!sidePressed.current && !modalOpen()) update((current) => transitionDockSide(current, { type: "leave" }));
    }, 300);
  };
  const hideSide = () => { update((current) => transitionDockSide(current, { type: "close" })); };
  const sideClick = (id: string) => update((current) => transitionDockSide(current, { type: "click", id }));
  const toolHeader = (id: string | null) => {
    const tab = tabFor(id);
    return tab?.Header ? <tab.Header active navigation={navigation} selection={navigation.selectionFor(tab.id)} session={session} /> : null;
  };
  // A press anywhere in a panel or focus inside it activates its area, not only a click on its tab.
  const focusPanel = useCallback((id: string, side: boolean) => update((current) => {
    if (side) return current.side.focused ? current : { ...current, side: { ...current.side, focused: true } };
    const owner = dockGroups(current.root).find((g) => g.tabs.includes(id));
    return owner && (owner.id !== current.focused || current.side.focused) ? { ...current, focused: owner.id, side: { ...current.side, focused: false } } : current;
  }), [update]);
  useEffect(() => {
    // Focus moving into a mini-app frame leaves only the window's blur in this document.
    const frameFocus = () => {
      const owner = document.activeElement instanceof HTMLIFrameElement ? document.activeElement.closest<HTMLElement>("[data-dock-panel]") : null;
      if (owner?.dataset.dockPanel) focusPanel(owner.dataset.dockPanel, owner.hasAttribute("data-dock-side-content"));
    };
    window.addEventListener("blur", frameFocus);
    return () => window.removeEventListener("blur", frameFocus);
  }, [focusPanel]);
  // Only the focused area tints its active tab; an unfocused area marks it calmly, and only beside other tabs.
  const areaFocused = (id: string) => state.focused === id && !state.side.focused;
  const panelPosition = (id: string) => {
    if (sideVisible && id === sideTab) return { rect: contentRect(sideRect), side: true };
    const area = geometry.groups.find(({ group }) => group.active === id);
    return area ? { rect: contentRect(area.rect), side: false } : undefined;
  };
  const panel = (id: string, content: ReactNode) => {
    const position = panelPosition(id);
    const side = position?.side === true;
    return <section aria-labelledby={position ? `dock-${side ? "side" : "tab"}-${encodeURIComponent(id)}` : undefined} className={cn("absolute flex min-h-0 min-w-0 flex-col overflow-hidden rounded-b-lg bg-card", side ? "z-40" : "z-10")}
      data-dock-side-content={side ? "" : undefined} data-dock-panel={id} id={`dock-panel-${encodeURIComponent(id)}`} tabIndex={-1} hidden={!position} inert={!position} key={id} role="tabpanel" style={{ ...(position?.rect ?? emptyRect), ...(!position ? { display: "none" } : {}) }}
      onPointerDownCapture={side ? pressSide : undefined} onPointerEnter={side ? holdSide : undefined} onPointerLeave={side ? leaveSide : undefined}
      onFocusCapture={() => focusPanel(id, side)}><PanelActivity active={position !== undefined}>{content}</PanelActivity></section>;
  };
  const selectFromKeyboard = (event: React.KeyboardEvent, group: DockGroup, id: string) => {
    const index = group.tabs.indexOf(id);
    const next = event.key === "ArrowRight" ? (index + 1) % group.tabs.length : event.key === "ArrowLeft" ? (index - 1 + group.tabs.length) % group.tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? group.tabs.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    select(group.tabs[next]);
    const strip = event.currentTarget.closest('[role="tablist"]');
    (strip?.querySelectorAll<HTMLElement>('[role="tab"]')[next])?.focus();
  };

  const reveal = (id: string) => update((current) => id === EMPTY_PANE_ENTRY ? addDockEmptyPane(current, emptyPanelId(newId()), undefined, splitApps, newId) : revealDockPanel(current, id, splitApps, newId));
  const actions = <DockWindowActions
    dragging={drag?.header ? drag.ids[0] : undefined}
    dropIndex={drag?.slot ?? undefined}
    extra={{ id: EMPTY_PANE_ENTRY, title: EMPTY_PANE_TITLE, icon: icon(EMPTY_PANE_ENTRY), hint: "Add an empty pane" }}
    groupRef={windowsRef}
    items={windows.map((id) => {
      const tab = tabFor(id);
      return { id, title: title(id), icon: icon(id), visible: visible.includes(id), badge: tab && marker(tab, visible.includes(id)) };
    })}
    onDragStart={(event, id) => startDrag(event, [id], () => reveal(id), true)}
    onMove={moveWindow}
    onOpen={reveal}
    onMoveToSidebar={(id) => moveButton(id, "sidebar")}
    onReset={() => update(() => reconcileDockState(initialDockState(panelIds, toolIds), panelIds, toolIds, splitApps), true)}
  />;
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-app" data-docking="workspace">
    {actionsContainer ? createPortal(actions, actionsContainer) : actions}
    {error && <p className="p-2 text-xs text-destructive" role="alert">{error}</p>}
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden" ref={container}>
      {geometry.groups.map(({ group, rect }) => <div className="contents" key={group.id}>
        <div aria-hidden data-dock-card={group.id} className={cn(cardClass, "z-0", areaFocused(group.id) ? "border-primary/70" : "border-border")} style={rect} />
        <div aria-label="Area tabs" className={areaHeaderClass} data-dock-group={group.id} role="tablist" style={headerRect(rect)} onFocusCapture={() => { if (state.focused !== group.id || state.side.focused) update((current) => ({ ...current, focused: group.id, side: { ...current.side, focused: false } })); }}>
          {group.tabs.map((id) => <div className={cn(tabClass, id === group.active && (areaFocused(group.id) ? "bg-selected text-selected-foreground hover:bg-selected-hover" : group.tabs.length > 1 && "bg-band"))} key={id} role="presentation">
            {id === (group.active ?? group.tabs[0]) && <Button aria-label="Move area" className={cn(gripClass, "flex-none touch-none cursor-grab hover:bg-transparent active:cursor-grabbing")} onPointerDown={(event) => startDrag(event, group.tabs)} size="icon-xs" title="Drag all windows of this area" variant="ghost"><DockGrip /></Button>}
            <InteractiveItem id={`dock-tab-${encodeURIComponent(id)}`} aria-controls={`dock-panel-${encodeURIComponent(id)}`} aria-label={title(id)} aria-selected={id === group.active} className="flex h-7 min-w-0 flex-1 touch-none cursor-grab items-center gap-1.5 border-0 px-2 text-left text-xs text-muted-foreground hover:bg-transparent hover:text-foreground selected:border-0 selected:bg-transparent selected:text-selected-foreground selected:hover:bg-transparent [&>svg]:size-4 [&>svg]:shrink-0"
              onClick={(event) => { if (event.detail === 0) select(id); }} onKeyDown={(event) => selectFromKeyboard(event, group, id)}
              onPointerDown={(event) => startDrag(event, [id], () => select(id))} role="tab" tabIndex={id === group.active ? 0 : -1} title={title(id)} type="button">{icon(id)}<span className="truncate">{title(id)}</span></InteractiveItem>
            {id === group.active && <>
              {toolHeader(group.active)}
              {group.active && isToolPanel(group.active) && <Button aria-label={`Return ${title(group.active)} to sidebar`} onClick={() => update((current) => returnDockTool(current, group.active!))} size="icon-xs" title="Return to sidebar" variant="ghost"><PanelRightOpenIcon /></Button>}
              {dockGroups(state.root).length > 1 && <Button aria-label={state.maximized === group.id ? "Restore area" : "Maximize area"} onClick={() => update((current) => ({ ...current, automatic: false, maximized: current.maximized === group.id ? null : group.id }))} size="icon-xs" variant="ghost">{state.maximized === group.id ? <MinimizeIcon /> : <MaximizeIcon />}</Button>}
            </>}
            <Button aria-label={`Close ${title(id)}`} className="flex-none" onClick={() => close([id])} size="icon-xs" variant="ghost"><XIcon /></Button>
          </div>)}
          {group.tabs.length === 0 && <Button aria-label="Move area" className={cn(gripClass, "flex-none touch-none cursor-grab active:cursor-grabbing")} onPointerDown={(event) => startDrag(event, group.tabs)} size="icon-xs" title="Drag all windows of this area" variant="ghost"><DockGrip /></Button>}
          {group.tabs.length === 0 && <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground">Empty area</span>}
          {group.tabs.length === 0 && dockGroups(state.root).length > 1 && <Button aria-label="Close area" onClick={() => close([], group.id)} size="icon-xs" variant="ghost"><XIcon /></Button>}
        </div>
        {group.tabs.length === 0 && <div className="absolute flex flex-col items-center justify-center gap-2 rounded-b-lg border border-dashed border-border p-2 text-center text-xs text-muted-foreground" data-dock-empty={group.id} style={{ ...contentRect(rect), left: rect.left + 7, top: rect.top + DOCK_HEADER_HEIGHT + 7, width: Math.max(0, rect.width - 14), height: Math.max(0, rect.height - DOCK_HEADER_HEIGHT - 14) }}>
          <span>Drop a window here</span>
        </div>}
      </div>)}
      {geometry.dividers.map(({ split, rect, parent }) => <div aria-label="Resize areas" aria-orientation={split.axis === "horizontal" ? "vertical" : "horizontal"} aria-valuemin={10} aria-valuemax={90} aria-valuenow={Math.round(split.ratio * 100)}
        data-dragging={resizing === split.id} className={cn(resizeClass, split.axis === "horizontal" ? "cursor-col-resize" : "cursor-row-resize")} key={split.id} role="separator" style={resizeRect(rect, split.axis === "horizontal")} tabIndex={0}
        onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return; event.preventDefault(); update((current) => resizeDockSplit(current, split.id, split.ratio + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -0.05 : 0.05))); }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          setResizing(split.id);
          const start = split.axis === "horizontal" ? event.clientX : event.clientY;
          const zoom = pointerZoom();
          pointer(event, (point) => {
            const delta = ((split.axis === "horizontal" ? point.x : point.y) - start) / zoom;
            const ratio = split.ratio + delta / ((split.axis === "horizontal" ? parent.width : parent.height) - DOCK_DIVIDER_SIZE);
            update((current) => resizeDockSplit(current, split.id, ratio));
          }, () => setResizing(undefined));
        }} ><DockGrip horizontal={split.axis === "vertical"} /></div>)}
      {panel("chat", chat)}
      {emptyPanes.map((id) => panel(id, <p className="m-1.5 flex flex-1 items-center justify-center rounded-md border border-dashed border-border p-2 text-center text-xs text-muted-foreground">Drag an app or actor here</p>))}
      {apps.filter((app) => visited.includes(appPanelId(app.definition.id)) || visible.includes(appPanelId(app.definition.id))).map((app) => panel(appPanelId(app.definition.id), <RunAppView app={app} navigation={navigation} session={session} />))}
      {tabs.map((tab) => [tab, workspaceTabPanelId(tab)] as const).filter(([, id]) => visited.includes(id) || visible.includes(id)).map(([tab, id]) => panel(id, <WorkspaceTabPanel Panel={tab.Panel} active={visible.includes(id)} navigation={navigation} selection={navigation.selectionFor(tab.id)} session={session} />))}
      {sideVisible && <>
        <div aria-hidden data-dock-frame className={cn(cardClass, "z-30 shadow-pop ring-1 ring-foreground/10", state.side.focused ? "border-primary/70" : "border-border")} style={sideRect} />
        <div aria-label="Sidebar" className={cn(areaHeaderClass, "z-40 items-center")} data-dock-sidebar="flyout" style={headerRect(sideRect)} onFocusCapture={() => { if (!state.side.focused) update((current) => ({ ...current, side: { ...current.side, focused: true } })); }} onPointerDownCapture={pressSide} onPointerEnter={holdSide} onPointerLeave={leaveSide}>
          <Button aria-label="Move sidebar window" className={cn(gripClass, "touch-none cursor-grab active:cursor-grabbing")} onPointerDown={(event) => startDrag(event, [sideTab!])} size="icon-xs" variant="ghost"><DockGrip /></Button>
          <span className="min-w-0 flex-1 truncate px-1 text-xs font-semibold" id={`dock-side-${encodeURIComponent(sideTab!)}`}>{title(sideTab!)}</span>
          {toolHeader(sideTab)}
          <Button aria-label="Move into layout" title="Move into layout" onClick={() => update((current) => transitionDockSide(current, { type: "layout", newId }))} size="icon-xs" variant="ghost"><PanelRightCloseIcon /></Button>
          <Button aria-label="Close sidebar" onClick={hideSide} size="icon-xs" variant="ghost"><XIcon /></Button>
        </div>
      </>}
      {railWidth > 0 && <TooltipProvider><nav data-dock-rail aria-label="Sidebar tabs" className={cn("absolute z-40 flex flex-col items-center gap-1 rounded-lg border border-border bg-card py-1", (railDrop || hit?.target?.kind === "bar") && "bg-primary/20 ring-2 ring-inset ring-primary")} style={railRect} onPointerEnter={holdSide} onPointerLeave={leaveSide}>
        {sideButtons.map((id) => {
          const tab = tabFor(id);
          const active = visible.includes(id);
          const pending = tab && pendingTabIds.includes(tab.id);
          return <Tooltip disableHoverablePopup key={id}>
            <div className="relative flex">
              <DockButtonMenu destination="header" onMove={() => moveButton(id, "window")}>
                <TooltipTrigger id={sideVisible && sideTab === id ? `dock-tab-${encodeURIComponent(id)}` : undefined} aria-controls={`dock-panel-${encodeURIComponent(id)}`} aria-label={title(id)} aria-pressed={active} className="touch-none" data-dock-rail-button={id}
                  onClick={(event) => { if (event.detail === 0) sideClick(id); }} onPointerDown={(event) => startDrag(event, [id], () => sideClick(id), true)}
                  onPointerEnter={() => { holdSide(); if (!drag && !sidePressed.current) update((current) => transitionDockSide(current, { type: "hover", id })); }} render={<Button size="icon" variant="ghost" />}>
                  {icon(id)}
                </TooltipTrigger>
              </DockButtonMenu>
              {tab && <RailBadge>{marker(tab, active)}</RailBadge>}
            </div>
            <TooltipContent className="pointer-events-none" side="left" sideOffset={8}>{pending ? `${title(id)} - new activity` : title(id)}</TooltipContent>
          </Tooltip>;
        })}
      </nav></TooltipProvider>}
      {(drag || resizing) && <div className={cn("absolute inset-0 z-[90] touch-none", resizing ? (geometry.dividers.find(({ split }) => split.id === resizing)?.split.axis === "horizontal" ? "cursor-col-resize" : "cursor-row-resize") : "cursor-grabbing")} />}
      {drag && hit && <div aria-label="Docking guides" className="pointer-events-none absolute inset-0 z-[91]">
        {(railDrop || hit.preview) && <div className="absolute rounded-lg border-2 border-primary bg-primary/20" data-dock-preview style={railDrop ? railRect : hit.target?.kind === "bar" ? (sideVisible && containsPoint(sideRect, drag.point) ? sideRect : railRect) : hit.preview} />}
        {hit.guides.map((guide, index) => {
          const Icon = guideIcons[guide.target.kind === "bar" ? "center" : guide.target.side];
          const selected = JSON.stringify(guide.target) === JSON.stringify(hit.target);
          return <div aria-label={guide.label} className={cn("absolute grid place-items-center rounded border border-border-strong bg-popover text-foreground shadow-pop", selected && "border-primary bg-primary text-primary-foreground")} data-dock-guide={guide.target.kind === "bar" ? "bar" : `${guide.target.kind}-${guide.target.side}`} key={index} style={guide.rect}><Icon className="size-4" /></div>;
        })}
        {drag.slot === undefined && <span className="absolute max-w-60 truncate rounded bg-primary px-2 py-1 text-xs text-primary-foreground" style={{ left: drag.point.x + 14, top: drag.point.y + 14 }}>{drag.ids.map(title).join(", ")}</span>}
      </div>}
    </div>
  </div>;
}
