import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeftIcon, LayoutGridIcon } from "lucide-react";
import { canStartEntry, type AccessContext } from "../../../../packages/ragents/src/access";
import { getStartOptions, setStartOption, stopRun } from "../api";
import { startEntryDirectly } from "../chat/requests";
import { initialStartOptionUpdates, withoutFixedStartOptions } from "../StartOptions";
import { AccessScreen, useAccess } from "../AccessContext";
import type { SessionInfo } from "../api";
import { PluginChat } from "../PluginChat";
import type { PluginRegistry } from "../PluginRegistry";
import { usePluginActivation } from "../PluginActivation";
import { PluginFailureNotice } from "../PluginFailureNotice";
import { useRunReadState } from "../run-read-state";
import { SessionList } from "../SessionList";
import { SettingsModal } from "../SettingsModal";
import { Alert, Button, RunStateIcon, StartupNotice, StopButton, type StartupNoticeState } from "../ui";
import type { RunPanelLocation } from "./run-panel-location";
import { RunPanelMenu } from "./RunPanelMenu";
import { useRunPanelHost } from "./host";
import { useSessionList } from "./use-session-list";

const headerClass = "relative z-[80] flex h-header flex-none items-stretch border-b border-border bg-shell shadow-bar";
const connectionClass = "max-w-[120px] self-center truncate rounded-full bg-secondary px-2 py-0.5 text-[0.66rem] font-semibold text-muted-foreground";
const pendingTitleClass = "min-w-0 flex-1 self-center truncate px-1.5 text-[0.82rem] font-semibold";
const STOP_REASON = "Stopped in the run panel";
/** How long the panel in VS Code without a run waits for its host's start request. */
const HOST_COMMAND_TIMEOUT_MS = 5000;
const NEW_RUN_TITLE = "New run";
const listHeaderClass = "relative z-[80] flex h-header flex-none items-center gap-2 border-b border-border bg-shell px-3 shadow-bar";
const noticeClass = "m-auto max-w-[420px] p-6 text-center text-muted-foreground";
const noSelection: ReadonlySet<string> = new Set();
const newDraft = (): SessionInfo => ({ id: crypto.randomUUID(), title: NEW_RUN_TITLE, updatedAt: Date.now() });
const placeholderSession = (id: string, title = "Run"): SessionInfo => ({ id, title, updatedAt: Date.now() });
const profileLoading: StartupNoticeState = { kind: "working", title: "Loading profile", detail: "Loading the server's interface." };
const hostStarting: StartupNoticeState = { kind: "working", title: "Starting run", detail: "Creating the new run." };
const launchStarting: StartupNoticeState = { kind: "working", title: "Starting run", detail: "Starting the template." };
const noRunSelected: StartupNoticeState = { kind: "waiting", title: "No run selected", detail: "On the Start page you start a new run or open an existing one." };
const noRunsReadable: StartupNoticeState = { kind: "error", title: "No runs enabled", detail: "No runs are enabled for this user account." };

/** The run panel: a run with chat and mini-apps, without a run in the browser the run list; layout=app shows exactly one surface element. */
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
  const [runTitle, setRunTitle] = useState<string>();
  const [focusRunId, setFocusRunId] = useState<string>();
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
  const [toolsContainer, setToolsContainer] = useState<HTMLDivElement | null>(null);
  const startDraft = useCallback((startOptions?: Readonly<Record<string, unknown>>, entryId?: string) => {
    const fixed = registry.startEntries.find((entry) => entry.id === entryId)?.fixedStartOptions;
    setDraft({ session: newDraft(), startOptions: startOptions && withoutFixedStartOptions(startOptions, fixed), entryId });
  }, [registry]);
  const createRun = useCallback(() => startDraft(), [startDraft]);
  const openRun = useCallback((id: string, startOptions?: Readonly<Record<string, unknown>>) => {
    setDraft(undefined);
    replaceLaunch(undefined);
    setRunStartOptions(startOptions);
    setRunId(id);
    setFocusRunId(host.kind === "vscode" ? id : undefined);
  }, [host.kind, replaceLaunch]);
  /** A template without a guide starts right away; its result counts only as long as it is the current start. */
  const startLaunch = useCallback((next: Launch) => {
    setDraft(undefined);
    replaceLaunch(next);
    void launchRun(next, registry, access).then(
      () => { if (launching.current === next.runId) openRun(next.runId); },
      (cause: unknown) => { if (launching.current === next.runId) setLaunch({ ...next, error: cause instanceof Error ? cause.message : String(cause) }); },
    );
  }, [access, openRun, registry, replaceLaunch]);
  const selectRun = useCallback((id: string) => {
    setFocusRunId(undefined);
    setRunTitle(undefined);
    setRunId(id);
  }, []);
  /** The back arrow always leads to the Start page; in the browser that is the run list of this server. */
  const showStart = useCallback(() => {
    setFocusRunId(undefined);
    setDraft(undefined);
    replaceLaunch(undefined);
    setRefusal(undefined);
    if (host.kind === "vscode") host.notify({ type: "showStart" });
    else setRunId(undefined);
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
      setFocusRunId(undefined);
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

  const settings = settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} registry={registry} />;
  const pendingHeader = (title: string) => <>
    <Button aria-label="Back to Start" className="self-center" onClick={showStart} size="icon-lg" title="Back to Start" variant="ghost"><ArrowLeftIcon /></Button>
    <strong className={pendingTitleClass}>{title}</strong>
    {connection && <span className={connectionClass} title={`Server ${connection}`}>{connection}</span>}
    <RunPanelMenu onOpenSettings={openSettings} />
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
  if (launch) return <>
    {launch.error === undefined
      ? <PendingPanel header={pendingHeader(runTitle ?? NEW_RUN_TITLE)} state={launchStarting} />
      : <PendingPanel header={pendingHeader(runTitle ?? NEW_RUN_TITLE)} state={{ kind: "error", title: "The run could not be started", detail: launch.error }}>{toStart}</PendingPanel>}
    {settings}
  </>;
  if (host.kind === "vscode" && draft) return <>
    <PendingPanel header={pendingHeader(runTitle ?? NEW_RUN_TITLE)} state={launchStarting} />
    {draftChat}
    {settings}
  </>;
  // In VS Code the extension's Start page chooses the run; without one the panel waits for its request instead of showing a list.
  if (host.kind === "vscode" && !(readRuns && runId)) return <>
    {!readRuns ? <PendingPanel header={pendingHeader(NEW_RUN_TITLE)} state={noRunsReadable}>{toStart}</PendingPanel>
      : refusal !== undefined ? <PendingPanel header={pendingHeader(NEW_RUN_TITLE)} state={{ kind: "error", title: "No new run possible", detail: refusal }}>{toStart}</PendingPanel>
        : <HostWaiting header={pendingHeader(NEW_RUN_TITLE)}>{toStart}</HostWaiting>}
    {settings}
  </>;

  const session = sessions.find((entry) => entry.id === runId);
  const stop = () => {
    if (runId === undefined) return;
    setStopError(undefined);
    void stopRun(runId, STOP_REASON).catch((cause: unknown) => setStopError(`Stop failed: ${cause instanceof Error ? cause.message : String(cause)}`));
  };
  const list = readRuns
    ? <SessionList activeId={runId} onCreate={canCreate ? createRun : undefined} onSelect={selectRun} onToggleSelected={() => undefined} registry={registry} seenRevisions={runReadState.revisions} selectMode={false} selectedIds={noSelection} sessions={sessions} />
    : <p className={noticeClass}>No runs are enabled for this user account.</p>;
  return (
    <div className="flex h-full flex-col bg-[image:var(--surface-backdrop)]">
      {readRuns && runId
        ? (
          <>
            <header className={headerClass}>
              <Button aria-label="Back to Start" className="self-center" onClick={showStart} size="icon-lg" title="Back to Start" variant="ghost"><ArrowLeftIcon /></Button>
              <div aria-label="Run title bar" className="flex min-w-0 flex-1 items-stretch overflow-x-auto no-scrollbar" ref={setHeaderContainer} role="region" />
              {connection && <span className={connectionClass} title={`Server ${connection}`}>{connection}</span>}
              <RunStateIcon className="self-center px-1.5" state={session?.running ? "running" : "idle"} />
              <StopButton className="self-center" disabled={!writeRuns} label="Stop run" onClick={stop} size="icon-lg" title="Stop the run with all agents and flows" />
              <div aria-label="Panel tools" className="flex flex-none items-center empty:hidden" ref={setToolsContainer} role="toolbar" />
              <RunPanelMenu onOpenSettings={openSettings} />
            </header>
            {stopError && <Alert variant="destructive">{stopError}</Alert>}
            <main className="relative z-1 flex min-h-0 min-w-0 flex-1 @container/chat-content">
              <PluginChat
                autoFocusChat={focusRunId === runId && !settingsOpen && !draft}
                onAutoFocusChatSettled={settleAutoFocus}
                toolbarContainer={toolsContainer}
                headerContainer={headerContainer}
                initialStartOptions={runStartOptions}
                key={runId}
                layout="panel"
                onViewed={runReadState.markViewed}
                registry={registry}
                session={session ?? placeholderSession(runId, runTitle)}
                viewing={!draft && !settingsOpen}
              />
            </main>
          </>
        )
        : (
          <>
            <header className={listHeaderClass}>
              <LayoutGridIcon aria-hidden className="size-4 flex-none text-muted-foreground" />
              <strong className="min-w-0 flex-1 truncate text-[0.82rem] font-semibold">{registry.brand.title}</strong>
              <RunPanelMenu onOpenSettings={openSettings} />
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {unreachable && <Alert className="mb-3" variant="destructive">The server is unreachable.</Alert>}
              {list}
            </div>
          </>
        )}
      {settings}
      {draftChat}
    </div>
  );
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
function HostWaiting({ children, header }: { children: ReactNode; header: ReactNode }) {
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), HOST_COMMAND_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return waited
    ? <PendingPanel header={header} state={noRunSelected}>{children}</PendingPanel>
    : <PendingPanel header={header} state={hostStarting} />;
}

/** Header and below it the loading state, as the run panel later shows it centered in the chat; a single mini-app has no header. */
function PendingPanel({ children, header, headless = false, state }: { children?: ReactNode; header?: ReactNode; headless?: boolean; state: StartupNoticeState }) {
  return <div className="flex h-full flex-col bg-[image:var(--surface-backdrop)]">
    {!headless && <header className={headerClass}>{header}</header>}
    <main className="grid min-h-0 flex-1 place-items-center overflow-hidden p-6"><StartupNotice state={state}>{children}</StartupNotice></main>
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
