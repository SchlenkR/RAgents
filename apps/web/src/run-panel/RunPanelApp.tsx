import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeftIcon, LayoutGridIcon } from "lucide-react";
import { canStartEntry, type AccessContext } from "../../../../packages/ragents/src/access";
import { getStartOptions, setStartOption, stopRun } from "../api";
import { startChatEntry, startSkillEntry } from "../chat/requests";
import { preparedRunInput } from "../run-preparation";
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
const environmentClass = "max-w-[120px] self-center truncate rounded-full bg-secondary px-2 py-0.5 text-[0.66rem] font-semibold text-muted-foreground";
const pendingTitleClass = "min-w-0 flex-1 self-center truncate px-1.5 text-[0.82rem] font-semibold";
const STOP_REASON = "Gestoppt im Run-Panel";
/** So lange wartet das Panel in VS Code ohne Run auf die Startanforderung seines Hosts. */
const HOST_COMMAND_TIMEOUT_MS = 5000;
const NEW_RUN_TITLE = "Neuer Run";
const listHeaderClass = "relative z-[80] flex h-header flex-none items-center gap-2 border-b border-border bg-shell px-3 shadow-bar";
const noticeClass = "m-auto max-w-[420px] p-6 text-center text-muted-foreground";
const noSelection: ReadonlySet<string> = new Set();
const newDraft = (): SessionInfo => ({ id: crypto.randomUUID(), title: NEW_RUN_TITLE, updatedAt: Date.now() });
const placeholderSession = (id: string, title = "Run"): SessionInfo => ({ id, title, updatedAt: Date.now() });
const profileLoading: StartupNoticeState = { kind: "working", title: "Produktprofil wird geladen", detail: "Die Oberfläche des Servers wird geladen." };
const hostStarting: StartupNoticeState = { kind: "working", title: "Run wird gestartet", detail: "Der neue Run wird angelegt." };
const launchStarting: StartupNoticeState = { kind: "working", title: "Run wird gestartet", detail: "Die Vorlage wird gestartet." };
const noRunSelected: StartupNoticeState = { kind: "waiting", title: "Kein Run gewählt", detail: "Auf der Start-Seite startest Du einen neuen Run oder öffnest einen vorhandenen." };
const noRunsReadable: StartupNoticeState = { kind: "error", title: "Keine Runs freigegeben", detail: "Für dieses Benutzerkonto sind keine Runs freigegeben." };

/** Das Run-Panel: ein Run mit Chat und Mini-Apps, ohne Run im Browser die Run-Liste; layout=app zeigt genau ein Canvas-Element. */
export function RunPanelApp({ location }: { location: RunPanelLocation }) {
  const activation = usePluginActivation();
  const headless = location.layout === "app";
  if (activation.status === "loading") return <PendingPanel headless={headless} state={profileLoading} />;
  if (activation.status === "failed") return (
    <PendingPanel headless={headless} state={{ kind: "error", title: "Das Produktprofil konnte nicht geladen werden", detail: activation.error }}>
      <Button onClick={() => window.location.reload()} size="sm" variant="outline">Neu laden</Button>
    </PendingPanel>
  );
  const page = location.layout === "app"
    ? <ElementPage elementId={location.elementId} registry={activation.registry} runId={location.runId} />
    : <RunPanelPage environment={location.environment} initialRunId={location.runId} registry={activation.registry} />;
  if (activation.failures.length === 0) return page;
  return (
    <div className="flex h-full flex-col">
      <PluginFailureNotice failures={activation.failures} />
      <div className="flex min-h-0 flex-1 flex-col">{page}</div>
    </div>
  );
}

function RunPanelPage({ environment, initialRunId, registry }: { environment: string | undefined; initialRunId: string | undefined; registry: PluginRegistry }) {
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
  /** Der Run, dessen Start noch zählt; ein späterer Klick, ein anderer Run oder der Weg zurück lösen ihn ab. */
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
  /** Eine Vorlage ohne Leitfaden startet sofort; ihr Ergebnis zählt nur, solange sie der laufende Start ist. */
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
  /** Der Zurück-Pfeil führt immer auf die Start-Seite; im Browser ist das die Run-Liste dieses Servers. */
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
    // Im Panel ist ein Klick ein Klick: nur ein Leitfaden fragt wie in der Web-App vorher nach, der freie Auftrag entsteht im Chat.
    const refused = !canCreate ? "Neue Runs sind für dieses Benutzerkonto nicht freigegeben."
      : message.entryId === undefined && !canCreateFree ? "Freie Runs sind für dieses Benutzerkonto nicht freigegeben." : undefined;
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
    <Button aria-label="Zur Start-Seite" className="self-center" onClick={showStart} size="icon-lg" title="Zur Start-Seite" variant="ghost"><ArrowLeftIcon /></Button>
    <strong className={pendingTitleClass}>{title}</strong>
    {environment && <span className={environmentClass} title={`Umgebung ${environment}`}>{environment}</span>}
    <RunPanelMenu onOpenSettings={openSettings} />
  </>;
  const toStart = <Button onClick={showStart} size="sm" variant="outline">Zur Start-Seite</Button>;
  const draftChat = draft && <PluginChat
    initialStartOptions={draft.startOptions}
    key={draft.session.id}
    onStarted={() => { openRun(draft.session.id); void refresh(); }}
    registry={registry}
    session={draft.session}
    startDialog={{ onClose: host.kind === "vscode" ? showStart : () => setDraft(undefined), initialEntryId: draft.entryId }}
  />;
  if (launch) return <>
    {launch.error === undefined
      ? <PendingPanel header={pendingHeader(runTitle ?? NEW_RUN_TITLE)} state={launchStarting} />
      : <PendingPanel header={pendingHeader(runTitle ?? NEW_RUN_TITLE)} state={{ kind: "error", title: "Der Run konnte nicht gestartet werden", detail: launch.error }}>{toStart}</PendingPanel>}
    {settings}
  </>;
  if (host.kind === "vscode" && draft) return <>
    <PendingPanel header={pendingHeader(runTitle ?? NEW_RUN_TITLE)} state={launchStarting} />
    {draftChat}
    {settings}
  </>;
  // In VS Code wählt die Start-Seite der Erweiterung den Run; ohne ihn wartet das Panel auf deren Anforderung statt eine Liste zu zeigen.
  if (host.kind === "vscode" && !(readRuns && runId)) return <>
    {!readRuns ? <PendingPanel header={pendingHeader(NEW_RUN_TITLE)} state={noRunsReadable}>{toStart}</PendingPanel>
      : refusal !== undefined ? <PendingPanel header={pendingHeader(NEW_RUN_TITLE)} state={{ kind: "error", title: "Kein neuer Run möglich", detail: refusal }}>{toStart}</PendingPanel>
        : <HostWaiting header={pendingHeader(NEW_RUN_TITLE)}>{toStart}</HostWaiting>}
    {settings}
  </>;

  const session = sessions.find((entry) => entry.id === runId);
  const stop = () => {
    if (runId === undefined) return;
    setStopError(undefined);
    void stopRun(runId, STOP_REASON).catch((cause: unknown) => setStopError(`Stoppen fehlgeschlagen: ${cause instanceof Error ? cause.message : String(cause)}`));
  };
  const list = readRuns
    ? <SessionList activeId={runId} onCreate={canCreate ? createRun : undefined} onSelect={selectRun} onToggleSelected={() => undefined} registry={registry} seenRevisions={runReadState.revisions} selectMode={false} selectedIds={noSelection} sessions={sessions} />
    : <p className={noticeClass}>Für dieses Benutzerkonto sind keine Runs freigegeben.</p>;
  return (
    <div className="flex h-full flex-col bg-[image:var(--canvas-backdrop)]">
      {readRuns && runId
        ? (
          <>
            <header className={headerClass}>
              <Button aria-label="Zur Start-Seite" className="self-center" onClick={showStart} size="icon-lg" title="Zur Start-Seite" variant="ghost"><ArrowLeftIcon /></Button>
              <div aria-label="Run-Titelleiste" className="flex min-w-0 flex-1 items-stretch overflow-x-auto no-scrollbar" ref={setHeaderContainer} role="region" />
              {environment && <span className={environmentClass} title={`Umgebung ${environment}`}>{environment}</span>}
              <RunStateIcon className="self-center px-1.5" state={session?.running ? "running" : "idle"} />
              <StopButton className="self-center" disabled={!writeRuns} label="Run stoppen" onClick={stop} size="icon-lg" title="Run mit allen Agenten und Abläufen stoppen" />
              <div aria-label="Werkzeuge des Panels" className="flex flex-none items-center empty:hidden" ref={setToolsContainer} role="toolbar" />
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
              {unreachable && <Alert className="mb-3" variant="destructive">Der Server ist nicht erreichbar.</Alert>}
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

/** Ein Klick auf eine Kachel der Übersicht: Startoptionen setzen, den Einstieg starten, fertig. */
async function launchRun(launch: Launch, registry: PluginRegistry, access: AccessContext): Promise<void> {
  const entry = registry.startEntries.find((candidate) => candidate.id === launch.entryId);
  if (!entry) throw new Error("Diese Startvorlage gibt es in diesem Profil nicht.");
  if (!canStartEntry(access, entry.id)) throw new Error(`${entry.title} ist für dieses Benutzerkonto nicht freigegeben.`);
  if (launch.startOptions) {
    const options = await getStartOptions(launch.runId);
    const preselected = withoutFixedStartOptions(launch.startOptions, entry.fixedStartOptions);
    for (const [id, value] of initialStartOptionUpdates(options, preselected)) await setStartOption(launch.runId, id, value);
  }
  if (entry.action === "script") await startChatEntry(launch.runId, entry.id, null);
  else await startSkillEntry(launch.runId, entry.id, preparedRunInput([], entry.prompt, undefined, entry.skill).text);
}

/** Ohne Run wartet das Panel in VS Code auf die Startanforderung seines Hosts; bleibt sie aus, zeigt es den Weg zurück statt eines endlosen Ladezustands. */
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

/** Kopfzeile und darunter der Ladezustand, so wie das Run-Panel ihn später mittig im Chat zeigt; eine einzelne Mini-App hat keine Kopfzeile. */
function PendingPanel({ children, header, headless = false, state }: { children?: ReactNode; header?: ReactNode; headless?: boolean; state: StartupNoticeState }) {
  return <div className="flex h-full flex-col bg-[image:var(--canvas-backdrop)]">
    {!headless && <header className={headerClass}>{header}</header>}
    <main className="grid min-h-0 flex-1 place-items-center overflow-hidden p-6"><StartupNotice state={state}>{children}</StartupNotice></main>
  </div>;
}

function ElementPage({ elementId, registry, runId }: { elementId: string; registry: PluginRegistry; runId: string }) {
  const host = useRunPanelHost();
  const readRuns = useAccess().can("runs.read");
  const { sessions } = useSessionList(readRuns);
  useEffect(() => { host.notify({ type: "ready" }); }, [host]);
  if (!readRuns) return <p className={noticeClass}>Für dieses Benutzerkonto sind keine Runs freigegeben.</p>;
  return (
    <main className="relative flex h-full min-h-0 min-w-0 flex-1 bg-background @container/chat-content">
      <PluginChat key={runId} layout={{ element: elementId }} registry={registry} session={sessions.find((entry) => entry.id === runId) ?? placeholderSession(runId)} />
    </main>
  );
}

/** Im VS-Code-Webview führt die Erweiterung die Anmeldung; das Panel bittet nur darum. */
export function HostLogin() {
  const host = useRunPanelHost();
  return <AccessScreen>
    <h1 className="my-3 text-[1.5rem]">Anmeldung erforderlich</h1>
    <p className="mb-6 leading-normal text-muted-foreground">Die Anmeldung läuft über VS Code. Danach lädt das Panel neu.</p>
    <Button className="w-full" onClick={() => host.requestLogin()}>In VS Code anmelden</Button>
  </AccessScreen>;
}
