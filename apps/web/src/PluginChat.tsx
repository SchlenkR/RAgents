import { runApps, selectedRunApp, RunAppView } from "./run-apps";
import { isRecord } from "./lib/guards";
import { canStopRun, RunAccessScope, useAccess } from "./AccessContext";
import { readOnlyReason } from "./run-sharing";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChatInputToolbar, ChatMessages, ChatPanel, type ChatAttachmentInput, type ChatEvent, type ToolInfo } from "quassel";
import { primaryChatState, primaryIsProgram, programChatNotice, runIsWorking, runPausable } from "./chat/chat-target";
import { PausedRunNotice } from "./chat/PausedRunNotice";
import { RunUrls } from "./chat/QuasselHost";
import { StoppedActorNotice } from "./chat/StoppedActorNotice";
import { ChatViewSwitches, useChatViewSettings } from "./chat-view-settings";
import { useChat } from "./chat/useChat";
import { runUserLocation, type ChatRunLocation } from "./chat/user-location";
import { dismissAction, pauseRun, type SessionInfo } from "./api";
import { useRunStore } from "./RunStore";
import { withToolSummaries } from "./toolLine";
import { StartOptionControls, StartOptionsProvider, useStartOptions } from "./StartOptions";
import { useAttachmentCapabilities } from "./chat/useAttachmentCapabilities";
import { StartSelection } from "./StartSelection";
import { StatusGroup } from "./StatusGroup";
import { RunPanelHeader } from "./run-panel/RunPanelHeader";
import { DockToolsContext, DockWorkspace } from "./run-panel/DockWorkspace";
import { activeDockTool, selectDockPanel, workspaceTabPanelId } from "./run-panel/dock-state";
import { useDockStorage } from "./run-panel/dock-storage";
import { useRunPanelHost } from "./run-panel/host";
import { RunPanelRail } from "./run-panel/RunPanelRail";
import { RunPanelWorkspace } from "./run-panel/RunPanelWorkspace";
import { activeWorkspaceTab, saveRunPanelWorkspaceState, useRunPanelWorkspaceState } from "./run-panel/workspace-state";
import { cn, DialogTitle } from "./ui";
import { SurfaceModalContext, RunModalContext } from "./ui/dialog";
import { Modal } from "./ui/modal";
import {
  ChatStepsProvider,
  PluginSessionProviders,
  useActionRenderer,
  useToolRenderer,
  primaryChatActor,
  useSurfaceController,
  type ChatDisplayOptions,
  type PluginEvent,
  type PluginRegistry,
  type SessionContext,
  type SessionNavigation,
  type WorkspaceTabContribution,
} from "./PluginRegistry";


const chatElementClass = "flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-soft/60 bg-card/55";

/** The shared run panel or one mini-app in an editor. */
export type ChatLayout = "panel" | { element: string };

interface PluginChatProps {
  autoFocusChat?: boolean;
  onAutoFocusChatSettled?: () => void;
  layout?: ChatLayout;
  toolbarContainer?: HTMLElement | null;
  statusContainer?: HTMLElement | null;
  headerContainer?: HTMLElement | null;
  startDialog?: { onClose: () => void; initialEntryId?: string };
  initialStartOptions?: Readonly<Record<string, unknown>>;
  onStarted?: () => void;
  onLocationChange?: (location: ChatRunLocation) => void;
  onViewed?: (runId: string, revision: number) => void;
  viewing?: boolean;
  registry: PluginRegistry;
  session: SessionInfo;
}

interface ChatWorkspaceProps {
  autoFocusChat?: boolean;
  onAutoFocusChatSettled?: () => void;
  layout: ChatLayout;
  toolbarContainer?: HTMLElement | null;
  statusContainer?: HTMLElement | null;
  panelState: "expanded" | "collapsed";
  onTogglePanel: () => void;
  headerContainer?: HTMLElement | null;
  startDialog?: { onClose: () => void; initialEntryId?: string };
  onStarted: () => void;
  onModalContainer: (element: HTMLDivElement | null) => void;
  onSurfaceModalContainer: (element: HTMLDivElement | null) => void;
  navigation: SessionNavigation;
  pendingTabIds: readonly string[];
  registry: PluginRegistry;
  runError?: string;
  session: SessionContext;
  tabs: readonly WorkspaceTabContribution[];
}

export function PluginChat({ autoFocusChat, onAutoFocusChatSettled, layout = "panel", headerContainer, toolbarContainer, statusContainer, initialStartOptions, onStarted, onLocationChange, onViewed, viewing = false, registry, session, startDialog }: PluginChatProps) {
  const access = useAccess();
  const host = useRunPanelHost();
  const startOnly = startDialog !== undefined;
  const [modalContainer, setModalContainer] = useState<HTMLDivElement | null>(null);
  const [surfaceModalContainer, setSurfaceModalContainer] = useState<HTMLDivElement | null>(null);
  const [pluginEvents, setPluginEvents] = useState<readonly PluginEvent[]>([]);
  const onChatEvent = useCallback((event: ChatEvent) => {
    if (event.kind === "reset") setPluginEvents([]);
    if (event.kind !== "plugin") return;
    const { pluginId, type, payload, at } = event;
    setPluginEvents((current) => [...current, { pluginId, type, payload, at }]);
  }, []);
  const { messages, running, connected, startup, send: sendMessage, startSkill, start } = useChat(session.id, onChatEvent, !startOnly);
  const send = useCallback((text: string, attachments?: ChatAttachmentInput[], entryId?: string) =>
    entryId === undefined ? sendMessage(text, attachments) : startSkill(entryId, text, attachments), [sendMessage, startSkill]);
  const runStore = useRunStore(session.id, startOnly || registry.needsRunView || onViewed !== undefined, !startOnly);
  useEffect(() => {
    const view = runStore.view;
    if (!viewing || !onViewed || runStore.error || !isRecord(view) || view.id !== session.id || typeof view.revision !== "number") return;
    const revision = view.revision;
    const markViewed = () => {
      if (document.visibilityState === "visible") onViewed(session.id, revision);
    };
    markViewed();
    document.addEventListener("visibilitychange", markViewed);
    return () => document.removeEventListener("visibilitychange", markViewed);
  }, [viewing, onViewed, runStore.view, runStore.error, session.id]);
  const startReported = useRef(false);
  const startMounted = useRef(false);
  useEffect(() => {
    startMounted.current = true;
    return () => { startMounted.current = false; };
  }, []);
  const reportStarted = useCallback(() => {
    if (!startMounted.current || startReported.current) return;
    startReported.current = true;
    onStarted?.();
  }, [onStarted]);
  const runExists = runStore.view !== undefined;
  useEffect(() => {
    if (startOnly && runExists) reportStarted();
  }, [reportStarted, runExists, startOnly]);
  const [tabSelections, setTabSelections] = useState<Record<string, unknown>>({});
  const [pendingTabIds, setPendingTabIds] = useState<readonly string[]>([]);
  const knownClientToolIds = useRef<Set<string>>(new Set());

  const sessionContext = useMemo<SessionContext>(() => ({
    connected,
    pluginEvents,
    messages,
    actorConversations: runStore.conversations,
    conversationError: runStore.error,
    runView: runStore.view,
    running,
    startup,
    send,
    session,
    start,
  }), [connected, pluginEvents, messages, runStore.view, runStore.conversations, runStore.error, running, startup, send, session, start]);

  const registeredTabs = useMemo(() => registry.registeredTabs(sessionContext, access).filter((tab) => !tab.hosts || tab.hosts.includes(host.kind)), [access, host.kind, registry, sessionContext]);
  const availableTabs = useMemo(() => registry.availableTabs(sessionContext, access).filter((tab) => !tab.hosts || tab.hosts.includes(host.kind)), [access, host.kind, registry, sessionContext]);
  const { activeTabId, panelState, showTab, togglePanel } = useWorkspaceTabs(session.id, availableTabs);

  const openTab = useCallback((tabId: string, selection?: unknown) => {
    if (!registeredTabs.some((tab) => tab.id === tabId)) {
      throw new Error("Sidebar tab is not registered: " + tabId);
    }
    if (selection !== undefined) {
      setTabSelections((current) => ({ ...current, [tabId]: selection }));
    }
    showTab(tabId);
  }, [registeredTabs, showTab]);

  const selectionFor = useCallback((tabId: string) => tabSelections[tabId], [tabSelections]);

  const revealEntity = useCallback((entity: { type: string; id: string }) => {
    const target = registry.targetForEntity(entity, sessionContext);
    if (!target || !registeredTabs.some((tab) => tab.id === target.tabId)) return false;
    openTab(target.tabId, target.selection);
    return true;
  }, [openTab, registeredTabs, registry, sessionContext]);

  const navigation = useMemo<SessionNavigation>(() => ({
    activeTabId,
    openTab,
    revealEntity,
    selectionFor,
  }), [activeTabId, openTab, revealEntity, selectionFor]);

  useEffect(() => {
    const targets: Array<{ callId: string; tabId: string }> = [];
    for (const message of messages) {
      const tool = message.tool;
      if (!tool || knownClientToolIds.current.has(tool.id)) continue;
      const target = registry.presenterFor(tool)?.reveal?.(tool, sessionContext);
      if (target) targets.push({ callId: tool.id, tabId: target.tabId });
    }
    for (const target of targets) knownClientToolIds.current.add(target.callId);
    if (targets.length === 0) return;
    setPendingTabIds((current) => {
      const added = targets
        .map((target) => target.tabId)
        .filter((tabId) => tabId !== activeTabId && !current.includes(tabId));
      return added.length === 0 ? current : [...new Set([...current, ...added])];
    });
  }, [activeTabId, messages, registry, sessionContext]);

  useEffect(() => {
    setPendingTabIds((current) =>
      current.includes(activeTabId) ? current.filter((tabId) => tabId !== activeTabId) : current);
  }, [activeTabId]);

  return (
    <RunAccessScope operable={session.operable !== false} stoppable={session.sharedAccess !== "read"}>
    <RunModalContext.Provider value={startOnly ? null : modalContainer}>
    <SurfaceModalContext.Provider value={startOnly ? null : surfaceModalContainer}>
    <ChatStepsProvider policy={registry.chatDisplayPolicy}>
      <StartOptionsProvider
        connected={connected}
        initialValues={initialStartOptions}
        messageCount={messages.length}
        sessionId={session.id}
      >
        <PluginSessionProviders navigation={navigation} registry={registry} session={sessionContext}>
          <RunUrls resolve={registry.resolveRunUrl} runId={session.id}>
          {!startOnly && onLocationChange && <UserLocationReporter activeTabId={navigation.activeTabId} onChange={onLocationChange}
            panelVisible={panelState === "expanded"} runId={session.id} tabs={availableTabs} />}
          <ChatWorkspace
            autoFocusChat={autoFocusChat}
            onAutoFocusChatSettled={onAutoFocusChatSettled}
            layout={layout}
            toolbarContainer={toolbarContainer}
            panelState={panelState}
            onTogglePanel={togglePanel}
            headerContainer={headerContainer}
            statusContainer={statusContainer}
            onModalContainer={setModalContainer}
            onSurfaceModalContainer={setSurfaceModalContainer}
            onStarted={reportStarted}
            startDialog={startDialog}
            navigation={navigation}
            pendingTabIds={pendingTabIds}
            registry={registry}
            runError={runStore.error}
            session={sessionContext}
            tabs={availableTabs}
          />
          </RunUrls>
        </PluginSessionProviders>
      </StartOptionsProvider>
    </ChatStepsProvider>
    </SurfaceModalContext.Provider>
    </RunModalContext.Provider>
    </RunAccessScope>
  );
}

function useWorkspaceTabs(runId: string, availableTabs: readonly WorkspaceTabContribution[]) {
  const host = useRunPanelHost();
  const { state: dock, update: updateDock } = useDockStorage(runId);
  const stored = useRunPanelWorkspaceState(runId);
  const dockTab = activeDockTool(dock);
  const activeTabId = host.kind === "browser" ? availableTabs.find((tab) => tab.id === dockTab)?.id ?? "" : activeWorkspaceTab(stored, availableTabs);
  const panelState = activeTabId === "" ? "collapsed" : "expanded";
  const firstTabId = availableTabs[0]?.id ?? null;
  const showTab = useCallback((tabId: string) => {
    const tab = availableTabs.find((entry) => entry.id === tabId);
    if (host.kind === "browser") updateDock((state) => tab ? selectDockPanel(state, workspaceTabPanelId(tab)) : state);
    else saveRunPanelWorkspaceState(runId, { ...stored, tab: tabId });
  }, [availableTabs, updateDock, host.kind, runId, stored]);
  const togglePanel = useCallback(() => {
    if (host.kind === "browser") updateDock((state) => ({ ...state, side: { ...state.side, tab: null, sticky: false } }));
    else saveRunPanelWorkspaceState(runId, { ...stored, tab: panelState === "expanded" ? null : stored.tab ?? firstTabId });
  }, [updateDock, host.kind, firstTabId, panelState, runId, stored]);
  return { activeTabId, panelState, showTab, togglePanel } as const;
}

function UserLocationReporter({ activeTabId, onChange, panelVisible, runId, tabs }: {
  activeTabId: string;
  onChange: (location: ChatRunLocation) => void;
  panelVisible: boolean;
  runId: string;
  tabs: readonly WorkspaceTabContribution[];
}) {
  const surface = useSurfaceController();
  const location = runUserLocation(runId, activeTabId, tabs, panelVisible, surface?.selection);
  const { tab, selection } = location;
  const type = selection?.type;
  const id = selection?.id;
  useLayoutEffect(() => {
    onChange({ runId, tab, selection: type !== undefined && id !== undefined ? { type, id } : null });
  }, [onChange, runId, tab, type, id]);
  return null;
}

function ChatWorkspace({
  autoFocusChat,
  onAutoFocusChatSettled,
  layout,
  toolbarContainer = null,
  panelState,
  onTogglePanel,
  headerContainer,
  statusContainer = null,
  onModalContainer,
  onSurfaceModalContainer,
  onStarted,
  startDialog,
  navigation,
  pendingTabIds,
  registry,
  runError,
  session,
  tabs,
}: ChatWorkspaceProps) {
  const access = useAccess();
  const [dockActionsContainer, setDockActionsContainer] = useState<HTMLDivElement | null>(null);
  const headerContributions = registry.headersFor(session, access);
  const startSession = useMemo<SessionContext>(() => {
    const attempt = async (work: () => Promise<void>) => {
      await work();
      onStarted();
    };
    return {
      ...session,
      send: (text, attachments, entryId) => attempt(() => session.send(text, attachments, entryId)),
      start: (entryId, input) => attempt(() => session.start(entryId, input)),
    };
  }, [onStarted, session]);
  const attention = registry.attention
    .map((contribution) => contribution.assess(session))
    .find((state) => state !== undefined);
  const attentionActive = attention !== undefined;
  useEffect(() => {
    if (!attentionActive) return;
    const previous = document.title;
    document.title = "\u{25CF} " + previous;
    return () => {
      document.title = previous;
    };
  }, [attentionActive]);
  const host = useRunPanelHost();
  const hasWorkspace = host.kind === "vscode" && !startDialog && tabs.length > 0;
  const SurfaceRunPanel = registry.surface?.RunPanel;
  const bindCompactContainers = useCallback((element: HTMLDivElement | null) => {
    onModalContainer(element);
    onSurfaceModalContainer(element);
  }, [onSurfaceModalContainer, onModalContainer]);

  const renderTool = useToolRenderer();

  const renderChat = (options: ChatDisplayOptions = {}) => (
    <ChatSurface
      autoFocus={autoFocusChat && options.autoFocus !== false}
      onAutoFocusSettled={onAutoFocusChatSettled}
      options={options}
      registry={registry}
      renderTool={renderTool}
      session={session}
    />
  );

  if (startDialog) return (
    <Modal className="gap-0 p-0 [&_[data-slot=dialog-body]:has([data-preparation])]:overflow-hidden" nextBehavior="push" onClose={startDialog.onClose} scope="page" showCloseButton size="full">
      <DialogTitle className="sr-only">New run</DialogTitle>
      <StartSelection registry={registry} session={startSession} initialEntryId={startDialog.initialEntryId} onOpen={onStarted} />
    </Modal>
  );

  const status = registry.sessionStatus.filter((entry) => !entry.readRight || access.can(entry.readRight)).map(({ id, order, Status }) => <StatusGroup container={statusContainer} key={id} label="Run actions" order={order}>
    <Status navigation={navigation} session={session} />
  </StatusGroup>);
  const header = headerContainer && createPortal(
    <RunPanelHeader actionsRef={setDockActionsContainer} attention={attention} contributions={headerContributions} navigation={navigation} registry={registry} runError={runError} session={session} working={session.running} />, headerContainer);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {status}
      {header}
      <div className="relative isolate flex min-h-0 min-w-0 flex-1" ref={bindCompactContainers}>
        {typeof layout === "object"
          ? <SurfaceElementView elementId={layout.element} navigation={navigation} registry={registry} session={session} />
          : <DockToolsContext.Provider value={{ tabs, pendingTabIds, actionsContainer: dockActionsContainer }}>
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              {SurfaceRunPanel
                ? <SurfaceRunPanel
                  autoFocusChat={autoFocusChat}
                  onAutoFocusChatSettled={onAutoFocusChatSettled}
                  toolbarContainer={toolbarContainer}
                  statusContainer={statusContainer}
                  cardSections={registry.cardSections}
                  surfaceElements={registry.surfaceElements}
                  navigation={navigation}
                  renderChat={renderChat}
                  session={session}
                  tabIds={tabs.map((tab) => tab.id)}
                />
                : host.kind === "browser"
                  ? <DockWorkspace apps={runApps(session, registry.surfaceElements)} chat={renderChat()} navigation={navigation} session={session} />
                  : <DefaultCenter renderChat={renderChat} />}
              {hasWorkspace && <RunPanelWorkspace navigation={navigation} onClose={onTogglePanel} open={panelState === "expanded"} session={session} tabs={tabs} />}
            </div>
            {hasWorkspace && <RunPanelRail navigation={navigation} onClose={onTogglePanel} open={panelState === "expanded"} pendingTabIds={pendingTabIds} session={session} tabs={tabs} />}
          </DockToolsContext.Provider>}
      </div>
    </div>
  );
}

function DefaultCenter({ renderChat }: {
  renderChat: (options?: ChatDisplayOptions) => ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-view="chat">
        {renderChat()}
      </div>
    </div>
  );
}

/** A surface element at full size, for example a mini-app in the VS Code editor area. */
function SurfaceElementView({ elementId, navigation, registry, session }: {
  elementId: string;
  navigation: SessionNavigation;
  registry: PluginRegistry;
  session: SessionContext;
}) {
  const match = selectedRunApp(runApps(session, registry.surfaceElements), elementId);
  if (!match) return <div className="m-auto max-w-[420px] p-6 text-center text-muted-foreground" role="status">
    {session.runView === undefined ? "Loading run ..." : "This mini-app is not available in the run: it was removed or is hidden, or the address is wrong."}
  </div>;
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-view="element">
    <RunAppView app={match} navigation={navigation} session={session} />
  </div>;
}

function ChatSurface({
  autoFocus,
  onAutoFocusSettled,
  options,
  registry,
  renderTool,
  session,
}: {
  autoFocus?: boolean;
  onAutoFocusSettled?: () => void;
  options: ChatDisplayOptions;
  registry: PluginRegistry;
  renderTool: (tool: ToolInfo) => ReactNode;
  session: SessionContext;
}) {
  const access = useAccess();
  const writable = access.can("runs.write");
  const renderAction = useActionRenderer();
  const chatView = useChatViewSettings(session.session.id, primaryChatActor(session.runView), "coordinator");
  const [sendError, setSendError] = useState<string>();
  const startOptions = useStartOptions();
  const attachments = useAttachmentCapabilities(session.session.id, "primary", JSON.stringify(startOptions.options.map(({ id, value }) => [id, value])));
  const messages = useMemo(() => withToolSummaries(session.messages), [session.messages]);
  const working = session.connected && (session.running || runIsWorking(session.runView, session.session.id));
  const partner = primaryChatState(session.runView, session.session.id);
  const stoppable = canStopRun(access) && session.connected && runPausable(session.runView, session.session.id, session.running);
  return (
    <ChatPanel
      className={cn(chatElementClass, options.chatElementClassName)}
      composer={
        primaryIsProgram(session.runView, session.session.id) ? <div className="flex min-w-0 flex-col gap-1.5">
          <PausedRunNotice runId={session.session.id} view={session.runView} />
          <p className="text-muted-foreground">{programChatNotice}</p>
          <div className="flex min-w-0 flex-wrap items-center gap-2">{options.toolbarLeft}<ChatViewSwitches settings={chatView} /></div>
        </div>
        : partner.kind === "stopped" ? <div className="[--qsl-input-card-radius:var(--radius-lg)]"><StoppedActorNotice actor={partner.actor} runId={session.session.id} toolbar={<>{options.toolbarLeft}<ChatViewSwitches settings={chatView} /></>} /></div>
        : <div className="[--qsl-input-card-radius:var(--radius-lg)]">
          <PausedRunNotice runId={session.session.id} view={session.runView} />
          {sendError && <p className="text-[0.8rem] text-destructive" role="alert">{sendError}</p>}
          <ChatInputToolbar
            {...attachments}
            autoFocus={autoFocus}
            onAutoFocusSettled={onAutoFocusSettled}
            disabled={!session.connected || !writable}
            maxRows={4}
            texts={writable ? undefined : { placeholder: readOnlyReason(session.session) }}
            onSend={(text, attachments) => {
              setSendError(undefined);
              return session.send(text, attachments);
            }}
            onStop={stoppable ? () => {
              setSendError(undefined);
              void pauseRun(session.session.id).catch((error: unknown) => setSendError(error instanceof Error ? error.message : String(error)));
            } : undefined}
            rows={1}
            running={working}
            toolbarLeft={
              <>
                {options.toolbarLeft}
                <ChatViewSwitches settings={chatView} />
              </>
            }
            toolbarRight={<StartOptionControls disabled={!session.connected || !writable} placement="composer" registry={registry} />}
          />
        </div>
      }
    >
      {options.notice ?? <ChatMessages
        detailMode={chatView.detailMode}
        transcriptMode={chatView.transcriptMode}
        messages={messages}
        onDismissAction={writable ? (actionId) => void dismissAction(session.session.id, actionId) : undefined}
        renderAction={renderAction}
        renderTool={renderTool}
        running={working}
        scrollerRef={options.chatScrollerRef}
        showTimestamps={chatView.showTimestamps}
        stepsExpandable={chatView.stepsExpandable}
      />}
    </ChatPanel>
  );
}
