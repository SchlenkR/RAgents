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
import { primaryIsProgram, programChatNotice, runIsWorking, stopChatWork } from "./chat/chat-target";
import { ChatMessages } from "./chat/ChatMessages";
import { ChatPanel } from "./chat/ChatPanel";
import { DetailModeSwitch } from "./chat/DetailModeSwitch";
import { useChat } from "./chat/useChat";
import { runUserLocation, type ChatRunLocation } from "./chat/user-location";
import type { ChatEvent, ToolInfo } from "./chat/types";
import { type SessionInfo } from "./api";
import { useRunStore } from "./RunStore";
import { withToolSummaries } from "./toolLine";
import { StartOptionBadges, StartOptionsProvider } from "./StartOptions";
import { useAttachmentCapabilities } from "./chat/useAttachmentCapabilities";
import { StartSurface } from "./StartSurface";
import { WorkspacePanel, useWorkspacePanelState, type WorkspacePanelState } from "./WorkspacePanel";
import { StatusGroup } from "./StatusGroup";
import { CanvasShortcuts } from "./CanvasShortcuts";
import { ColumnRunHeader } from "./column/ColumnRunHeader";
import { ToolbarItem, ToolbarText } from "./Toolbar";
import { DialogTitle, Spinner } from "./ui";
import { CanvasModalContext, RunModalContext } from "./ui/dialog";
import { Modal } from "./ui/modal";
import {
  ChatStepsProvider,
  PluginSessionProviders,
  useToolRenderer,
  useChatSteps,
  primaryChatActor,
  useCanvasController,
  type ChatSurfaceOptions,
  type ExtensionEvent,
  type PluginRegistry,
  type SessionContext,
  type SessionNavigation,
  type WorkspaceTabContribution,
} from "./PluginRegistry";


const chatElementClass = "flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-soft/60 bg-card/55";

/** workspace: Canvas und Werkstatt; column: die schmale Arbeitsspalte; element: genau ein Canvas-Element in voller Größe. */
export type ChatLayout = "workspace" | "column" | { element: string };

interface PluginChatProps {
  layout?: ChatLayout;
  canvasToolbarContainer?: HTMLElement | null;
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
  layout: ChatLayout;
  canvasToolbarContainer?: HTMLElement | null;
  statusContainer?: HTMLElement | null;
  panelState: WorkspacePanelState;
  onTogglePanel: () => void;
  headerContainer?: HTMLElement | null;
  workspaceHeaderContainer?: HTMLElement | null;
  startDialog?: { onClose: () => void; initialEntryId?: string };
  onStarted?: () => void;
  onModalContainer: (element: HTMLDivElement | null) => void;
  onCanvasModalContainer: (element: HTMLDivElement | null) => void;
  navigation: SessionNavigation;
  onCenterModeChange: (mode: SessionContext["centerMode"]) => void;
  pendingTabIds: readonly string[];
  registry: PluginRegistry;
  runError?: string;
  session: SessionContext;
  tabs: readonly WorkspaceTabContribution[];
}

export function PluginChat({ layout = "workspace", headerContainer, canvasToolbarContainer, workspaceHeaderContainer, statusContainer, initialStartOptions, onStarted, onLocationChange, onViewed, viewing = false, registry, session, startDialog }: PluginChatProps) {
  const access = useAccess();
  const startOnly = startDialog !== undefined;
  const [modalContainer, setModalContainer] = useState<HTMLDivElement | null>(null);
  const [canvasModalContainer, setCanvasModalContainer] = useState<HTMLDivElement | null>(null);
  const [extensionEvents, setExtensionEvents] = useState<readonly ExtensionEvent[]>([]);
  const onChatEvent = useCallback((event: ChatEvent) => {
    if (event.kind === "reset") setExtensionEvents([]);
    if (event.kind !== "extension") return;
    const { pluginId, type, payload, at } = event;
    setExtensionEvents((current) => [...current, { pluginId, type, payload, at }]);
  }, []);
  const { messages, running, connected, startup, send, start, stop } = useChat(session.id, onChatEvent, !startOnly);
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
  const [centerMode, setCenterMode] = useState<SessionContext["centerMode"]>("chat");
  const [requestedTabId, setRequestedTabId] = useState<string | undefined>(undefined);
  const [tabSelections, setTabSelections] = useState<Record<string, unknown>>({});
  const [pendingTabIds, setPendingTabIds] = useState<readonly string[]>([]);
  const knownClientToolIds = useRef<Set<string>>(new Set());

  const respond = useCallback(async (callId: string, payload: unknown) => {
    const responder = registry.questionResponder;
    if (!responder) throw new Error("Kein Plugin hat einen Question-Responder registriert");
    return responder({ id: session.id }, callId, payload);
  }, [registry, session.id]);

  const sessionContext = useMemo<SessionContext>(() => ({
    centerMode,
    connected,
    extensionEvents,
    messages,
    actorConversations: runStore.conversations,
    conversationError: runStore.error,
    respond,
    runView: runStore.view,
    running,
    startup,
    send,
    session,
    start,
    stop,
  }), [centerMode, connected, extensionEvents, messages, respond, runStore.view, runStore.conversations, runStore.error, running, startup, send, session, start, stop]);

  const registeredTabs = useMemo(() => registry.registeredTabs(sessionContext, access), [access, registry, sessionContext]);
  const availableTabs = useMemo(() => registry.availableTabs(sessionContext, access), [access, registry, sessionContext]);
  const activeTabId = requestedTabId !== undefined && availableTabs.some((tab) => tab.id === requestedTabId)
    ? requestedTabId
    : availableTabs[0]?.id ?? "";

  const [panelState, updatePanelState] = useWorkspacePanelState(session.id);

  const openTab = useCallback((tabId: string, selection?: unknown) => {
    const available = registeredTabs.some((tab) => tab.id === tabId);
    if (!available && registry.canvas?.tabId !== tabId) {
      throw new Error("Arbeitsbereichs-Tab ist nicht registriert: " + tabId);
    }
    if (selection !== undefined) {
      setTabSelections((current) => ({ ...current, [tabId]: selection }));
    }
    if (available) {
      setRequestedTabId(tabId);
      updatePanelState("expanded");
    }
  }, [registeredTabs, registry.canvas?.tabId, updatePanelState]);

  const selectionFor = useCallback((tabId: string) => tabSelections[tabId], [tabSelections]);

  const revealEntity = useCallback((entity: { type: string; id: string }) => {
    const target = registry.targetForEntity(entity, sessionContext);
    if (!target || (!registeredTabs.some((tab) => tab.id === target.tabId) && registry.canvas?.tabId !== target.tabId)) return false;
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
    <CanvasModalContext.Provider value={startOnly ? null : canvasModalContainer}>
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
            layout={layout}
            canvasToolbarContainer={canvasToolbarContainer}
            panelState={panelState}
            onTogglePanel={() => updatePanelState(panelState === "expanded" ? "collapsed" : "expanded")}
            headerContainer={headerContainer}
            workspaceHeaderContainer={workspaceHeaderContainer}
            statusContainer={statusContainer}
            onModalContainer={setModalContainer}
            onCanvasModalContainer={setCanvasModalContainer}
            onStarted={reportStarted}
            startDialog={startDialog}
            navigation={navigation}
            onCenterModeChange={setCenterMode}
            pendingTabIds={pendingTabIds}
            registry={registry}
            runError={runStore.error}
            session={sessionContext}
            tabs={availableTabs}
          />
        </PluginSessionProviders>
      </StartOptionsProvider>
    </ChatStepsProvider>
    </CanvasModalContext.Provider>
    </RunModalContext.Provider>
  );
}

function UserLocationReporter({ activeTabId, onChange, panelVisible, runId, tabs }: {
  activeTabId: string;
  onChange: (location: ChatRunLocation) => void;
  panelVisible: boolean;
  runId: string;
  tabs: readonly WorkspaceTabContribution[];
}) {
  const canvas = useCanvasController();
  const location = runUserLocation(runId, activeTabId, tabs, panelVisible, canvas?.selection);
  const { tab, selection } = location;
  const type = selection?.type;
  const id = selection?.id;
  useLayoutEffect(() => {
    onChange({ runId, tab, selection: type !== undefined && id !== undefined ? { type, id } : null });
  }, [onChange, runId, tab, type, id]);
  return null;
}

function ChatWorkspace({
  layout,
  canvasToolbarContainer = null,
  panelState,
  onTogglePanel,
  headerContainer,
  workspaceHeaderContainer,
  statusContainer = null,
  onModalContainer,
  onCanvasModalContainer,
  onStarted,
  startDialog,
  navigation,
  onCenterModeChange,
  pendingTabIds,
  registry,
  runError,
  session,
  tabs,
}: ChatWorkspaceProps) {
  const access = useAccess();
  const [runToolbarContainer, setRunToolbarContainer] = useState<HTMLDivElement | null>(null);
  const headerContributions = registry.sessionHeaders.filter((entry) => entry.placement !== "canvas" && (!entry.readRight || access.can(entry.readRight)));
  const canvasContributions = registry.sessionHeaders.filter((entry) => entry.placement === "canvas" && (!entry.readRight || access.can(entry.readRight)));
  const startSession = useMemo<SessionContext>(() => {
    const attempt = async (work: () => Promise<void>) => {
      await work();
      onStarted?.();
    };
    return {
      ...session,
      send: (text, attachments) => attempt(() => session.send(text, attachments)),
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
  const CanvasCenter = registry.canvas?.Center;
  const CanvasColumn = registry.canvas?.Column;
  const bindCompactContainers = useCallback((element: HTMLDivElement | null) => {
    onModalContainer(element);
    onCanvasModalContainer(element);
  }, [onCanvasModalContainer, onModalContainer]);

  const renderTool = useToolRenderer();

  const renderChat = (options: ChatSurfaceOptions = {}) => (
    <ChatSurface
      options={options}
      renderTool={renderTool}
      session={session}
    />
  );

  if (startDialog) return (
    <Modal className="gap-0 p-0 [&_[data-slot=dialog-body]:has([data-preparation])]:overflow-hidden" nextBehavior="push" onClose={startDialog.onClose} scope="page" showCloseButton size="full">
      <DialogTitle className="sr-only">Neue Unterhaltung</DialogTitle>
      <StartSurface registry={registry} session={startSession} initialEntryId={startDialog.initialEntryId} />
    </Modal>
  );

  const status = registry.sessionStatus.filter((entry) => !entry.readRight || access.can(entry.readRight)).map(({ id, order, Status }) => <StatusGroup container={statusContainer} key={id} label="Run-Aktionen" order={order}>
    <Status navigation={navigation} session={session} />
  </StatusGroup>);
  const header = headerContainer && createPortal(layout === "column"
    ? <ColumnRunHeader attention={attention} contributions={headerContributions} navigation={navigation} registry={registry} runError={runError} session={session} working={session.running} />
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
          ? <CanvasElementView elementId={layout.element} navigation={navigation} registry={registry} session={session} />
          : CanvasColumn
            ? <CanvasColumn
              toolbarContainer={canvasToolbarContainer}
              runToolbarContainer={null}
              statusContainer={statusContainer}
              cardSections={registry.cardSections}
              canvasElements={registry.canvasElements}
              navigation={navigation}
              onCenterModeChange={onCenterModeChange}
              renderChat={renderChat}
              session={session}
              tabIds={tabs.map((tab) => tab.id)}
            />
            : <DefaultCenter renderChat={renderChat} />}
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
          {(CanvasCenter || canvasContributions.length > 0) && <div aria-label="Apps und Actors" className="flex min-h-[52px] min-w-0 flex-none items-stretch border-b border-border bg-[color-mix(in_srgb,var(--canvas)_55%,var(--card))]" role="region">
            <div className="flex flex-none items-stretch empty:hidden" ref={setRunToolbarContainer} />
            <CanvasShortcuts key={session.session.id}>
              {canvasContributions.map(({ id, Header }) => <Header key={id} navigation={navigation} session={session} />)}
            </CanvasShortcuts>
          </div>}
        <div className="relative isolate flex min-h-0 min-w-0 flex-1" ref={onCanvasModalContainer}>
        {CanvasCenter
            ? (
              <CanvasCenter
                toolbarContainer={canvasToolbarContainer}
                runToolbarContainer={runToolbarContainer}
                statusContainer={statusContainer}
                cardSections={registry.cardSections}
                canvasElements={registry.canvasElements}
                navigation={navigation}
                onCenterModeChange={onCenterModeChange}
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
  renderChat: (options?: ChatSurfaceOptions) => ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-view="chat">
        {renderChat()}
      </div>
    </div>
  );
}

/** Ein Canvas-Element in voller Größe, etwa eine Mini-App im Editorbereich von VS Code. */
function CanvasElementView({ elementId, navigation, registry, session }: {
  elementId: string;
  navigation: SessionNavigation;
  registry: PluginRegistry;
  session: SessionContext;
}) {
  const match = registry.canvasElements.flatMap((contribution) => contribution.select(session)
    .filter((definition) => definition.id === elementId && definition.visible !== false)
    .map((definition) => ({ Element: contribution.Element, definition })))[0];
  if (!match) return <div className="m-auto max-w-[420px] p-6 text-center text-muted-foreground" role="status">
    {session.runView === undefined ? "Der Run wird geladen ..." : "Diese Mini-App gibt es in dem Run nicht mehr."}
  </div>;
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-view="element">
    <match.Element definition={match.definition} navigation={navigation} presentation="tiled" session={session} />
  </div>;
}

function ChatSurface({
  options,
  renderTool,
  session,
}: {
  options: ChatSurfaceOptions;
  renderTool: (tool: ToolInfo) => ReactNode;
  session: SessionContext;
}) {
  const access = useAccess();
  const writable = access.can("runs.write");
  const steps = useChatSteps(session.session.id, primaryChatActor(session.runView));
  const [sendError, setSendError] = useState<string>();
  const attachments = useAttachmentCapabilities(session.session.id);
  const messages = useMemo(() => withToolSummaries(session.messages), [session.messages]);
  const working = session.connected && (session.running || runIsWorking(session.runView, session.session.id));
  return (
    <ChatPanel
      className={options.chatElementClassName ? `${chatElementClass} ${options.chatElementClassName}` : chatElementClass}
      composer={
        primaryIsProgram(session.runView, session.session.id) ? <p className="text-muted-foreground">{programChatNotice}</p> : <div className="[--input-card-radius:var(--radius-lg)]" onWheel={options.onComposerWheel}>
          {sendError && <p className="text-[0.8rem] text-destructive" role="alert">{sendError}</p>}
          <ChatInputToolbar
            {...attachments}
            disabled={!session.connected || !writable}
            maxRows={4}
            texts={writable ? undefined : { placeholder: "Lesezugriff auf diesen Run" }}
            onSend={(text, attachments) => {
              setSendError(undefined);
              return session.send(text, attachments);
            }}
            onStop={writable ? () => {
              setSendError(undefined);
              void stopChatWork(session.session.id, session.runView, session.stop).catch((error: unknown) => setSendError(error instanceof Error ? error.message : String(error)));
            } : undefined}
            rows={1}
            running={working}
            toolbarRight={options.toolbarRight}
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
              </>
            }
          />
        </div>
      }
      nodeRef={options.nodeRef}
    >
      <ChatMessages
        detailMode={steps.mode("coordinator")}
        emptyState={<div className="m-auto text-center text-muted-foreground">Der Run wird angelegt ...</div>}
        messages={messages}
        onAnswerQuestion={writable ? (callId, text) => void session.respond(callId, text) : undefined}
        renderTool={renderTool}
        running={working}
        scrollerRef={options.chatScrollerRef}
        showTimestamps
        stepsExpandable={steps.stepsExpandable}
      />
    </ChatPanel>
  );
}
