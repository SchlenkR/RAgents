import { isRecord } from "./lib/guards";
import { useAccess } from "./AccessContext";
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
import { ChatInputToolbar } from "./chat/ChatInputToolbar";
import { primaryChatState, primaryIsProgram, programChatNotice, runIsWorking } from "./chat/chat-target";
import { StoppedActorNotice } from "./chat/StoppedActorNotice";
import { ChatMessages } from "./chat/ChatMessages";
import { ChatPanel } from "./chat/ChatPanel";
import { DetailModeSwitch } from "./chat/DetailModeSwitch";
import { TimestampSwitch } from "./chat/TimestampSwitch";
import { useChatTimestamps } from "./chat-timestamps";
import { useChat } from "./chat/useChat";
import { runUserLocation, type ChatRunLocation } from "./chat/user-location";
import type { ChatAttachmentInput, ChatEvent, ToolInfo } from "./chat/types";
import { dismissAction, interruptActorTurn, type SessionInfo } from "./api";
import { useRunStore } from "./RunStore";
import { withToolSummaries } from "./toolLine";
import { StartOptionBadges, StartOptionControls, StartOptionsProvider, useStartOptions } from "./StartOptions";
import { useAttachmentCapabilities } from "./chat/useAttachmentCapabilities";
import { StartSelection } from "./StartSelection";
import { WorkspacePanel, useWorkspacePanelState, type WorkspacePanelState } from "./WorkspacePanel";
import { StatusGroup } from "./StatusGroup";
import { SurfaceShortcuts } from "./SurfaceShortcuts";
import { RunPanelHeader } from "./run-panel/RunPanelHeader";
import { RunPanelRail } from "./run-panel/RunPanelRail";
import { RunPanelWorkspace } from "./run-panel/RunPanelWorkspace";
import { activeWorkspaceTab, saveRunPanelWorkspaceState, useRunPanelWorkspaceState } from "./run-panel/workspace-state";
import { ToolbarItem, ToolbarText } from "./Toolbar";
import { DialogTitle, Spinner } from "./ui";
import { SurfaceModalContext, RunModalContext } from "./ui/dialog";
import { Modal } from "./ui/modal";
import {
  ChatStepsProvider,
  PluginSessionProviders,
  useActionRenderer,
  useToolRenderer,
  useChatSteps,
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

/** workspace: Fläche und Werkstatt; panel: das Run-Panel; element: genau ein Flächenelement in voller Größe. */
export type ChatLayout = "workspace" | "panel" | { element: string };

interface PluginChatProps {
  autoFocusChat?: boolean;
  onAutoFocusChatSettled?: () => void;
  layout?: ChatLayout;
  toolbarContainer?: HTMLElement | null;
  statusContainer?: HTMLElement | null;
  headerContainer?: HTMLElement | null;
  workspaceHeaderContainer?: HTMLElement | null;
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
  panelState: WorkspacePanelState;
  onTogglePanel: () => void;
  headerContainer?: HTMLElement | null;
  workspaceHeaderContainer?: HTMLElement | null;
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

export function PluginChat({ autoFocusChat, onAutoFocusChatSettled, layout = "workspace", headerContainer, toolbarContainer, workspaceHeaderContainer, statusContainer, initialStartOptions, onStarted, onLocationChange, onViewed, viewing = false, registry, session, startDialog }: PluginChatProps) {
  const access = useAccess();
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

  const registeredTabs = useMemo(() => registry.registeredTabs(sessionContext, access), [access, registry, sessionContext]);
  const availableTabs = useMemo(() => registry.availableTabs(sessionContext, access), [access, registry, sessionContext]);
  const { activeTabId, panelState, showTab, togglePanel } = useWorkspaceTabs(session.id, layout, availableTabs);

  const openTab = useCallback((tabId: string, selection?: unknown) => {
    if (!registeredTabs.some((tab) => tab.id === tabId)) {
      throw new Error("Reiter der Leiste ist nicht registriert: " + tabId);
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
            workspaceHeaderContainer={workspaceHeaderContainer}
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
        </PluginSessionProviders>
      </StartOptionsProvider>
    </ChatStepsProvider>
    </SurfaceModalContext.Provider>
    </RunModalContext.Provider>
  );
}

/** Der Reiterzustand je Layout: im Web ein flüchtiger Reiter und der gespeicherte Aufklappzustand, im Run-Panel der je Run gespeicherte offene Reiter der Leiste. */
function useWorkspaceTabs(runId: string, layout: ChatLayout, availableTabs: readonly WorkspaceTabContribution[]) {
  const [requestedTabId, setRequestedTabId] = useState<string>();
  const [workspaceState, updateWorkspaceState] = useWorkspacePanelState(runId);
  const stored = useRunPanelWorkspaceState(runId);
  const runPanel = layout === "panel";
  const activeTabId = runPanel
    ? activeWorkspaceTab(stored, availableTabs)
    : requestedTabId !== undefined && availableTabs.some((tab) => tab.id === requestedTabId) ? requestedTabId : availableTabs[0]?.id ?? "";
  const panelState: WorkspacePanelState = runPanel ? (activeTabId === "" ? "collapsed" : "expanded") : workspaceState;
  const firstTabId = availableTabs[0]?.id ?? null;
  const showTab = useCallback((tabId: string) => {
    if (runPanel) {
      saveRunPanelWorkspaceState(runId, { ...stored, tab: tabId });
      return;
    }
    setRequestedTabId(tabId);
    updateWorkspaceState("expanded");
  }, [runId, runPanel, stored, updateWorkspaceState]);
  const togglePanel = useCallback(() => {
    if (runPanel) {
      saveRunPanelWorkspaceState(runId, { ...stored, tab: panelState === "expanded" ? null : stored.tab ?? firstTabId });
      return;
    }
    updateWorkspaceState(panelState === "expanded" ? "collapsed" : "expanded");
  }, [firstTabId, panelState, runId, runPanel, stored, updateWorkspaceState]);
  return { activeTabId, panelState, showTab, togglePanel };
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
  workspaceHeaderContainer,
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
  const [runToolbarContainer, setRunToolbarContainer] = useState<HTMLDivElement | null>(null);
  const headerContributions = registry.headersFor(session, access, "header");
  const surfaceContributions = registry.headersFor(session, access, "surface");
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
  const hasWorkspace = !startDialog && tabs.length > 0;
  const SurfaceCenter = registry.surface?.Center;
  const SurfaceRunPanel = registry.surface?.RunPanel;
  const bindCompactContainers = useCallback((element: HTMLDivElement | null) => {
    onModalContainer(element);
    onSurfaceModalContainer(element);
  }, [onSurfaceModalContainer, onModalContainer]);

  const renderTool = useToolRenderer();

  const renderChat = (options: ChatDisplayOptions = {}) => (
    <ChatSurface
      autoFocus={autoFocusChat}
      onAutoFocusSettled={onAutoFocusChatSettled}
      options={options}
      registry={registry}
      renderTool={renderTool}
      session={session}
    />
  );

  if (startDialog) return (
    <Modal className="gap-0 p-0 [&_[data-slot=dialog-body]:has([data-preparation])]:overflow-hidden" nextBehavior="push" onClose={startDialog.onClose} scope="page" showCloseButton size="full">
      <DialogTitle className="sr-only">Neuer Run</DialogTitle>
      <StartSelection registry={registry} session={startSession} initialEntryId={startDialog.initialEntryId} onOpen={onStarted} />
    </Modal>
  );

  const status = registry.sessionStatus.filter((entry) => !entry.readRight || access.can(entry.readRight)).map(({ id, order, Status }) => <StatusGroup container={statusContainer} key={id} label="Run-Aktionen" order={order}>
    <Status navigation={navigation} session={session} />
  </StatusGroup>);
  const header = headerContainer && createPortal(layout === "panel"
    ? <RunPanelHeader attention={attention} contributions={headerContributions} navigation={navigation} registry={registry} runError={runError} session={session} working={session.running} />
    : <div className="flex min-w-0 flex-[1_0_auto] items-stretch">
        <div className="flex min-w-0 flex-none items-stretch text-[0.82rem] font-semibold text-foreground">
          <ToolbarItem className="min-w-[140px] max-w-[260px] justify-start font-semibold max-md:min-w-[120px] max-md:max-w-[180px]" title={session.session.title}><ToolbarText>{session.session.title || "Neuer Run"}</ToolbarText></ToolbarItem>
          {registry.sessionMetadata.map(({ id, Metadata }) => (
            <Metadata key={id} placement="header" session={session.session} />
          ))}
          <StartOptionBadges registry={registry} session={session} />
          {session.running && <ToolbarItem className="text-[0.72rem] font-normal text-muted-foreground"><Spinner aria-hidden className="size-2.5" /><ToolbarText>Bearbeitung läuft</ToolbarText></ToolbarItem>}
          {runError && <ToolbarItem className="text-[0.72rem] font-medium text-destructive" title={runError}><ToolbarText>Run nicht erreichbar</ToolbarText></ToolbarItem>}
        </div>
        {headerContributions.length > 0 && (
          <div className="flex min-w-0 flex-none items-stretch overflow-visible">
            {headerContributions.map(({ id, Header }) => (
              <Header key={id} navigation={navigation} session={session} />
            ))}
          </div>
        )}
        {attention && <ToolbarItem as="div" className="bg-primary/10 text-[0.72rem] font-semibold text-primary" role="status"><ToolbarText>{attention.label}</ToolbarText></ToolbarItem>}
      </div>, headerContainer);

  if (layout !== "workspace") return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {status}
      {header}
      <div className="relative isolate flex min-h-0 min-w-0 flex-1" ref={bindCompactContainers}>
        {typeof layout === "object"
          ? <SurfaceElementView elementId={layout.element} navigation={navigation} registry={registry} session={session} />
          : <>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {SurfaceRunPanel
                ? <SurfaceRunPanel
                  toolbarContainer={toolbarContainer}
                  runToolbarContainer={null}
                  statusContainer={statusContainer}
                  cardSections={registry.cardSections}
                  surfaceElements={registry.surfaceElements}
                  navigation={navigation}
                  renderChat={renderChat}
                  session={session}
                  tabIds={tabs.map((tab) => tab.id)}
                />
                : <DefaultCenter renderChat={renderChat} />}
              {hasWorkspace && <RunPanelWorkspace navigation={navigation} onClose={onTogglePanel} open={panelState === "expanded"} runId={session.session.id} session={session} tabs={tabs} />}
            </div>
            {hasWorkspace && <RunPanelRail navigation={navigation} onClose={onTogglePanel} open={panelState === "expanded"} pendingTabIds={pendingTabIds} session={session} tabs={tabs} />}
          </>}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {status}
      {header}
      <div
        className="relative flex min-h-0 min-w-0 flex-1 data-[resizing=true]:cursor-col-resize data-[resizing=true]:select-none"
        ref={onModalContainer}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {(SurfaceCenter || surfaceContributions.length > 0) && <div aria-label="Apps und Actors" className="flex min-h-[52px] min-w-0 flex-none items-stretch border-b border-border bg-[color-mix(in_srgb,var(--surface)_55%,var(--card))]" role="region">
            <div className="flex flex-none items-stretch empty:hidden" ref={setRunToolbarContainer} />
            <SurfaceShortcuts key={session.session.id}>
              {surfaceContributions.map(({ id, Header }) => <Header key={id} navigation={navigation} session={session} />)}
            </SurfaceShortcuts>
          </div>}
        <div className="relative isolate flex min-h-0 min-w-0 flex-1" ref={onSurfaceModalContainer}>
        {SurfaceCenter
            ? (
              <SurfaceCenter
                toolbarContainer={toolbarContainer}
                runToolbarContainer={runToolbarContainer}
                statusContainer={statusContainer}
                cardSections={registry.cardSections}
                surfaceElements={registry.surfaceElements}
                navigation={navigation}
                renderChat={renderChat}
                session={session}
                tabIds={tabs.map((tab) => tab.id)}
              />
            )
            : <DefaultCenter renderChat={renderChat} />}
        </div>
        </div>
        {hasWorkspace && (
          <WorkspacePanel
            headerContainer={workspaceHeaderContainer ?? null}
            navigation={navigation}
            onToggleState={onTogglePanel}
            pendingTabIds={pendingTabIds}
            session={session}
            state={panelState}
            tabs={tabs}
          />
        )}
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

/** Ein Flächenelement in voller Größe, etwa eine Mini-App im Editorbereich von VS Code. */
function SurfaceElementView({ elementId, navigation, registry, session }: {
  elementId: string;
  navigation: SessionNavigation;
  registry: PluginRegistry;
  session: SessionContext;
}) {
  const match = registry.surfaceElements.flatMap((contribution) => contribution.select(session)
    .filter((definition) => definition.id === elementId && definition.visible !== false)
    .map((definition) => ({ Element: contribution.Element, definition })))[0];
  if (!match) return <div className="m-auto max-w-[420px] p-6 text-center text-muted-foreground" role="status">
    {session.runView === undefined ? "Der Run wird geladen ..." : "Diese Mini-App gibt es in dem Run nicht mehr."}
  </div>;
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-view="element">
    <match.Element definition={match.definition} navigation={navigation} session={session} />
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
  const steps = useChatSteps(session.session.id, primaryChatActor(session.runView));
  const timestamps = useChatTimestamps(session.session.id, primaryChatActor(session.runView));
  const [sendError, setSendError] = useState<string>();
  const startOptions = useStartOptions();
  const attachments = useAttachmentCapabilities(session.session.id, "primary", JSON.stringify(startOptions.options.map(({ id, value }) => [id, value])));
  const messages = useMemo(() => withToolSummaries(session.messages), [session.messages]);
  const working = session.connected && (session.running || runIsWorking(session.runView, session.session.id));
  const partner = primaryChatState(session.runView, session.session.id, session.running);
  return (
    <ChatPanel
      className={options.chatElementClassName ? `${chatElementClass} ${options.chatElementClassName}` : chatElementClass}
      composer={
        primaryIsProgram(session.runView, session.session.id) ? <p className="text-muted-foreground">{programChatNotice}</p>
        : partner.kind === "stopped" ? <div className="[--input-card-radius:var(--radius-lg)]"><StoppedActorNotice actor={partner.actor} runId={session.session.id} toolbar={options.toolbarLeft} /></div>
        : <div className="[--input-card-radius:var(--radius-lg)]">
          {sendError && <p className="text-[0.8rem] text-destructive" role="alert">{sendError}</p>}
          <ChatInputToolbar
            {...attachments}
            autoFocus={autoFocus}
            onAutoFocusSettled={onAutoFocusSettled}
            disabled={!session.connected || !writable}
            maxRows={4}
            texts={writable ? undefined : { placeholder: "Lesezugriff auf diesen Run" }}
            onSend={(text, attachments) => {
              setSendError(undefined);
              return session.send(text, attachments);
            }}
            onStop={writable && partner.kind === "active" && partner.turnRunning ? () => {
              setSendError(undefined);
              void interruptActorTurn(session.session.id, partner.actorId).catch((error: unknown) => setSendError(error instanceof Error ? error.message : String(error)));
            } : undefined}
            rows={1}
            running={working}
            toolbarLeft={
              <>
                {options.toolbarLeft}
                {steps.selectable && (
                  <DetailModeSwitch
                    collapsible={false}
                    mode={steps.mode("coordinator")}
                    onChange={(mode) => steps.setMode("coordinator", mode)}
                  />
                )}
                <TimestampSwitch showTimestamps={timestamps.showTimestamps} onChange={timestamps.setShowTimestamps} />
              </>
            }
            toolbarRight={<StartOptionControls disabled={!session.connected || !writable} placement="composer" registry={registry} />}
          />
        </div>
      }
    >
      {options.notice ?? <ChatMessages
        detailMode={steps.mode("coordinator")}
        messages={messages}
        onDismissAction={writable ? (actionId) => void dismissAction(session.session.id, actionId) : undefined}
        renderAction={renderAction}
        renderTool={renderTool}
        running={working}
        scrollerRef={options.chatScrollerRef}
        showTimestamps={timestamps.showTimestamps}
        stepsExpandable={steps.stepsExpandable}
      />}
    </ChatPanel>
  );
}
