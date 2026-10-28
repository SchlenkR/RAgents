import { Activity, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ListIcon, ServerIcon } from "lucide-react";
import { canStartEntry, type AccessContext } from "../../../../packages/ragents/src/access";
import { deleteSession, getStartOptions, markRunViewed, revokeRunShare, setStartOption, stopRun } from "../api";
import { scriptParameters, startEntryDirectly } from "../chat/requests";
import { initialStartOptionUpdates, withoutFixedStartOptions } from "../StartOptions";
import { AccessScreen, useAccess } from "../AccessContext";
import type { SessionInfo } from "../api";
import { PluginChat, type StartDialog } from "../PluginChat";
import type { PluginRegistry } from "../PluginRegistry";
import { usePluginActivation } from "../PluginActivation";
import { PluginFailureNotice } from "../PluginFailureNotice";
import { connectionRunOf } from "../run-overview";
import { connectionEntriesOf } from "../StartTiles";
import { templateStarting } from "../StartEntryDialog";
import { openSharing, REVOKED_SHARE_NOTICE, revokeSharing, saveSharing } from "../run-sharing";
import { PanelPage } from "../panel/PanelPage";
import type { PanelAction, PanelState } from "../panel/contract";
import { useSharingStore } from "../panel/SharePanel";
import { HelpDialog } from "../HelpDialog";
import { chatUserLocation, type ChatRunLocation } from "../chat/user-location";
import { PanelContributions } from "./PanelContributions";
import { usePageHistory } from "./page-history";
import { PageButtons, PluginPage } from "./PluginPages";
import { WorkspaceModalContext } from "../ui/dialog";
import { SettingsModal } from "../SettingsModal";
import { Alert, Button, HeaderLabel, RunStateIcon, StartupNotice, StopButton, type StartupNoticeState } from "../ui";
import type { RunPanelLocation } from "./run-panel-location";
import { RunPanelActions } from "./RunPanelActions";
import { SERVER_SHARING } from "./RunShareButton";
import { useRunPanelHost } from "./host";
import { useRetainedSession, useSessionList } from "./use-session-list";
import { viewedReporter } from "./viewed-runs";
import { BrandLogo } from "../ui/brand-logo";
import { headerGroupClass, RunHeader } from "./RunHeader";

const headerClass = "relative z-[80] flex min-h-header flex-none flex-wrap items-center border-b border-border bg-shell shadow-bar";
// The run title is the one header item that shrinks; the header measures how far (RunHeader).
const runBarClass = "flex min-w-0 max-w-[22rem] flex-[0_1_auto] items-stretch";
const connectionClass = "flex max-w-[120px] min-w-0 items-center gap-1 self-center rounded-full bg-secondary px-2 py-0.5 type-meta font-semibold text-muted-foreground [&>svg]:size-3 [&>svg]:flex-none";
const pendingTitleClass = "min-w-0 flex-1 self-center truncate px-1.5 type-item";
const STOP_REASON = "Stopped in the run panel";
const statusBarClass = "relative flex min-h-statusbar flex-none items-stretch border-t border-border bg-shell";
const NEW_RUN_TITLE = "New run";
const noticeClass = "m-auto max-w-[420px] p-6 text-center text-muted-foreground";
const newDraft = (): SessionInfo => ({ id: crypto.randomUUID(), title: NEW_RUN_TITLE, updatedAt: Date.now() });
const placeholderSession = (id: string, title = "Run"): SessionInfo => ({ id, title, updatedAt: Date.now() });
const profileLoading: StartupNoticeState = { kind: "working", title: "Loading profile", detail: "Loading the server's interface." };
const runsPage = { id: "runs", title: "Runs", Icon: ListIcon };

/** The run panel: a run with chat and mini-apps, without a run the resolved home; layout=app shows one mini-app. */
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
    : <RunPanelPage connection={location.connection} initialPageId={location.pageId} initialRunId={location.runId} registry={activation.registry} />;
  if (activation.failures.length === 0) return page;
  return (
    <div className="flex h-full flex-col">
      <PluginFailureNotice failures={activation.failures} />
      <div className="flex min-h-0 flex-1 flex-col">{page}</div>
    </div>
  );
}

function RunPanelPage({ connection, initialPageId, initialRunId, registry }: { connection: string | undefined; initialPageId: string | undefined; initialRunId: string | undefined; registry: PluginRegistry }) {
  const host = useRunPanelHost();
  const access = useAccess();
  const readRuns = access.can("runs.read");
  const writeRuns = readRuns && access.can("runs.write");
  const canCreateFree = writeRuns && access.can("runs.create");
  const canCreate = canCreateFree || (writeRuns && registry.scriptEntries.some((entry) => canStartEntry(access, entry.id)));
  const pages = registry.pagesFor(access);
  const homePageId = registry.homePageFor(access)?.id ?? "runs";
  const [runId, setRunId] = useState(initialRunId);
  const [pageId, setPageId] = usePageHistory(host.kind === "browser", initialPageId);
  const [runLocation, setRunLocation] = useState<ChatRunLocation>();
  const [helpOpen, setHelpOpen] = useState(false);
  const [navigationError, setNavigationError] = useState<string>();
  const [navigationNotice, setNavigationNotice] = useState<string>();
  const [sharing, sharingStore] = useSharingStore();
  const [revoking, revokingStore] = useSharingStore();
  /** A run this panel opened under a fresh id; before its first message the user may already choose whom it is shared with. */
  const [freshRunId, setFreshRunId] = useState<string>();
  /** The open run while it is shared with the viewer; if it then leaves the list, the share was taken back. */
  const [watchedShare, setWatchedShare] = useState<string>();
  const reportViewed = useMemo(() => viewedReporter(markRunViewed,
    (cause) => setNavigationError(`The run could not be marked as viewed: ${cause instanceof Error ? cause.message : String(cause)}`)), []);
  const [workspaceContainer, setWorkspaceContainer] = useState<HTMLDivElement | null>(null);
  const [statusContainer, setStatusContainer] = useState<HTMLElement | null>(null);
  const [runTitle, setRunTitle] = useState<string>();
  const [focusRunId, setFocusRunId] = useState(initialRunId);
  const settleAutoFocus = useCallback(() => setFocusRunId((pending) => pending === runId ? undefined : pending), [runId]);
  const [runStartOptions, setRunStartOptions] = useState<Readonly<Record<string, unknown>>>();
  const [draft, setDraft] = useState<Omit<StartDialog, "onClose"> & { readonly session: SessionInfo; readonly startOptions?: Readonly<Record<string, unknown>> }>();
  const [launch, setLaunch] = useState<Launch>();
  /** The run whose start still counts; a later click, another run, or going back replaces it. */
  const launching = useRef<string>(undefined);
  const replaceLaunch = useCallback((next: Launch | undefined) => {
    launching.current = next?.runId;
    setLaunch(next);
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stopError, setStopError] = useState<string>();
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const { sessions, unreachable, refresh } = useSessionList(readRuns && !draft && !launch);
  const [headerContainer, setHeaderContainer] = useState<HTMLDivElement | null>(null);
  const openRun = useCallback((id: string, startOptions?: Readonly<Record<string, unknown>>) => {
    setDraft(undefined);
    replaceLaunch(undefined);
    setPageId(undefined);
    setRunStartOptions(startOptions);
    setRunId(id);
    setFocusRunId(id);
  }, [replaceLaunch, setPageId]);
  const openFreshRun = useCallback((startOptions?: Readonly<Record<string, unknown>>) => {
    const id = crypto.randomUUID();
    openRun(id, startOptions);
    setFreshRunId(id);
  }, [openRun]);
  /** A template without a guide starts right away unless its script declares parameters; its result counts only as long as it is the current start. */
  const startLaunch = useCallback((next: Launch) => {
    setDraft(undefined);
    setPageId(undefined);
    replaceLaunch(next);
    void launchRun(next, registry, access).then(
      (asked) => {
        if (launching.current !== next.runId) return;
        if (asked === undefined) openRun(next.runId);
        else {
          replaceLaunch(undefined);
          setDraft({ ...asked, session: { ...newDraft(), id: next.runId }, startOptions: next.startOptions && withoutFixedStartOptions(next.startOptions, asked.entry.fixedStartOptions) });
        }
      },
      (cause: unknown) => { if (launching.current === next.runId) setLaunch({ ...next, error: cause instanceof Error ? cause.message : String(cause) }); },
    );
  }, [access, openRun, registry, replaceLaunch, setPageId]);
  /** New chat opens a fresh run, a template with a guide only its guide over the current page, every other template starts right away or asks for its script's parameters. */
  const startNew = useCallback((entryId: string | undefined, startOptions?: Readonly<Record<string, unknown>>) => {
    const entry = registry.startEntries.find((candidate) => candidate.id === entryId);
    const guide = entry && registry.guideFor(entry);
    setRunTitle(entry?.title ?? NEW_RUN_TITLE);
    if (entryId === undefined) openFreshRun(startOptions);
    else if (entry !== undefined && guide !== undefined) {
      replaceLaunch(undefined);
      setDraft({ session: newDraft(), entry, prompt: { kind: "guide", guide }, startOptions: startOptions && withoutFixedStartOptions(startOptions, entry.fixedStartOptions) });
    } else startLaunch({ runId: crypto.randomUUID(), entryId, startOptions });
  }, [openFreshRun, registry, replaceLaunch, startLaunch]);
  const newRunRefusal = useCallback((entryId: string | undefined): string | undefined => !canCreate ? "New runs are not enabled for this user account."
    : entryId === undefined ? canCreateFree ? undefined : "Free runs are not enabled for this user account."
      : canStartEntry(access, entryId) ? undefined : "This template is not enabled for this user account.", [access, canCreate, canCreateFree]);
  const leaveToHome = useCallback((notice: string | undefined) => {
    setFocusRunId(undefined);
    setDraft(undefined);
    replaceLaunch(undefined);
    setRunId(undefined);
    setPageId(undefined);
    setNavigationNotice(notice);
    if (host.kind === "vscode") host.notify({ type: "showStart", ...(notice === undefined ? {} : { notice }) });
  }, [host, replaceLaunch, setPageId]);
  /** A view takes the main area from the home or the open run, which stays selected and returns when the page is left. */
  const openPage = useCallback((id: string) => {
    setDraft(undefined);
    replaceLaunch(undefined);
    setNavigationError(undefined);
    setNavigationNotice(undefined);
    setPageId(id);
    if (host.kind === "vscode" && id === "runs") host.notify({ type: "pageChanged", page: "runs" });
  }, [host, replaceLaunch, setPageId]);
  const openPageRun = useCallback((id: string) => {
    setRunTitle(undefined);
    openRun(id);
  }, [openRun]);
  const showHome = useCallback(() => leaveToHome(undefined), [leaveToHome]);

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
    if (message.type === "selectRun" || message.type === "showPage") {
      const selectedRun = message.type === "selectRun" ? message.runId ?? undefined : undefined;
      setFocusRunId(selectedRun);
      setDraft(undefined);
      replaceLaunch(undefined);
      setRunStartOptions(undefined);
      setRunTitle(undefined);
      setRunId(selectedRun);
      setPageId(message.type === "showPage" && message.page === "runs" ? "runs" : undefined);
      setNavigationNotice(message.type === "showPage" ? message.notice : undefined);
      setNavigationError(undefined);
      setSettingsOpen(false);
      setHelpOpen(false);
    }
    if (message.type !== "newRun") return;
    const refused = newRunRefusal(message.entryId);
    setNavigationError(refused);
    if (refused === undefined) startNew(message.entryId, message.startOptions);
  }), [host, newRunRefusal, replaceLaunch, setPageId, startNew]);
  useEffect(() => { host.notify({ type: "ready" }); }, [host]);
  useEffect(() => { host.notify({ type: "runChanged", runId: runId ?? null }); }, [host, runId]);

  const settings = <>
    {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} registry={registry} />}
    {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)}
      sampleEntries={registry.scriptEntries.filter((entry) => entry.listed !== false && canStartEntry(access, entry.id)).map((entry) => entry.id)}
      onStartSample={(entryId) => {
        if (!canStartEntry(access, entryId)) return;
        setHelpOpen(false);
        startNew(entryId);
      }} />}
  </>;
  const toHome = <Button onClick={showHome} size="sm" variant="outline">Back to home</Button>;
  const draftChat = draft && <PluginChat
    initialStartOptions={draft.startOptions}
    key={draft.session.id}
    onStarted={() => { openRun(draft.session.id); setRunTitle((title) => title ?? NEW_RUN_TITLE); void refresh(); }}
    registry={registry}
    session={draft.session}
    startDialog={{ entry: draft.entry, prompt: draft.prompt, onClose: () => setDraft(undefined) }}
  />;
  const unavailablePage = pageId !== undefined && pageId !== "runs" && !pages.some((entry) => entry.id === pageId) ? pageId : undefined;
  const currentPageId = unavailablePage !== undefined ? homePageId : pageId ?? (runId === undefined ? homePageId : undefined);
  const activePage = launch === undefined ? pages.find((entry) => entry.id === currentPageId) : undefined;
  const viewingPage = launch === undefined && (activePage !== undefined || currentPageId === "runs");
  const hasRunTitle = readRuns && !viewingPage && Boolean(runId || launch);
  const listed = sessions.find((entry) => entry.id === runId);
  const session = useRetainedSession(sessions, runId);
  const shareableBeforeStart = access.enabled && access.user !== null && writeRuns && runId !== undefined && runId === freshRunId;
  const pendingSession = useMemo(() => runId === undefined ? undefined
    : { ...placeholderSession(runId, runTitle), ...(shareableBeforeStart ? { canShare: true as const } : {}) }, [runId, runTitle, shareableBeforeStart]);
  useEffect(() => {
    if (runId === undefined) return;
    if (listed?.sharedAccess !== undefined) setWatchedShare(runId);
    else if (listed === undefined && watchedShare === runId) {
      setWatchedShare(undefined);
      leaveToHome(REVOKED_SHARE_NOTICE);
    }
  }, [leaveToHome, listed, runId, watchedShare]);
  const stop = () => {
    if (runId === undefined) return;
    setStopError(undefined);
    void stopRun(runId, STOP_REASON).catch((cause: unknown) => setStopError(`Stop failed: ${cause instanceof Error ? cause.message : String(cause)}`));
  };
  const content = () => {
    if (launch) return <>
      {launch.error === undefined
        ? <PendingPanel bar headless state={templateStarting} />
        : <PendingPanel bar headless state={{ kind: "error", title: "The run could not be started", detail: launch.error }}>{toHome}</PendingPanel>}
      {settings}
    </>;
    const connectionName = connection ?? registry.brand.title;
    const navigationState: PanelState = {
      theme: "light",
      page: "runs",
      profileSuggestions: [],
      problem: navigationError,
      notice: navigationNotice ?? (unavailablePage === undefined ? undefined : `The page ${unavailablePage} is not available.`),
      sharing,
      revoking,
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
        entries: connectionEntriesOf(registry, access),
        runs: readRuns ? sessions.map(connectionRunOf) : [],
      }],
    };
    const navigate = (action: PanelAction) => {
      setNavigationError(undefined);
      setNavigationNotice(undefined);
      switch (action.action) {
        case "page":
          if (action.page === "connections") throw new Error("The browser is connected to its current server.");
          if (action.page === "start") leaveToHome(undefined);
          else openPage("runs");
          return;
        case "openRun": setRunTitle(undefined); openRun(action.runId); return;
        case "newRun": {
          if (host.kind === "vscode") {
            host.notify({ type: "newRun", ...(action.entryId === undefined ? {} : { entryId: action.entryId }) });
            return;
          }
          const refused = newRunRefusal(action.entryId);
          if (refused !== undefined) throw new Error(refused);
          startNew(action.entryId);
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
        case "openSharing": void openSharing(action.name, action.runId, SERVER_SHARING, sharingStore); return;
        case "share":
          void saveSharing(action.name, action.runId, action.sharing, SERVER_SHARING, sharingStore).then(refresh,
            (cause: unknown) => setNavigationError(cause instanceof Error ? cause.message : String(cause)));
          return;
        case "revokeShare":
          void revokeSharing(action.name, action.runId, action.target, revokeRunShare, revokingStore).then(refresh,
            (cause: unknown) => setNavigationError(cause instanceof Error ? cause.message : String(cause)));
          return;
        case "closeSharing": sharingStore.set(undefined); return;
        default: throw new Error(`Unsupported browser action: ${action.action}`);
      }
    };
    return (
      <div className="flex h-full flex-col bg-[image:var(--surface-backdrop)]">
        {readRuns && runId && (
          <Activity mode={viewingPage ? "hidden" : "visible"}>
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
                onViewed={reportViewed}
                registry={registry}
                session={session ?? pendingSession!}
                viewing={!draft && !settingsOpen && !helpOpen && !viewingPage}
              />
            </main>
            <footer aria-label="Run status bar" className={statusBarClass} ref={setStatusContainer} />
          </Activity>
        )}
        {activePage && <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {navigationState.notice && <p className="type-body px-3 pt-3 text-muted-foreground [overflow-wrap:anywhere]" role="status">{navigationState.notice}</p>}
          <div className="min-h-0 flex-1"><PluginPage onOpenRun={openPageRun} page={activePage} /></div>
        </div>}
        <Activity mode={activePage || (readRuns && runId && !viewingPage) ? "hidden" : "visible"}>
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            {unreachable && <Alert className="mb-3" variant="destructive">The server is unreachable.</Alert>}
            <PanelPage send={navigate} state={navigationState} />
          </div>
        </Activity>
        {settings}
        {draftChat}
      </div>
    );
  };
  return <WorkspaceModalContext.Provider value={workspaceContainer}><div className="flex h-full flex-col">
    <RunHeader leading={<>
      <div className={headerGroupClass}>
        <Button aria-label="Home" className="self-center" onClick={showHome} size="icon" variant="ghost">
          <BrandLogo className="size-6 text-foreground" title={registry.brand.title} />
        </Button>
        <div className={`${headerGroupClass} empty:hidden group-data-wrap/run-header:flex-1`}>
          <PageButtons active={viewingPage ? currentPageId : undefined} onOpen={openPage} pages={[runsPage, ...pages]} />
          <PanelContributions registry={registry} userLocation={chatUserLocation(viewingPage ? undefined : runId, false, runLocation)} />
        </div>
      </div>
      {hasRunTitle && <div className={runBarClass}>
        {launch ? <div aria-label="Run title bar" className="flex min-w-0 flex-1 items-stretch" role="region"><h1 className={pendingTitleClass} data-header-title>{runTitle ?? NEW_RUN_TITLE}</h1></div>
          : <div aria-label="Run title bar" className="flex min-w-0 flex-1 items-stretch" ref={setHeaderContainer} role="region" />}
      </div>}
    </>} trailing={<div className={`${headerGroupClass} ml-auto justify-end`}>
        {connection && <span className={connectionClass} aria-label={`Environment ${connection}`}><ServerIcon aria-hidden /><HeaderLabel>{connection}</HeaderLabel></span>}
        {readRuns && runId && !viewingPage && <>
          <RunStateIcon className="self-center px-1.5" state={session?.state === "stopped" ? "stopped" : session?.running ? "running" : "idle"} />
          {session?.sharedAccess !== "read" && <StopButton className="self-center" disabled={!writeRuns} label="Stop run" onClick={stop} size="icon-lg" aria-description="Stop the run with all agents and flows" />}
        </>}
        <RunPanelActions onOpenSettings={openSettings} onOpenHelp={() => setHelpOpen(true)} />
    </div>}>
    <div className="relative flex min-h-0 flex-1 flex-col" ref={setWorkspaceContainer}>{content()}</div>
    </RunHeader>
  </div></WorkspaceModalContext.Provider>;
}

interface Launch {
  readonly runId: string;
  readonly entryId: string;
  readonly startOptions?: Readonly<Record<string, unknown>>;
  readonly error?: string;
}

/** A click on a template of the start page: set start options, start the template, done; a script that declares parameters is not started but returns the form to ask them in. */
async function launchRun(launch: Launch, registry: PluginRegistry, access: AccessContext): Promise<Pick<StartDialog, "entry" | "prompt"> | undefined> {
  const entry = registry.startEntries.find((candidate) => candidate.id === launch.entryId);
  if (!entry) throw new Error("This template does not exist in this profile.");
  if (!canStartEntry(access, entry.id)) throw new Error(`${entry.title} is not enabled for this user account.`);
  if (entry.action === "script") {
    const parameters = await scriptParameters(launch.runId, entry.id);
    if (Object.keys(parameters.properties).length > 0) return { entry, prompt: { kind: "form", parameters } };
  }
  if (launch.startOptions) {
    const options = await getStartOptions(launch.runId);
    const preselected = withoutFixedStartOptions(launch.startOptions, entry.fixedStartOptions);
    for (const [id, value] of initialStartOptionUpdates(options, preselected)) await setStartOption(launch.runId, id, value);
  }
  await startEntryDirectly(launch.runId, entry, {});
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
  const session = useRetainedSession(sessions, runId);
  const pendingSession = useMemo(() => placeholderSession(runId), [runId]);
  const layout = useMemo(() => ({ element: elementId }), [elementId]);
  useEffect(() => { host.notify({ type: "ready" }); }, [host]);
  if (!readRuns) return <p className={noticeClass}>No runs are enabled for this user account.</p>;
  return (
    <main className="relative flex h-full min-h-0 min-w-0 flex-1 bg-background @container/chat-content">
      <PluginChat key={runId} layout={layout} registry={registry} session={session ?? pendingSession} />
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
