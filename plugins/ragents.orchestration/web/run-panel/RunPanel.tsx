import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRightIcon, LayoutGridIcon, Maximize2Icon, MessageSquareIcon, PanelBottomIcon, PanelRightIcon } from "lucide-react";
import { useAccess } from "@ragents/web/AccessContext";
import { ChatPanel } from "@ragents/web/chat/ChatPanel";
import { runIsWorking } from "@ragents/web/chat/chat-target";
import { useCenterElements, useRunPanelHost } from "@ragents/web/run-panel/host";
import type { SurfaceCenterContext, SurfaceElementContribution, SurfaceElementDefinition, CardSectionContribution, SessionContext, SessionNavigation } from "@ragents/web/PluginRegistry";
import { Button, cn, Spinner, StartupNotice } from "@ragents/web/ui";
import { ActorChat } from "../ActorChat";
import { ActorChatControls } from "../ActorChatControls";
import { useActorHeaderMode } from "../actor-header-settings";
import { surfaceStartupState, type SurfaceStartupState } from "../surface-startup";
import { actorVisibleOnSurface, saveSurfaceViewPreferences, useSurfaceViewPreferences } from "../surface-view-settings";
import { cardSectionsClass } from "../constants";
import type { FlowSelection } from "../FlowInspector";
import { useProgramSlot } from "../program-slot";
import { chatPrimaryId, runViewFrom, type RunActor, type RunView } from "@ragents/web/run-view";
import { AddresseeControl } from "./AddresseeControl";
import { runPanelActors, elementNeedsAttention, partitionRunPanelActors } from "./run-panel-actors";
import { useRunPanelSettings } from "./run-panel-settings";
import { chatShowsContent, useRunPanelStartup } from "./run-panel-startup";
import { chatLayoutFor, clampChatWidth, saveRunPanelState, useRunPanelState, type ChatLayout, type RunPanelChatMode, type RunPanelState } from "./run-panel-state";
import { sheetStatus } from "./sheet-status";

const SHEET_BLUR_DELAY = 220;

const chipRowClass = "flex flex-none flex-wrap items-center gap-1.5 border-b border-border bg-shell px-2 py-1.5";
const chipClass = "flex h-7 max-w-[200px] flex-none cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card pr-2 pl-1 text-[0.72rem] font-semibold text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:outline-offset-1 aria-pressed:border-primary aria-pressed:bg-primary/10";
const chatLayoutClass: Readonly<Record<ChatLayout, string>> = {
  full: "relative flex min-h-0 min-w-0 flex-1 flex-col",
  side: "relative flex min-h-0 min-w-0 flex-col",
  floating: "absolute inset-x-2.5 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-2xl border border-b-0 border-border bg-card shadow-[0_-16px_60px_#00000080] transition-[height] duration-300 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none",
};
const chatSurfaceClass = "rounded-none border-0 bg-transparent";
const chatModeButtonClass = "aria-pressed:bg-accent aria-pressed:text-primary";
const chatModes: readonly { Icon: typeof MessageSquareIcon; label: string; mode: RunPanelChatMode; title: string }[] = [
  { Icon: MessageSquareIcon, label: "Nur Chat", mode: "chat", title: "Nur Chat: der Chat füllt das Run-Panel, die Mini-App tritt zurück" },
  { Icon: PanelBottomIcon, label: "Chat unten", mode: "bottom", title: "Chat unten: das Sheet über der Mini-App" },
  { Icon: PanelRightIcon, label: "Chat rechts", mode: "side", title: "Chat rechts: neben der Mini-App" },
];

interface RunPanelElement {
  Element: SurfaceElementContribution["Element"];
  definition: SurfaceElementDefinition;
}

export function OrchestrationRunPanel(props: SurfaceCenterContext) {
  return <RunPanel key={props.session.session.id} {...props} />;
}

function RunPanel({ surfaceElements, cardSections, navigation, renderChat, session, toolbarContainer }: SurfaceCenterContext) {
  const runId = session.session.id;
  const inspect = useAccess().can("runs.inspect");
  const host = useRunPanelHost();
  const view = runViewFrom(session.runView);
  const stored = useRunPanelState(runId);
  const centered = useCenterElements(runId);
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const grabRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLButtonElement>(null);
  const [chatWidth, setChatWidth] = useState(stored.chatWidth);
  const [width, setWidth] = useState(0);
  const [addresseeOpen, setAddresseeOpen] = useState(false);
  const settings = useRunPanelSettings();
  useEffect(() => setChatWidth(stored.chatWidth), [stored.chatWidth]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const save = useCallback((patch: Partial<RunPanelState>) => saveRunPanelState(runId, { ...stored, ...patch }), [runId, stored]);
  const elements = useMemo<RunPanelElement[]>(() => surfaceElements.flatMap(({ Element, select }) => select(session)
    .filter((definition) => definition.visible !== false)
    .map((definition) => ({ Element, definition }))), [surfaceElements, session]);
  const selectedElement = elements.find((entry) => entry.definition.id === stored.element) ?? elements[0];
  const startup = useRunPanelStartup(
    surfaceStartupState({ view, startup: session.startup, connected: session.connected, running: session.running, error: session.conversationError }),
    session.connected,
    elements.length > 0 || chatShowsContent(session.messages),
  );
  const notice = startup ? <RunPanelStartup state={startup} /> : undefined;
  const actors = useMemo(() => view ? runPanelActors(view, inspect) : [], [inspect, view]);
  const mode = useActorHeaderMode(runId);
  const preferences = useSurfaceViewPreferences(runId);
  const appActorIds = useMemo(() => new Set(elements.flatMap(({ definition }) => definition.anchorActorId ? [definition.anchorActorId] : [])), [elements]);
  const primaryId = view ? chatPrimaryId(view) : undefined;
  const selectedActor = actors.find((actor) => actor.id === stored.actor) ?? actors.find((actor) => actor.id === primaryId) ?? actors[0];
  const { shown, hidden } = useMemo(() => partitionRunPanelActors(actors, {
    mode,
    primaryId,
    selectedId: selectedActor?.id,
    onStage: (actor) => actor.id === primaryId || actorVisibleOnSurface(actor, appActorIds, preferences, primaryId),
  }), [actors, appActorIds, mode, preferences, primaryId, selectedActor?.id]);
  const availableWidth = () => rootRef.current?.clientWidth ?? Number.POSITIVE_INFINITY;
  const selectActor = useCallback((actor: RunActor) => save({ actor: actor.id }), [save]);
  const revealActor = useCallback((actor: RunActor) => {
    saveSurfaceViewPreferences(runId, { ...preferences, actorVisibility: { ...preferences.actorVisibility, [actor.id]: true } });
    save({ actor: actor.id });
  }, [preferences, runId, save]);
  const navigate = useCallback((selection: FlowSelection) => {
    const actor = selection.type === "actor" ? actors.find((entry) => entry.id === selection.id) : undefined;
    if (actor) selectActor(actor);
  }, [actors, selectActor]);
  const primarySelected = selectedActor === undefined || selectedActor.id === primaryId;
  const narrow = width < settings.sideWidth;
  const layout = chatLayoutFor({ chat: stored.chat, hasElement: selectedElement !== undefined, narrow });
  const sheet = useSheet(layout === "floating", sheetRef, grabRef, addresseeOpen, settings.openDelay);
  const geometry = useSheetPeek(layout === "floating", sheetRef, grabRef, statusRef, selectedActor?.id);
  const expandedHeight = Math.max(geometry.minimum, Math.min(stored.sheetExpandedHeight ?? geometry.maximum, geometry.maximum));
  const resize = useSheetResize(layout === "floating", sheetRef, grabRef, sheet, geometry, expandedHeight,
    (height) => save({ sheetExpandedHeight: Math.round(height) }));
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (layout !== "floating" || !sheet.expanded) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const toBottom = () => { scroller.scrollTop = scroller.scrollHeight; };
    toBottom();
    const timer = window.setTimeout(toBottom, 320);
    return () => window.clearTimeout(timer);
  }, [layout, sheet.expanded]);
  const status = useMemo(() => {
    if (layout !== "floating" || !selectedActor) return undefined;
    const messages = primarySelected ? session.messages : session.actorConversations?.[selectedActor.id] ?? [];
    const working = primarySelected ? session.connected && (session.running || runIsWorking(session.runView, runId)) : selectedActor.lifecycle?.kind === "running";
    return sheetStatus(messages, working, selectedActor.handle);
  }, [layout, primarySelected, runId, selectedActor, session.actorConversations, session.connected, session.messages, session.runView, session.running]);

  const addressee = view && selectedActor && <AddresseeControl
    hidden={hidden}
    onOpenChange={setAddresseeOpen}
    onReveal={revealActor}
    onSelect={selectActor}
    runId={runId}
    selected={selectedActor}
    shown={shown}
    technical={inspect}
    view={view}
  />;
  const chatModeSwitch = selectedElement && toolbarContainer && createPortal(<ChatModeSwitch
    narrow={narrow}
    onChange={(chat) => save({ chat })}
    selected={stored.chat}
    sideWidth={settings.sideWidth}
  />, toolbarContainer);
  const chat = primarySelected || !view || !selectedActor
    ? renderChat({ chatElementClassName: chatSurfaceClass, chatScrollerRef: (element) => { scrollerRef.current = element; }, notice, toolbarLeft: addressee })
    : <ActorRunPanelChat actor={selectedActor} cardSections={cardSections} navigation={navigation} notice={notice} onNavigate={navigate} session={session} toolbarLeft={addressee} view={view} />;

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-run-panel="run" ref={rootRef}>
    {chatModeSwitch}
    {layout !== "full" && elements.length > 1 && <nav aria-label="Mini-Apps des Runs" className={chipRowClass}>
      {elements.map(({ definition }) => <ElementChip
        centered={centered.has(definition.id)}
        definition={definition}
        key={definition.id}
        onSelect={() => centered.has(definition.id)
          ? host.openInCenter(runId, definition.id, definition.title ?? definition.id)
          : save({ element: definition.id })}
        selected={definition.id === selectedElement?.definition.id}
        session={session}
        view={view}
      />)}
    </nav>}
    <div className={cn("relative min-h-0 min-w-0 flex-1", layout === "side" ? "grid" : "flex flex-col")} data-chat-layout={layout} style={layout === "side" ? { gridTemplateColumns: `minmax(0,1fr) auto ${chatWidth}px` } : undefined}>
      {layout !== "full" && selectedElement && <RunPanelStage centered={centered.has(selectedElement.definition.id)} element={selectedElement} navigation={navigation} peek={layout === "floating" ? geometry.minimum : 0} runId={runId} session={session} />}
      {layout === "side" && <Sash
        onChange={(next) => setChatWidth(clampChatWidth(next, availableWidth()))}
        onCommit={(next) => save({ chatWidth: clampChatWidth(next, availableWidth()) })}
        value={chatWidth}
      />}
      {layout === "floating" && <div
        aria-hidden
        className="absolute inset-0 z-[15] bg-black/25 opacity-0 transition-opacity duration-300 pointer-events-none data-expanded:pointer-events-auto data-expanded:opacity-100 motion-reduce:transition-none dark:bg-black/45"
        data-expanded={sheet.expanded || undefined}
        onClick={sheet.close}
      />}
      <section
        aria-label="Chat"
        className={cn(chatLayoutClass[layout], layout === "floating" && "[&:not([data-expanded])_[data-slot=card-sections]]:hidden [&[data-sheet-resizing]_[data-slot=card-sections]]:hidden")}
        data-expanded={layout === "floating" && sheet.expanded ? true : undefined}
        data-sheet-resizing={resize.height !== undefined || undefined}
        data-view={primarySelected ? "chat" : "actor-chat"}
        onBlurCapture={layout === "floating" ? () => sheet.closeLater(SHEET_BLUR_DELAY) : undefined}
        onFocusCapture={layout === "floating" ? (event) => { if (event.target !== grabRef.current) sheet.open(); } : undefined}
        onPointerEnter={layout === "floating" ? (event) => { if (event.pointerType === "mouse") sheet.openLater(); } : undefined}
        onPointerLeave={layout === "floating" ? () => sheet.closeLater(settings.closeDelay) : undefined}
        ref={sheetRef}
        style={layout === "floating" ? { height: resize.height ?? (sheet.expanded ? expandedHeight : geometry.minimum), transition: resize.height !== undefined ? "none" : undefined } : undefined}
      >
        {layout === "floating" && <button
          aria-expanded={sheet.expanded}
          aria-label="Höhe des ausgeklappten Chats"
          aria-orientation="horizontal"
          aria-valuemin={geometry.minimum}
          aria-valuemax={geometry.maximum}
          aria-valuenow={Math.round(resize.height ?? expandedHeight)}
          className="flex h-3 w-full flex-none cursor-row-resize touch-none items-center justify-center outline-none select-none [&:hover>span]:bg-foreground [&:focus-visible>span]:bg-foreground [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-ring/60"
          data-run-panel="sheet-grip"
          onClick={resize.onClick}
          onKeyDown={resize.onKeyDown}
          onPointerDown={resize.onPointerDown}
          onPointerMove={resize.onPointerMove}
          onPointerUp={resize.onPointerUp}
          onPointerCancel={resize.onPointerCancel}
          onLostPointerCapture={resize.onPointerCancel}
          ref={grabRef}
          role="separator"
          title={`Ziehen: ausgeklappte Höhe einstellen. Klicken: ${sheet.expanded ? "Chat absenken" : "Chat hochschieben"}.`}
          type="button"
        ><span aria-hidden className="h-1 w-9 rounded-full bg-border-strong transition-colors" /></button>}
        {status && <button
          className={cn("flex h-6 w-full flex-none cursor-pointer items-center gap-2 px-4 text-left text-[0.7rem] transition-opacity duration-200 in-data-expanded:pointer-events-none in-data-expanded:opacity-0 motion-reduce:transition-none", status.kind === "waiting" ? "text-warning" : "text-muted-foreground")}
          onClick={sheet.toggle}
          ref={statusRef}
          title={status.text}
          type="button"
        >
          {status.kind === "working" && <Spinner aria-hidden className="size-3 flex-none" />}
          <span className="truncate">{status.text}</span>
        </button>}
        {chat}
      </section>
    </div>
  </div>;
}

/** Die drei Ansichten des Run-Panels in der Kopfzeile; "Chat rechts" bleibt gesperrt, solange das Run-Panel zu schmal ist. */
function ChatModeSwitch({ narrow, onChange, selected, sideWidth }: {
  narrow: boolean;
  onChange: (mode: RunPanelChatMode) => void;
  selected: RunPanelChatMode;
  sideWidth: number;
}) {
  return <div aria-label="Ansicht des Run-Panels" className="flex flex-none items-center gap-0.5 self-center rounded-lg border border-border bg-card p-0.5" role="group">
    {chatModes.map(({ Icon, label, mode, title }) => {
      const blocked = mode === "side" && narrow;
      return <Button
        aria-label={label}
        aria-pressed={selected === mode}
        className={chatModeButtonClass}
        disabled={blocked}
        key={mode}
        onClick={() => onChange(mode)}
        size="icon-sm"
        title={blocked ? `Chat bleibt unten, solange das Panel schmaler als ${sideWidth} Pixel ist` : title}
        variant="ghost"
      ><Icon /></Button>;
    })}
  </div>;
}

/** Das Sheet: Maus, Fokus oder der Griff schieben es hoch; Escape, die Bühne oder der Griff senken es. Ein offenes Pop-out hält es oben. */
function useSheet(active: boolean, sheetRef: RefObject<HTMLElement | null>, grabRef: RefObject<HTMLButtonElement | null>, blocked: boolean, openDelay: number) {
  const [expanded, setExpanded] = useState(false);
  const [held, setHeld] = useState(false);
  const guard = useRef({ held, blocked });
  const resizing = useRef(false);
  const timer = useRef<number>(undefined);
  useEffect(() => { guard.current = { held, blocked }; }, [blocked, held]);
  const cancel = useCallback(() => window.clearTimeout(timer.current), []);
  const open = useCallback(() => { if (!resizing.current) { cancel(); setExpanded(true); } }, [cancel]);
  const openLater = useCallback(() => {
    if (resizing.current) return;
    cancel();
    timer.current = window.setTimeout(() => { if (!resizing.current) setExpanded(true); }, openDelay);
  }, [cancel, openDelay]);
  const closeLater = useCallback((delay: number) => {
    if (resizing.current) return;
    cancel();
    timer.current = window.setTimeout(() => {
      if (resizing.current || guard.current.held || guard.current.blocked
        || (document.activeElement !== grabRef.current && sheetRef.current?.contains(document.activeElement))) return;
      setExpanded(false);
    }, delay);
  }, [cancel, grabRef, sheetRef]);
  const close = useCallback(() => {
    cancel();
    setHeld(false);
    setExpanded(false);
    if (document.activeElement instanceof HTMLElement && sheetRef.current?.contains(document.activeElement)) document.activeElement.blur();
  }, [cancel, sheetRef]);
  const toggle = useCallback(() => {
    if (expanded) { close(); return; }
    setHeld(true);
    open();
  }, [close, expanded, open]);
  const pauseResize = useCallback(() => { cancel(); resizing.current = true; }, [cancel]);
  const finishResize = useCallback((previous?: { expanded: boolean; held: boolean }) => {
    cancel();
    resizing.current = false;
    setExpanded(previous?.expanded ?? false);
    setHeld(previous?.held ?? false);
  }, [cancel]);
  useEffect(() => { if (!active) close(); }, [active, close]);
  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    if (!active || !expanded) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && !resizing.current && !guard.current.blocked) close(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, close, expanded]);
  return { expanded, held, open, openLater, closeLater, close, toggle, pauseResize, finishResize };
}

/** Die Höhe des zugeschobenen Sheets: Griff, Statuszeile und Eingabe, gemessen an der Eingabe des Chat-Rahmens. */
function useSheetPeek(active: boolean, sheetRef: RefObject<HTMLElement | null>, grabRef: RefObject<HTMLButtonElement | null>, statusRef: RefObject<HTMLButtonElement | null>, actorId: string | undefined) {
  const [geometry, setGeometry] = useState({ minimum: 0, maximum: 0, scale: 1 });
  useLayoutEffect(() => {
    if (!active) return;
    const sheet = sheetRef.current;
    const grab = grabRef.current;
    const status = statusRef.current;
    const composer = sheet?.querySelector<HTMLElement>('[data-chat="composer"]');
    const container = sheet?.parentElement;
    if (!sheet || !grab || !composer || !container) throw new Error("Das Sheet des Panels findet Griff, Eingabe oder Rahmen nicht.");
    const measure = () => {
      const style = getComputedStyle(sheet);
      const width = sheet.getBoundingClientRect().width;
      if (width === 0) return;
      const scale = width / Number.parseFloat(style.width);
      const minimum = Math.ceil((grab.getBoundingClientRect().height + (status?.getBoundingClientRect().height ?? 0)
        + composer.getBoundingClientRect().height) / scale + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth));
      const maximum = Math.max(minimum, Math.floor(container.getBoundingClientRect().height / scale * 0.9));
      setGeometry((previous) => previous.minimum === minimum && previous.maximum === maximum && previous.scale === scale ? previous : { minimum, maximum, scale });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(composer);
    observer.observe(grab);
    observer.observe(container);
    if (status) observer.observe(status);
    measure();
    return () => observer.disconnect();
  }, [active, actorId, grabRef, sheetRef, statusRef]);
  return geometry;
}

function useSheetResize(active: boolean, sheetRef: RefObject<HTMLElement | null>, grabRef: RefObject<HTMLButtonElement | null>, sheet: ReturnType<typeof useSheet>,
  geometry: { minimum: number; maximum: number; scale: number }, expandedHeight: number, onCommit: (height: number) => void) {
  const [height, setHeight] = useState<number>();
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number; height: number; moved: boolean; expanded: boolean; held: boolean }>(undefined);
  const suppressClick = useRef(false);
  const finish = (commit: boolean) => {
    const previous = drag.current;
    if (!previous) return;
    drag.current = undefined;
    suppressClick.current = previous.moved || !commit;
    const grip = grabRef.current;
    if (grip?.hasPointerCapture(previous.pointerId)) grip.releasePointerCapture(previous.pointerId);
    if (commit && previous.moved) onCommit(previous.height);
    sheet.finishResize(commit && previous.moved ? { expanded: true, held: previous.held } : previous);
    setHeight(undefined);
  };
  const finishResize = sheet.finishResize;
  useEffect(() => {
    if (active) return;
    drag.current = undefined;
    setHeight(undefined);
    finishResize();
  }, [active, finishResize]);
  const clamp = (value: number) => Math.max(geometry.minimum, Math.min(value, geometry.maximum));
  return {
    height,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      const suppressed = suppressClick.current && event.detail > 0;
      suppressClick.current = false;
      if (suppressed) return;
      sheet.toggle();
    },
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || drag.current || !sheetRef.current) return;
      event.preventDefault();
      const startHeight = sheetRef.current.getBoundingClientRect().height / geometry.scale;
      drag.current = { pointerId: event.pointerId, startY: event.clientY, startHeight, height: startHeight, moved: false, expanded: sheet.expanded, held: sheet.held };
      suppressClick.current = false;
      sheet.pauseResize();
      setHeight(startHeight);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus({ preventScroll: true });
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const distance = (current.startY - event.clientY) / geometry.scale;
      if (!current.moved && Math.abs(distance) < 3) return;
      current.moved = true;
      current.height = clamp(current.startHeight + distance);
      setHeight(current.height);
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => { if (drag.current?.pointerId === event.pointerId) finish(true); },
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => { if (drag.current?.pointerId === event.pointerId) finish(false); },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Escape" && drag.current) {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
        return;
      }
      const next = event.key === "ArrowUp" ? expandedHeight + 24 : event.key === "ArrowDown" ? expandedHeight - 24
        : event.key === "Home" ? geometry.minimum : event.key === "End" ? geometry.maximum : undefined;
      if (next === undefined || drag.current) return;
      event.preventDefault();
      sheet.finishResize({ expanded: true, held: sheet.held });
      onCommit(clamp(next));
    },
  };
}

function ElementChip({ centered, definition, onSelect, selected, session, view }: {
  centered: boolean;
  definition: SurfaceElementDefinition;
  onSelect: () => void;
  selected: boolean;
  session: SessionContext;
  view: RunView | undefined;
}) {
  const programs = useProgramSlot();
  const title = definition.title ?? definition.id;
  const attention = elementNeedsAttention(view, definition, programs?.needsAnswer(session, definition.id) ?? false);
  return <button aria-pressed={selected && !centered} className={chipClass} data-tone="app" onClick={onSelect} title={centered ? `${title} liegt in der Mitte. Klick holt das Fenster nach vorn.` : `Mini-App ${title} anzeigen`} type="button">
    <span className="grid size-5 flex-none place-items-center rounded-full bg-glass-app text-foreground [&>svg]:size-3"><LayoutGridIcon /></span>
    <span className="truncate">{title}</span>
    {attention && <span aria-label="Antwort erwartet" className="grid size-4 flex-none place-items-center rounded-full bg-warning text-[0.62rem] font-bold text-background" role="img">!</span>}
    {centered && <ArrowUpRightIcon aria-hidden className="size-3 flex-none text-muted-foreground" />}
  </button>;
}

function RunPanelStage({ centered, element, navigation, peek, runId, session }: {
  centered: boolean;
  element: RunPanelElement;
  navigation: SessionNavigation;
  peek: number;
  runId: string;
  session: SessionContext;
}) {
  const host = useRunPanelHost();
  const programs = useProgramSlot();
  const { Element, definition } = element;
  const title = definition.title ?? definition.id;
  return <section aria-label={`Mini-App ${title}`} className="group/stage relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card/55" style={peek > 0 ? { paddingBottom: peek } : undefined}>
    <div className="absolute top-1.5 right-2 z-[5] flex gap-0.5 rounded-lg border border-border bg-card p-0.5 opacity-0 transition-opacity group-hover/stage:opacity-100 group-focus-within/stage:opacity-100 motion-reduce:transition-none">
      {host.kind === "vscode"
        ? <Button aria-label={`${title} in die Mitte legen`} onClick={() => host.openInCenter(runId, definition.id, title)} size="icon-sm" title="In die Mitte legen" variant="ghost"><ArrowUpRightIcon /></Button>
        : programs && <Button aria-label={`${title} in Vollansicht öffnen`} onClick={() => programs.openFullscreen(definition.id)} size="icon-sm" title="Vollansicht" variant="ghost"><Maximize2Icon /></Button>}
    </div>
    <div className="relative flex min-h-0 flex-1 flex-col" data-run-panel="stage">
      {centered
        ? <div className="m-auto grid gap-3 p-4 text-center text-[0.76rem] text-muted-foreground" role="status">
          <span>{title} liegt in der Mitte.</span>
          <Button onClick={() => host.returnToRunPanel(runId, definition.id)} size="sm" variant="outline">Zurück ins Panel</Button>
        </div>
        : <Element definition={definition} navigation={navigation} session={session} />}
    </div>
  </section>;
}

/** Der senkrechte Griff zwischen Bühne und Chat daneben; ziehen nach links macht den Chat breiter. */
function Sash({ onChange, onCommit, value }: { onChange: (next: number) => void; onCommit: (next: number) => void; value: number }) {
  const drag = useRef<{ startX: number; startWidth: number }>(undefined);
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = undefined;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onCommit(value);
  };
  return <div
    aria-label="Breite des Chats"
    aria-orientation="vertical"
    aria-valuenow={value}
    className="flex w-2.5 flex-none cursor-col-resize touch-none items-center justify-center border-r border-l border-border bg-shell select-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:-outline-offset-2"
    onKeyDown={(event) => {
      const step = event.key === "ArrowRight" ? -24 : event.key === "ArrowLeft" ? 24 : 0;
      if (step === 0) return;
      event.preventDefault();
      onChange(value + step);
      onCommit(value + step);
    }}
    onPointerCancel={finish}
    onPointerDown={(event) => {
      drag.current = { startX: event.clientX, startWidth: value };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => { if (drag.current) onChange(drag.current.startWidth + drag.current.startX - event.clientX); }}
    onPointerUp={finish}
    role="separator"
    tabIndex={0}
  >
    <span aria-hidden className="h-10 w-1 rounded-full bg-border-strong" />
  </div>;
}

function ActorRunPanelChat({ actor, cardSections, navigation, notice, onNavigate, session, toolbarLeft, view }: {
  actor: RunActor;
  cardSections: readonly CardSectionContribution[];
  navigation: SessionNavigation;
  notice: ReactNode;
  onNavigate: (selection: FlowSelection) => void;
  session: SessionContext;
  toolbarLeft: ReactNode;
  view: RunView;
}) {
  const running = actor.lifecycle?.kind === "running";
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <div className={`${cardSectionsClass} max-h-[40%] flex-none overflow-auto overscroll-contain border-t-0 border-b`} data-slot="card-sections">
      {cardSections.map(({ id, Section }) => <Section actor={actor} key={id} navigation={navigation} session={session} />)}
    </div>
    <ChatPanel className="flex-1" composer={<ActorChatControls actor={actor} presentation="panel" running={running} display="panel" toolbarLeft={toolbarLeft} view={view} />}>
      {notice ?? <ActorChat actor={actor} conversation={session.actorConversations?.[actor.id]} historyError={session.conversationError} onNavigate={onNavigate}
        presentation="inspector" primaryMessages={session.messages} running={running} display="panel" view={view} />}
    </ChatPanel>
  </div>;
}

/** Der Ladezustand mittig im Chat; er rückt nur hoch, wo er sonst unter die Eingabe geriete. */
function RunPanelStartup({ state }: { state: SurfaceStartupState }) {
  return <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto_minmax(var(--composer-height,0px),1fr)] justify-items-center overflow-hidden p-6">
    <StartupNotice className="row-start-2" state={state} />
  </div>;
}
