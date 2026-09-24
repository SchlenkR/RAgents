import { cn } from "cn";
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { SessionContext, SessionNavigation, WorkspaceTabContribution } from "./PluginRegistry";

export type WorkspacePanelState = "expanded" | "collapsed";

export function useWorkspacePanelState(runId: string) {
  const storageKey = `ragents.workspacePanelState:${encodeURIComponent(runId)}`;
  const [state, setState] = useState<WorkspacePanelState>(() =>
    localStorage.getItem(storageKey) === "collapsed" ? "collapsed" : "expanded");
  const update = useCallback((next: WorkspacePanelState) => {
    localStorage.setItem(storageKey, next);
    setState(next);
  }, [storageKey]);
  return [state, update] as const;
}
/** Counts in a tab shrink to a plain dot: the number belongs to the panel, not to the button. */
const tabClass = "flex min-h-9 min-w-9 flex-shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-[7px] py-[5px] text-[0.72rem] [&_[data-slot=badge]]:size-[5px] [&_[data-slot=badge]]:min-w-[5px] [&_[data-slot=badge]]:border-0 [&_[data-slot=badge]]:bg-current [&_[data-slot=badge]]:p-0 [&_[data-slot=badge]]:text-[0px]";

const WORKSPACE_WIDTH_DEFAULT = 560;
const WORKSPACE_WIDTH_MIN = 360;
const WORKSPACE_WIDTH_MAX = 960;

interface WorkspacePanelProps {
  headerContainer: HTMLElement | null;
  navigation: SessionNavigation;
  pendingTabIds: readonly string[];
  session: SessionContext;
  onToggleState: () => void;
  state: WorkspacePanelState;
  tabs: readonly WorkspaceTabContribution[];
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const widthStorageKey = `ragents.workspacePanelWidth:${encodeURIComponent(props.session.session.id)}`;
  const panelRef = useRef<HTMLElement>(null);
  const [visited, setVisited] = useState<readonly string[]>([]);
  const resizeCleanupRef = useRef<(() => void) | undefined>(undefined);
  const [normalWidth, setNormalWidth] = useState(() => {
    const stored = Number(localStorage.getItem(widthStorageKey));
    return stored >= WORKSPACE_WIDTH_MIN && stored <= WORKSPACE_WIDTH_MAX ? stored : WORKSPACE_WIDTH_DEFAULT;
  });
  const [layoutBounds, setLayoutBounds] = useState({ min: WORKSPACE_WIDTH_MIN, max: WORKSPACE_WIDTH_MAX });
  const normalWidthRef = useRef(normalWidth);
  const collapsed = props.state === "collapsed";
  const tabs = props.tabs;
  const activeTab = tabs.find((tab) => tab.id === props.navigation.activeTabId) ?? tabs[0];
  const activeTabId = activeTab?.id;
  const stateAction = collapsed ? "Arbeitsbereich aufklappen" : "Arbeitsbereich einklappen";

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const header = props.headerContainer?.parentElement;
    if (!panel || !header) return;
    const update = () => header.style.setProperty("--workspace-panel-width", `${panel.getBoundingClientRect().width}px`);
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    update();
    return () => {
      observer.disconnect();
      header.style.removeProperty("--workspace-panel-width");
    };
  }, [props.headerContainer]);

  useEffect(() => {
    if (activeTabId === undefined) return;
    setVisited((current) => current.includes(activeTabId) ? current : [...current, activeTabId]);
  }, [activeTabId]);

  useEffect(() => {
    const workspace = panelRef.current?.parentElement;
    if (!workspace) return;

    const update = () => {
      const next = boundsFor(workspace.clientWidth);
      setLayoutBounds((current) => current.min === next.min && current.max === next.max ? current : next);
    };
    const observer = new ResizeObserver(update);
    observer.observe(workspace);
    update();
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => resizeCleanupRef.current?.(), []);
  useEffect(() => { if (collapsed) resizeCleanupRef.current?.(); }, [collapsed]);

  const boundsFor = (available: number) => {
    const reserved = available <= 960 ? 52 : 360;
    const max = Math.min(WORKSPACE_WIDTH_MAX, Math.max(0, available - reserved));
    return { min: Math.min(WORKSPACE_WIDTH_MIN, max), max };
  };

  const maximumWidth = () => {
    const available = panelRef.current?.parentElement?.clientWidth ?? WORKSPACE_WIDTH_MAX;
    return boundsFor(available).max;
  };

  const clampWidth = (width: number) => {
    const available = panelRef.current?.parentElement?.clientWidth ?? WORKSPACE_WIDTH_MAX;
    const bounds = boundsFor(available);
    return Math.min(bounds.max, Math.max(bounds.min, width));
  };

  const applyWidth = (width: number) => {
    panelRef.current?.style.setProperty("--workspace-panel-width", `${width}px`);
  };

  const commitWidth = (width: number) => {
    normalWidthRef.current = width;
    setNormalWidth(width);
    localStorage.setItem(widthStorageKey, String(width));
  };

  const startResize = (start: PointerEvent<HTMLDivElement>) => {
    start.preventDefault();
    resizeCleanupRef.current?.();
    const panel = panelRef.current;
    const workspace = panel?.parentElement;
    const target = start.currentTarget;
    const startX = start.clientX;
    const startWidth = panel?.getBoundingClientRect().width ?? normalWidthRef.current;
    let currentWidth = startWidth;
    let frame: number | undefined;
    let active = true;
    workspace?.setAttribute("data-resizing", "true");
    target.setPointerCapture(start.pointerId);

    function cleanup() {
      if (!active) return;
      active = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      workspace?.removeAttribute("data-resizing");
      if (target.hasPointerCapture(start.pointerId)) target.releasePointerCapture(start.pointerId);
      resizeCleanupRef.current = undefined;
    }

    function move(event: globalThis.PointerEvent) {
      if (event.pointerId !== start.pointerId) return;
      currentWidth = clampWidth(startWidth + startX - event.clientX);
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        applyWidth(currentWidth);
        target.setAttribute("aria-valuenow", String(Math.round(currentWidth)));
        target.setAttribute("aria-valuetext", `${Math.round(currentWidth)} Pixel`);
      });
    }

    function up(event: globalThis.PointerEvent) {
      if (event.pointerId !== start.pointerId) return;
      currentWidth = clampWidth(startWidth + startX - event.clientX);
      cleanup();
      applyWidth(currentWidth);
      commitWidth(currentWidth);
    }

    function cancel(event?: globalThis.PointerEvent) {
      if (event && event.pointerId !== start.pointerId) return;
      cleanup();
      applyWidth(normalWidthRef.current);
      const effective = clampWidth(normalWidthRef.current);
      target.setAttribute("aria-valuenow", String(Math.round(effective)));
      target.setAttribute("aria-valuetext", `${Math.round(effective)} Pixel`);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    resizeCleanupRef.current = cancel;
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = panelRef.current?.getBoundingClientRect().width ?? normalWidthRef.current;
    const next = event.key === "ArrowLeft"
      ? clampWidth(current + 16)
      : event.key === "ArrowRight"
        ? clampWidth(current - 16)
        : event.key === "Home"
          ? clampWidth(WORKSPACE_WIDTH_MIN)
          : event.key === "End"
            ? maximumWidth()
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    applyWidth(next);
    commitWidth(next);
  };

  const effectiveWidth = Math.min(layoutBounds.max, Math.max(layoutBounds.min, normalWidth));
  const resizable = layoutBounds.max > layoutBounds.min;

  return (
    <aside
      aria-label="Arbeitsbereich"
      className={cn(
        "relative z-20 flex min-h-0 min-w-0 flex-col @max-[960px]/chat-content:absolute @max-[960px]/chat-content:inset-y-0 @max-[960px]/chat-content:right-0 @max-[960px]/chat-content:left-auto",
        collapsed
          ? "w-0 max-w-0 flex-[0_0_0]"
          : "w-[var(--workspace-panel-width,560px)] max-w-[calc(100%-360px)] flex-[0_0_var(--workspace-panel-width,560px)] border-l border-border-strong bg-shell shadow-workspace @max-[960px]/chat-content:w-[min(var(--workspace-panel-width,560px),calc(100%-var(--spacing-header)))] @max-[960px]/chat-content:max-w-none @max-[960px]/chat-content:flex-none",
      )}
      id="workspace-panel"
      ref={panelRef}
      style={{ "--workspace-panel-width": `${normalWidth}px` } as CSSProperties}
    >
      {!collapsed && (
        <div
          aria-controls="workspace-panel"
          aria-disabled={!resizable}
          aria-label="Breite des Arbeitsbereichs"
          aria-orientation="vertical"
          aria-valuemax={Math.round(layoutBounds.max)}
          aria-valuemin={Math.round(layoutBounds.min)}
          aria-valuenow={Math.round(effectiveWidth)}
          aria-valuetext={`${Math.round(effectiveWidth)} Pixel`}
          className={cn(
            "absolute inset-y-0 right-auto -left-1 z-30 w-2 touch-none",
            resizable
              ? "cursor-col-resize after:absolute after:top-[calc(50%-18px)] after:left-[3px] after:h-9 after:w-[3px] after:rounded-[3px] after:bg-border-strong after:content-[''] hover:bg-primary/25 in-data-[resizing=true]:bg-primary/25 focus-visible:outline-2 focus-visible:outline-primary/58 focus-visible:outline-offset-2"
              : "cursor-default",
          )}
          onKeyDown={resizable ? resizeWithKeyboard : undefined}
          onPointerDown={resizable ? startResize : undefined}
          role="separator"
          tabIndex={resizable ? 0 : -1}
          title="Breite ziehen"
        />
      )}
      {props.headerContainer && createPortal(<TooltipProvider><div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden pr-[7px] pl-[9px]" data-workspace-state={props.state}>
        <nav aria-label="Arbeitsbereich" className="flex min-w-0 flex-1 flex-nowrap gap-[3px] overflow-x-auto no-scrollbar" hidden={collapsed} role="tablist">
          {tabs.map((tab) => (
            <Tooltip key={tab.id}>
              <TooltipTrigger
                aria-label={tab.label}
                aria-controls="workspace-panel-content"
                aria-selected={activeTab?.id === tab.id}
                className={cn(tabClass, activeTab?.id === tab.id ? "bg-accent text-primary" : "text-muted-foreground hover:bg-foreground/6 hover:text-foreground")}
                onClick={() => props.navigation.openTab(tab.id)}
                role="tab"
                type="button"
              >
                <tab.Icon />
                {props.pendingTabIds.includes(tab.id) ? <span aria-hidden className="size-1.5 flex-none rounded-full bg-primary" /> : tab.Badge && (
                  <tab.Badge
                    active={activeTab?.id === tab.id}
                    navigation={props.navigation}
                    selection={props.navigation.selectionFor(tab.id)}
                    session={props.session}
                  />
                )}
              </TooltipTrigger>
              <TooltipContent side="bottom">{props.pendingTabIds.includes(tab.id) ? `${tab.label} - es gibt Neues` : tab.label}</TooltipContent>
            </Tooltip>
          ))}
        </nav>
        <Tooltip>
          <TooltipTrigger
            aria-controls="workspace-panel-content"
            aria-expanded={!collapsed}
            aria-label={stateAction}
            className="relative flex-shrink-0"
            onClick={props.onToggleState}
            render={<Button size="icon-lg" variant="ghost" />}
          >
            <IconPanelState state={props.state} />
          </TooltipTrigger>
          <TooltipContent side="bottom">{stateAction}</TooltipContent>
        </Tooltip>
      </div></TooltipProvider>, props.headerContainer)}
      <div className="relative min-h-0 flex-1 overflow-hidden" hidden={collapsed} inert={collapsed} id="workspace-panel-content">
        {mountedTabs(tabs, activeTabId, visited).map((tab) => (
          <div
            className={cn("absolute inset-0 flex min-h-0 flex-col", tab.id !== activeTabId && "pointer-events-none invisible")}
            key={tab.id}
          >
            <tab.Panel
              active={!collapsed && tab.id === activeTabId}
              navigation={props.navigation}
              selection={props.navigation.selectionFor(tab.id)}
              session={props.session}
            />
          </div>
        ))}
      </div>
    </aside>
  );
}

export const mountedTabs = (
  tabs: readonly WorkspaceTabContribution[],
  activeTabId: string | undefined,
  visited: readonly string[],
): readonly WorkspaceTabContribution[] =>
  tabs.filter((tab) => tab.id === activeTabId || tab.keepMounted === true && visited.includes(tab.id));

function IconPanelState({ state }: { state: WorkspacePanelState }) {
  return (
    <svg aria-hidden fill="none" height="22" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="22">
      <rect height="16" rx="2" width="18" x="3" y="4" />
      <path d="M16 4v16" />
      {state === "collapsed" && <path d="m13 8-4 4 4 4" />}
      {state === "expanded" && <path d="m7 8 4 4-4 4" />}
    </svg>
  );
}
