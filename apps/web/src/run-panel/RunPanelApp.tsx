import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { canStartEntry, type AccessContext } from "../../../../packages/ragents/src/access";
import { deleteSession, getStartOptions, setStartOption, stopRun } from "../api";
import { startEntryDirectly } from "../chat/requests";
import { initialStartOptionUpdates, withoutFixedStartOptions } from "../StartOptions";
import { AccessScreen, useAccess } from "../AccessContext";
import type { SessionInfo } from "../api";
import { PluginChat } from "../PluginChat";
import type { PluginRegistry } from "../PluginRegistry";
import { usePluginActivation } from "../PluginActivation";
import { PluginFailureNotice } from "../PluginFailureNotice";
import { runActivityNotice } from "../run-overview";
import { useRunReadState } from "../run-read-state";
import { PanelPage } from "../panel/PanelPage";
import type { PanelAction, PanelState } from "../panel/contract";
import { HelpDialog } from "../HelpDialog";
import { chatUserLocation, type ChatRunLocation } from "../chat/user-location";
import { PanelContributions } from "./PanelContributions";
import { WorkspaceModalContext } from "../ui/dialog";
import { SettingsModal } from "../SettingsModal";
import { Alert, Button, RunStateIcon, StartupNotice, StopButton, type StartupNoticeState } from "../ui";
import type { RunPanelLocation } from "./run-panel-location";
import { RunPanelActions } from "./RunPanelActions";
import { useRunPanelHost } from "./host";
import { useSessionList } from "./use-session-list";
import { BrandLogo } from "../ui/brand-logo";

const headerClass = "relative z-[80] flex h-header flex-none items-stretch border-b border-border bg-shell shadow-bar";
const connectionClass = "max-w-[120px] self-center truncate rounded-full bg-secondary px-2 py-0.5 type-meta font-semibold text-muted-foreground";
const pendingTitleClass = "min-w-0 flex-1 self-center truncate px-1.5 type-item";
const STOP_REASON = "Stopped in the run panel";
const statusBarClass = "relative flex min-h-statusbar flex-none items-stretch border-t border-border bg-shell";
/** How long the panel in VS Code without a run waits for its host's start request. */
const HOST_COMMAND_TIMEOUT_MS = 5000;
const NEW_RUN_TITLE = "New run";
const noticeClass = "m-auto max-w-[420px] p-6 text-center text-muted-foreground";
const newDraft = (): SessionInfo => ({ id: crypto.randomUUID(), title: NEW_RUN_TITLE, updatedAt: Date.now() });
const placeholderSession = (id: string, title = "Run"): SessionInfo => ({ id, title, updatedAt: Date.now() });
const profileLoading: StartupNoticeState = { kind: "working", title: "Loading profile", detail: "Loading the server's interface." };
const hostStarting: StartupNoticeState = { kind: "working", title: "Starting run", detail: "Creating the new run." };
const launchStarting: StartupNoticeState = { kind: "working", title: "Starting run", detail: "Starting the template." };
const noRunSelected: StartupNoticeState = { kind: "waiting", title: "No run selected", detail: "On the Start page you start a new run or open an existing one." };
const noRunsReadable: StartupNoticeState = { kind: "error", title: "No runs enabled", detail: "No runs are enabled for this user account." };

/** The run panel: a run with chat and mini-apps, without a run the shared Start page; layout=app shows one mini-app. */
export function RunPanelApp({ location }: { location: RunPanelLocation }) {
  const activation = usePluginActivation();
  const headless = location.layout === "app";
  if (activation.status === "loading") return <PendingPanel headless={headless} state={profileLoading} />;
  if (activation.status === "failed") return (
    <PendingPanel headless={headless} state={{ kind: "error", title: "The profile could not be loaded", detail: activation.error }}>
      <Button onClick={() => window.location.reload()} size="sm" variant="outline">Reload</Button>
    </PendingPanel>
  );
  const page = location.layout === "app"
    ? <ElementPage elementId={location.elementId} registry={activation.registry} runId={location.runId} />
    : <RunPanelPage connection={location.connection} initialRunId={location.runId} registry={activation.registry} />;
  if (activation.failures.length === 0) return page;
  return (
    <div className="flex h-full flex-col">
      <PluginFailureNotice failures={activation.failures} />
      <div className="flex min-h-0 flex-1 flex-col">{page}</div>
    </div>
  );
}

function RunPanelPage({ connection, initialRunId, registry }: { connection: string | undefined; initialRunId: string | undefined; registry: PluginRegistry }) {
  const host = useRunPanelHost();
  const access = useAccess();
  const readRuns = access.can("runs.read");
  const writeRuns = readRuns && access.can("runs.write");
  const canCreateFree = writeRuns && access.can("runs.create");
  const canCreate = canCreateFree || (writeRuns && registry.scriptEntries.some((entry) => canStartEntry(access, entry.id)));
  const runReadState = useRunReadState(access.user?.id);
  const [runId, setRunId] = useState(initialRunId);
  const [page, setPage] = useState<"start" | "runs">("start");
  const [runLocation, setRunLocation] = useState<ChatRunLocation>();
  const [helpOpen, setHelpOpen] = useState(false);
  const [navigationError, setNavigationError] = useState<string>();
  const [workspaceContainer, setWorkspaceContainer] = useState<HTMLDivElement | null>(null);
  const [statusContainer, setStatusContainer] = useState<HTMLElement | null>(null);
  const [runTitle, setRunTitle] = useState<string>();
  const [focusRunId, setFocusRunId] = useState(initialRunId);
  const settleAutoFocus = useCallback(() => setFocusRunId((pending) => pending === runId ? undefined : pending), [runId]);
  const [runStartOptions, setRunStartOptions] = useState<Readonly<Record<string, unknown>>>();
  const [draft, setDraft] = useState<{ session: SessionInfo; startOptions?: Readonly<Record<string, unknown>>; entryId?: string }>();
  const [launch, setLaunch] = useState<Launch>();
  /** The run whose start still counts; a later click, another run, or going back replaces it. */
  const launching = useRef<string>(undefined);
  const replaceLaunch = useCallback((next: Launch | undefined) => {
    launching.current = next?.runId;
    setLaunch(next);
  }, []);
  const [refusal, setRefusal] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stopError, setStopError] = useState<string>();
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const { sessions, unreachable, refresh } = useSessionList(readRuns && !draft && !launch);
  const [headerContainer, setHeaderContainer] = useState<HTMLDivElement | null>(null);
  const startDraft = useCallback((startOptions?: Readonly<Record<string, unknown>>, entryId?: string) => {
    const fixed = registry.startEntries.find((entry) => entry.id === entryId)?.fixedStartOptions;
    setDraft({ session: newDraft(), startOptions: startOptions && withoutFixedStartOptions(startOptions, fixed), entryId });
  }, [registry]);
  const openRun = useCallback((id: string, startOptions?: Readonly<Record<string, unknown>>) => {
    setDraft(undefined);
    replaceLaunch(undefined);
    setRunStartOptions(startOptions);
    setRunId(id);
    setFocusRunId(id);
  }, [replaceLaunch]);
  /** A template without a guide starts right away; its result counts only as long as it is the current start. */
  const startLaunch = useCallback((next: Launch) => {
    setDraft(undefined);
    replaceLaunch(next);
    void launchRun(next, registry, access).then(
      () => { if (launching.current === next.runId) openRun(next.runId); },
      (cause: unknown) => { if (launching.current === next.runId) setLaunch({ ...next, error: cause instanceof Error ? cause.message : String(cause) }); },
    );
  }, [access, openRun, registry, replaceLaunch]);
  /** The logo always leads to the Start page; in the browser it lists this server's templates and recent runs. */
  const showStart = useCallback(() => {
    setFocusRunId(undefined);
    setDraft(undefined);
    replaceLaunch(undefined);
    setRefusal(undefined);
    if (host.kind === "vscode") host.notify({ type: "showStart" });
    else { setRunId(undefined); setPage("start"); }
  }, [host, replaceLaunch]);

  useLayoutEffect(() => {
    if (!focusRunId) return;
    if (settingsOpen || draft) {
      settleAutoFocus();
      return;
    }
    window.addEventListener("pointerdown", settleAutoFocus, true);
    window.addEventListener("keydown", settleAutoFocus, true);
    window.addEventListener("blur", settleAutoFocus);
    return () => {
      window.removeEventListener("pointerdown", settleAutoFocus, true);
      window.removeEventListener("keydown", settleAutoFocus, true);
      window.removeEventListener("blur", settleAutoFocus);
    };
  }, [draft, focusRunId, settingsOpen, settleAutoFocus]);

  useEffect(() => host.onCommand((message) => {
    if (message.type === "selectRun") {
      setFocusRunId(message.runId ?? undefined);
      setDraft(undefined);
      replaceLaunch(undefined);
      setRefusal(undefined);
      setRunStartOptions(undefined);
      setRunTitle(undefined);
      setRunId(message.runId ?? undefined);
    }
    if (message.type !== "newRun") return;
    if (host.kind !== "vscode") {
      if (canCreate) startDraft(message.startOptions, message.entryId);
      return;
    }
    // In the panel a click is a click: only a guide asks questions first as in the web app, the free task is formed in the chat.
    const refused = !canCreate ? "New runs are not enabled for this user account."
      : message.entryId === undefined && !canCreateFree ? "Free runs are not enabled for this user account." : undefined;
    setRefusal(refused);
    if (refused !== undefined) return;
    const entry = registry.startEntries.find((candidate) => candidate.id === message.entryId);
    setRunTitle(entry?.title ?? NEW_RUN_TITLE);
    if (message.entryId === undefined) {
      openRun(crypto.randomUUID(), message.startOptions);
      return;
    }
    if (entry !== undefined && registry.guideFor(entry) !== undefined) {
      replaceLaunch(undefined);
      startDraft(message.startOptions, entry.id);
      return;
    }
    startLaunch({ runId: crypto.randomUUID(), entryId: message.entryId, startOptions: message.startOptions });
  }), [canCreate, canCreateFree, host, openRun, registry, replaceLaunch, startDraft, startLaunch]);
  useEffect(() => { host.notify({ type: "ready" }); }, [host]);
  useEffect(() => { host.notify({ type: "runChanged", runId: runId ?? null }); }, [host, runId]);

  const settings = <>
    {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} registry={registry} />}
    {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)}
      sampleEntries={registry.scriptEntries.filter((entry) => canStartEntry(access, entry.id)).map((entry) => entry.id)}
      onStartSample={(entryId) => {
        if (!canStartEntry(access, entryId)) return;
        setHelpOpen(false);
        startDraft(undefined, entryId);
      }} />}
  </>;
  const toStart = <Button onClick={showStart} size="sm" variant="outline">Back to Start</Button>;
  const draftChat = draft && <PluginChat
    initialStartOptions={draft.startOptions}
    key={draft.session.id}
    onStarted={() => { openRun(draft.session.id); setRunTitle((title) => title ?? NEW_RUN_TITLE); void refresh(); }}
    registry={registry}
    session={draft.session}
    startDialog={{ onClose: host.kind === "vscode" ? showStart : () => setDraft(undefined), initialEntryId: draft.entryId }}
  />;
  const hasRunTitle = readRuns && Boolean(runId || launch || draft);
  const session = sessions.find((entry) => entry.id === runId);
  const stop = () => {
    if (runId === undefined) return;
    setStopError(undefined);
    void stopRun(runId, STOP_REASON).catch((cause: unknown) => setStopError(`Stop failed: ${cause instanceof Error ? cause.message : String(cause)}`));
  };
  const content = () => {
    if (launch) return <>
      {launch.error === undefined
        ? <PendingPanel bar headless state={launchStarting} />
        : <PendingPanel bar headless state={{ kind: "error", title: "The run could not be started", detail: launch.error }}>{toStart}</PendingPanel>}
      {settings}
    </>;
    if (host.kind === "vscode" && draft) return <>
      <PendingPanel bar headless state={launchStarting} />
      {draftChat}
      {settings}
    </>;
    // In VS Code the extension's Start page chooses the run; without one the panel waits for its request instead of showing a list.
    if (host.kind === "vscode" && !(readRuns && runId)) return <>
      {!readRuns ? <PendingPanel bar headless state={noRunsReadable}>{toStart}</PendingPanel>
        : refusal !== undefined ? <PendingPanel bar headless state={{ kind: "error", title: "No new run possible", detail: refusal }}>{toStart}</PendingPanel>
          : <HostWaiting>{toStart}</HostWaiting>}
      {settings}
    </>;

    const connectionName = registry.brand.title;
    const navigationState: PanelState = {
      theme: "light",
      page,
      profileSuggestions: [],
      problem: navigationError,
      connections: [{
        name: connectionName,
        kind: "server",
        address: window.location.origin,
        route: { kind: "server", host: window.location.host, localHost: false },
        state: unreachable ? { kind: "unreachable", message: "The server is unreachable." } : { kind: "connected" },
        canCreate,
        canCreateFree,
        canDelete: access.can("runs.delete"),
        defaultEntry: registry.startEntries.some((entry) => entry.id === registry.defaultStartEntry && canStartEntry(access, entry.id)) ? registry.defaultStartEntry : undefined,
        entries: registry.startEntries.filter((entry) => canStartEntry(access, entry.id)).map((entry) => ({
          id: entry.id, title: entry.title, description: entry.description, kind: entry.action,
          category: entry.category ?? (access.can("runs.inspect") ? "Run scripts" : "Workflows"), guided: registry.guideFor(entry) !== undefined,
        })),
        runs: readRuns ? sessions.map((entry) => ({ ...entry, state: entry.running ? "running" : "idle", pendingActions: 0, notice: runActivityNotice(entry, runReadState.revisions[entry.id]) })) : [],
      }],
    };
    const navigate = (action: PanelAction) => {
      setNavigationError(undefined);
      switch (action.action) {
        case "page":
          if (action.page === "connections") throw new Error("The browser is connected to its current server.");
          setPage(action.page);
          return;
        case "openRun": setRunTitle(undefined); openRun(action.runId); return;
        case "newRun": {
          if (!canCreate || action.entryId === undefined && !canCreateFree) throw new Error("New runs are not enabled.");
          if (action.entryId && !canStartEntry(access, action.entryId)) throw new Error("This template is not enabled.");
          const entry = registry.startEntries.find((entry) => entry.id === action.entryId);
          setRunTitle(entry?.title ?? NEW_RUN_TITLE);
          if (entry && registry.guideFor(entry)) startDraft(undefined, entry.id);
          else if (action.entryId) startLaunch({ runId: crypto.randomUUID(), entryId: action.entryId });
          else openRun(crypto.randomUUID());
          return;
        }
        case "deleteRuns":
          if (!access.can("runs.delete")) throw new Error("Deleting runs is not enabled.");
          void Promise.allSettled(action.runIds.map((id) => deleteSession(id))).then(async (results) => {
            await refresh();
            const failure = results.find((result) => result.status === "rejected");
            if (failure?.status === "rejected") setNavigationError(String(failure.reason));
          });
          return;
        case "retry": void refresh(); return;
        default: throw new Error(`Unsupported browser action: ${action.action}`);
      }
    };
    return (
      <div className="flex h-full flex-col bg-[image:var(--surface-backdrop)]">
        {readRuns && runId
          ? (
            <>
              {stopError && <Alert variant="destructive">{stopError}</Alert>}
              <main className="relative z-1 flex min-h-0 min-w-0 flex-1 @container/chat-content">
                <PluginChat
                  autoFocusChat={focusRunId === runId && !settingsOpen && !draft}
                  onAutoFocusChatSettled={settleAutoFocus}
                  headerContainer={headerContainer}
                  initialStartOptions={runStartOptions}
                  key={runId}
                  onLocationChange={setRunLocation}
                  statusContainer={statusContainer}
                  onViewed={runReadState.markViewed}
                  registry={registry}
                  session={session ?? placeholderSession(runId, runTitle)}
                  viewing={!draft && !settingsOpen && !helpOpen}
                />
              </main>
            </>
          )
          : (
            <>
              <div className="min-h-0 min-w-0 flex-1 overflow-auto">
                {unreachable && <Alert className="mb-3" variant="destructive">The server is unreachable.</Alert>}
                <PanelPage send={navigate} state={navigationState} runDetails={(id) => {
                  const entry = sessions.find((candidate) => candidate.id === id);
                  return entry && <>
                    {entry.ownerLabel && <span>{entry.ownerLabel}</span>}
                    {registry.sessionMetadata.map(({ id, Metadata }) => <Metadata key={id} placement="list" session={entry} />)}
                  </>;
                }} />
              </div>
            </>
          )}
        <footer aria-label="Run status bar" className={statusBarClass} ref={setStatusContainer} />
        {settings}
        {draftChat}
      </div>
    );
  };
  return <WorkspaceModalContext.Provider value={workspaceContainer}><div className="flex h-full flex-col">
    <header className={`${headerClass} gap-1 px-2`}>
      <Button aria-label="Back to Start" className="self-center" onClick={showStart} size="icon" title="Back to Start" variant="ghost">
        <BrandLogo className="size-6 text-foreground" title={registry.brand.title} />
      </Button>
      <div className="flex w-[360px] min-w-[120px] shrink items-center">
        <PanelContributions registry={registry} userLocation={chatUserLocation(runId, false, runLocation)} />
      </div>
      {hasRunTitle ? <div className="flex min-w-40 flex-1 items-stretch">
        {launch || draft ? <div aria-label="Run title bar" className="flex min-w-0 flex-1 items-stretch" role="region"><h1 className={pendingTitleClass}>{runTitle ?? NEW_RUN_TITLE}</h1></div>
          : <div aria-label="Run title bar" className="flex min-w-0 flex-1 items-stretch" ref={setHeaderContainer} role="region" />}
      </div> : <div className="flex-1" />}
      {readRuns && runId && <>
        {connection && <span className={connectionClass} title={`Server ${connection}`}>{connection}</span>}
        <RunStateIcon className="self-center px-1.5" state={session?.running ? "running" : "idle"} />
        <StopButton className="self-center" disabled={!writeRuns} label="Stop run" onClick={stop} size="icon-lg" title="Stop the run with all agents and flows" />
      </>}
      <RunPanelActions onOpenSettings={openSettings} onOpenHelp={() => setHelpOpen(true)} />
    </header>
    <div className="relative flex min-h-0 flex-1 flex-col" ref={setWorkspaceContainer}>{content()}</div>
  </div></WorkspaceModalContext.Provider>;
}

interface Launch {
  readonly runId: string;
  readonly entryId: string;
  readonly startOptions?: Readonly<Record<string, unknown>>;
  readonly error?: string;
}

/** A click on a template of the start page: set start options, start the template, done. */
async function launchRun(launch: Launch, registry: PluginRegistry, access: AccessContext): Promise<void> {
  const entry = registry.startEntries.find((candidate) => candidate.id === launch.entryId);
  if (!entry) throw new Error("This template does not exist in this profile.");
  if (!canStartEntry(access, entry.id)) throw new Error(`${entry.title} is not enabled for this user account.`);
  if (launch.startOptions) {
    const options = await getStartOptions(launch.runId);
    const preselected = withoutFixedStartOptions(launch.startOptions, entry.fixedStartOptions);
    for (const [id, value] of initialStartOptionUpdates(options, preselected)) await setStartOption(launch.runId, id, value);
  }
  await startEntryDirectly(launch.runId, entry, null);
}

/** Without a run the panel in VS Code waits for its host's start request; if none comes, it shows the way back instead of an endless loading state. */
function HostWaiting({ children }: { children: ReactNode }) {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), HOST_COMMAND_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return waited
    ? <PendingPanel bar headless state={noRunSelected}>{children}</PendingPanel>
    : <PendingPanel bar headless state={hostStarting} />;
}

/** Header and below it the loading state, as the run panel later shows it centered in the chat; a single mini-app has no header. */
function PendingPanel({ bar = false, children, header, headless = false, state }: { bar?: boolean; children?: ReactNode; header?: ReactNode; headless?: boolean; state: StartupNoticeState }) {
  return <div className="flex h-full flex-col bg-[image:var(--surface-backdrop)]">
    {!headless && <header className={headerClass}>{header}</header>}
    <main className="grid min-h-0 flex-1 place-items-center overflow-hidden p-6"><StartupNotice state={state}>{children}</StartupNotice></main>
    {(bar || !headless) && <footer aria-label="Run status bar" className={statusBarClass} />}
  </div>;
}

function ElementPage({ elementId, registry, runId }: { elementId: string; registry: PluginRegistry; runId: string }) {
  const host = useRunPanelHost();
  const readRuns = useAccess().can("runs.read");
  const { sessions } = useSessionList(readRuns);
  useEffect(() => { host.notify({ type: "ready" }); }, [host]);
  if (!readRuns) return <p className={noticeClass}>No runs are enabled for this user account.</p>;
  return (
    <main className="relative flex h-full min-h-0 min-w-0 flex-1 bg-background @container/chat-content">
      <PluginChat key={runId} layout={{ element: elementId }} registry={registry} session={sessions.find((entry) => entry.id === runId) ?? placeholderSession(runId)} />
    </main>
  );
}

/** In the VS Code webview the extension handles sign-in; the panel only asks for it. */
export function HostLogin() {
  const host = useRunPanelHost();
  return <AccessScreen>
    <h1 className="my-3 text-[1.5rem]">Sign-in required</h1>
    <p className="mb-6 leading-normal text-muted-foreground">Sign-in goes through VS Code. The panel then reloads.</p>
    <Button className="w-full" onClick={() => host.requestLogin()}>Sign in with VS Code</Button>
  </AccessScreen>;
}
