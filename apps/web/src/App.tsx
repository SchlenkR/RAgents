import { canStartEntry } from "../../../packages/ragents/src/access";
import { useAccess, UserMenu } from "./AccessContext";
import { Alert, Button, Spinner } from "./ui";
import { RunModalContext, WorkspaceModalContext } from "./ui/dialog";
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { deleteSession, listSessions, type SessionInfo } from "./api";
import { CircleHelpIcon, SettingsIcon, SparklesIcon } from "lucide-react";
import { HelpDialog } from "./HelpDialog";
import { Overview } from "./Overview";
import type { OverviewPanelContext } from "./PluginRegistry";
import { PluginChat } from "./PluginChat";
import { chatUserLocation, type ChatRunLocation } from "./chat/user-location";
import { coreContracts } from "@ragents/host/api/contracts";
import { rpc } from "./rpc";
import { SettingsModal } from "./SettingsModal";
import { usePluginActivation } from "./PluginActivation";
import { PluginFailureNotice } from "./PluginFailureNotice";
import { useRunReadState } from "./run-read-state";

const chatWorkspaceClass = "flex min-h-0 min-w-0 flex-1 flex-col";
const headerSquareClass = "inline-flex w-header min-h-header items-center justify-center border-r border-border text-primary transition-colors duration-100 not-disabled:cursor-pointer hover:not-disabled:bg-accent focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:-outline-offset-3 aria-expanded:bg-primary aria-expanded:text-primary-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground disabled:opacity-45";

export function App() {
  const access = useAccess();
  const runReadState = useRunReadState(access.user?.id);
  const readRuns = access.can("runs.read");
  const writeRuns = readRuns && access.can("runs.write");
  const inspectRuns = access.can("runs.inspect");
  const deleteRuns = readRuns && access.can("runs.delete");
  const pluginActivation = usePluginActivation();
  const overviewButtonRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [runHeaderContainer, setRunHeaderContainer] = useState<HTMLDivElement | null>(null);
  const [workspaceHeaderContainer, setWorkspaceHeaderContainer] = useState<HTMLDivElement | null>(null);
  const [statusContainer, setStatusContainer] = useState<HTMLElement | null>(null);
  const [workspaceModalContainer, setWorkspaceModalContainer] = useState<HTMLDivElement | null>(null);
  const [runModalContainer, setRunModalContainer] = useState<HTMLDivElement | null>(null);
  const [serverSessions, setServerSessions] = useState<SessionInfo[]>([]);
  const [draft, setDraft] = useState<(SessionInfo & { startEntryId?: string }) | undefined>();
  const [activeId, setActiveId] = useState<string | undefined>();
  const [runLocation, setRunLocation] = useState<ChatRunLocation>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [toolbarPanel, setToolbarPanel] = useState<string>();
  const [overviewActivated, setOverviewActivated] = useState(false);
  const [busyPanels, setBusyPanels] = useState<ReadonlySet<string>>(() => new Set());
  const [sessionsUnreachable, setSessionsUnreachable] = useState(false);
  const refreshing = useRef<Promise<void> | undefined>(undefined);
  const refreshRequested = useRef(false);
  const refresh = useCallback((): Promise<void> => {
    if (!readRuns) return Promise.resolve();
    if (refreshing.current) {
      refreshRequested.current = true;
      return refreshing.current;
    }
    const update = async () => {
      do {
        refreshRequested.current = false;
        try {
          setServerSessions(await listSessions());
          setSessionsUnreachable(false);
        } catch { setSessionsUnreachable(true); }
      } while (refreshRequested.current);
    };
    refreshing.current = update().finally(() => { refreshing.current = undefined; });
    return refreshing.current;
  }, [readRuns]);

  useEffect(() => {
    if (!readRuns || draft) return;
    void refresh();
    const unsubscribe = rpc.subscribe(coreContracts.channels.sessions, {}, () => void refresh());
    const timer = setInterval(() => void refresh(), 5000);
    return () => { unsubscribe(); clearInterval(timer); };
  }, [draft, readRuns, refresh]);

  const closeOverview = useCallback((restoreFocus = false) => {
    setOverviewOpen(false);
    if (restoreFocus) overviewButtonRef.current?.focus({ preventScroll: true });
  }, []);

  // Overview contributions keep their state after the first opening.
  const openOverview = useCallback(() => {
    setToolbarPanel(undefined);
    setOverviewActivated(true);
    setOverviewOpen(true);
  }, []);

  const toggleOverview = useCallback(() => {
    if (overviewOpen) closeOverview(true);
    else openOverview();
  }, [closeOverview, openOverview, overviewOpen]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.shiftKey
        || event.key.toLowerCase() !== "i" || event.metaKey === event.ctrlKey) return;
      const button = overviewButtonRef.current;
      if (!button || button.closest("[inert]")) return;
      event.preventDefault();
      toggleOverview();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [toggleOverview]);

  const setPanelBusy = useCallback((id: string, busy: boolean) => setBusyPanels((current) => {
    if (current.has(id) === busy) return current;
    const next = new Set(current);
    if (busy) next.add(id);
    else next.delete(id);
    return next;
  }), []);

  const sessions = serverSessions;
  const activeSession = sessions.find((session) => session.id === activeId);
  const openSettings = useCallback(() => { setToolbarPanel(undefined); setSettingsOpen(true); }, []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    requestAnimationFrame(() => settingsButtonRef.current?.focus());
  }, []);
  const settingsAction = (
    <Button aria-label="Einstellungen öffnen" onClick={openSettings} ref={settingsButtonRef} size="icon-lg" title="Einstellungen" variant="ghost">
      <SettingsIcon />
    </Button>
  );

  const handleOpen = (id: string) => {
    setActiveId(id);
    closeOverview(true);
  };

  const handleCreate = () => {
    setToolbarPanel(undefined);
    closeOverview(true);
    setDraft({ id: crypto.randomUUID(), title: "Neuer Run", updatedAt: Date.now() });
  };

  const handleDelete = async (ids: readonly string[]) => {
    const results = await Promise.allSettled(ids.map((id) => deleteSession(id)));
    const deleted = ids.filter((_, index) => results[index]!.status === "fulfilled");
    if (activeId !== undefined && deleted.includes(activeId)) setActiveId(undefined);
    await refresh();
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw failure.reason;
  };

  if (pluginActivation.status === "loading") {
    return <div className="m-auto p-6 text-muted-foreground">Produktprofil wird geladen.</div>;
  }
  if (pluginActivation.status === "failed") {
    return (
      <div className="flex h-full">
        <main className="relative z-1 flex min-h-0 min-w-0 flex-1 bg-[image:var(--canvas-backdrop)]">
          <div className={chatWorkspaceClass}>
            <header className="flex min-h-[42px] flex-none items-center gap-3 border-b border-border-soft pr-0.5 pb-2 pl-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-3 text-[0.82rem] font-semibold text-foreground">Produktprofil nicht verfügbar</div>
            </header>
            <Alert className="m-auto max-w-[560px] gap-3 p-6" variant="destructive">
              <p>{pluginActivation.error}</p>
              <Button variant="outline" onClick={() => window.location.reload()}>Neu laden</Button>
            </Alert>
          </div>
        </main>
      </div>
    );
  }

  const registry = pluginActivation.registry;
  const availablePanels = registry.overviewPanels.filter((panel) => panel.readRight === undefined || access.can(panel.readRight));
  const panels = availablePanels.filter((panel) => panel.placement !== "toolbar");
  const toolbarPanels = availablePanels.filter((panel) => panel.placement === "toolbar");
  const overviewAvailable = readRuns || panels.length > 0;
  const busy = panels.some((panel) => busyPanels.has(panel.id));
  const userLocation = chatUserLocation(readRuns ? activeId : undefined, overviewOpen, runLocation);

  return (
    <div className="flex h-full flex-col">
      <header className="relative z-[80] flex h-header flex-none items-stretch border-b border-border bg-shell shadow-bar">
        {overviewAvailable && <div className="relative flex flex-none self-stretch">
          <button
            aria-controls="app-overview"
            aria-expanded={overviewOpen}
            aria-haspopup="dialog"
            aria-keyshortcuts="Meta+I Control+I"
            aria-label={overviewOpen ? "Übersicht schließen" : "Übersicht öffnen"}
            className={headerSquareClass}
            onClick={toggleOverview}
            ref={overviewButtonRef}
            title={`Übersicht (Cmd+I / Ctrl+I)${busy ? ": Bearbeitung läuft" : ""}`}
            type="button"
          >
            {busy ? <Spinner aria-hidden className="size-[18px]" /> : <SparklesIcon size={22} />}
          </button>
        </div>}
        {toolbarPanels.map(({ id, Panel }) => <ToolbarPanelHost
          id={id} key={id} onBusy={setPanelBusy}
          onClose={() => setToolbarPanel(undefined)}
          onOpen={() => { if (!settingsOpen && !helpOpen && !draft) { closeOverview(); setToolbarPanel(id); } }}
          open={toolbarPanel === id} Panel={Panel} registry={registry}
          userLocation={userLocation}
        />)}
        <div aria-label="Run-Titelleiste" className="flex min-w-0 flex-1 items-stretch overflow-x-auto no-scrollbar focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:-outline-offset-3 max-md:in-[header:has([data-slot=overseer-toolbar][data-open=true])]:flex-[0_1_0]" ref={setRunHeaderContainer} role="region" tabIndex={0} />
        <UserMenu />
        <div className="flex min-w-0 flex-[0_1_auto] items-stretch bg-shell has-data-[workspace-state=expanded]:w-[var(--workspace-panel-width,560px)] has-data-[workspace-state=expanded]:border-l has-data-[workspace-state=expanded]:border-border">
          <div className="flex min-w-0 flex-1 empty:hidden" ref={setWorkspaceHeaderContainer} />
          <div className="flex flex-none items-center gap-1.5 px-2 max-md:gap-0.5 max-md:px-1">
            {access.can("settings.read") && settingsAction}
            {inspectRuns && <Button aria-haspopup="dialog" aria-label="Hilfe öffnen" onClick={() => { setToolbarPanel(undefined); setHelpOpen(true); }} size="icon-lg" title="Hilfe" variant="ghost">
              <CircleHelpIcon />
            </Button>}
          </div>
        </div>
      </header>
    <PluginFailureNotice failures={pluginActivation.failures} />
    <WorkspaceModalContext.Provider value={workspaceModalContainer}>
    <div className="relative flex min-h-0 flex-1 flex-col" ref={setWorkspaceModalContainer}>
    <RunModalContext.Provider value={runModalContainer}>
    <div className="relative flex h-auto min-h-0 flex-1" ref={setRunModalContainer}>
      <main className="relative z-1 flex min-h-0 min-w-0 flex-1 bg-[image:var(--canvas-backdrop)] @container/chat-content">
        {readRuns && activeId
          ? (
            <PluginChat
              headerContainer={runHeaderContainer}
              workspaceHeaderContainer={workspaceHeaderContainer}
              statusContainer={statusContainer}
              key={activeId}
              onLocationChange={setRunLocation}
              onViewed={runReadState.markViewed}
              viewing={!overviewOpen && !settingsOpen && !helpOpen && !draft && !toolbarPanel}
              registry={registry}
              session={activeSession ?? { id: activeId, title: "Neuer Run", updatedAt: Date.now() }}
            />
          )
          : (
            <div className={chatWorkspaceClass}>
              <div className="m-auto text-center text-muted-foreground">{readRuns ? writeRuns ? "Öffne oben links die Übersicht, um einen Run zu wählen oder einen neuen zu starten." : "Öffne oben links die Übersicht, um einen Run zu wählen. Du hast Lesezugriff." : "Für dieses Benutzerkonto sind keine Runs freigegeben."}</div>
            </div>
          )}
      </main>
      {overviewActivated && (
        <Overview
          onOpen={openOverview}
          onBusy={setPanelBusy}
          onClose={() => closeOverview(true)}
          open={overviewOpen}
          panels={panels}
          registry={registry}
          runs={readRuns
            ? {
              activeId,
              canCreate: writeRuns && (access.can("runs.create") || registry.scriptEntries.some((entry) => canStartEntry(access, entry.id))),
              canDelete: deleteRuns,
              onCreate: handleCreate,
              onDelete: handleDelete,
              onOpen: handleOpen,
              registry,
              sessions,
              seenRevisions: runReadState.revisions,
              unreachable: sessionsUnreachable,
            }
            : undefined}
        />
      )}
      {draft && (
        <PluginChat
          key={draft.id}
          onStarted={() => { setActiveId(draft.id); setDraft(undefined); void refresh(); }}
          registry={registry}
          session={draft}
          startDialog={{ onClose: () => setDraft(undefined), initialEntryId: draft.startEntryId }}
        />
      )}
      {settingsOpen && <SettingsModal onClose={closeSettings} registry={registry} />}
      {inspectRuns && helpOpen && <HelpDialog onClose={closeHelp}
        sampleEntries={registry.scriptEntries.filter((entry) => canStartEntry(access, entry.id)).map((entry) => entry.id)}
        onStartSample={(entryId) => {
          if (!canStartEntry(access, entryId) || !registry.scriptEntries.some((entry) => entry.id === entryId)) return;
          setHelpOpen(false);
          setToolbarPanel(undefined);
          closeOverview();
          setDraft({ id: crypto.randomUUID(), title: "Neuer Run", updatedAt: Date.now(), startEntryId: entryId });
        }} />}
    </div>
    <footer
      aria-label="Run-Statusleiste"
      className="relative flex h-statusbar w-full flex-none items-stretch pl-3 before:pointer-events-none before:absolute before:inset-0 before:z-[2] before:border-t before:border-border before:bg-shell before:shadow-status before:backdrop-blur-[16px] before:content-['']"
      ref={setStatusContainer}
    />
    </RunModalContext.Provider>
    </div>
    </WorkspaceModalContext.Provider>
    </div>
  );
}

function ToolbarPanelHost({ id, onBusy, Panel, ...context }: Omit<OverviewPanelContext, "onBusy"> & {
  id: string;
  onBusy: (id: string, busy: boolean) => void;
  Panel: ComponentType<OverviewPanelContext>;
}) {
  const reportBusy = useCallback((busy: boolean) => onBusy(id, busy), [id, onBusy]);
  useEffect(() => () => onBusy(id, false), [id, onBusy]);
  return <Panel {...context} onBusy={reportBusy} />;
}
