import { useAccess } from "@aicontainer/web/AccessContext";
import { createContext, useContext, useEffect, useState } from "react";
import { FlowInspector as NetworkInspector, type FlowSelection as NetworkSelection } from "./FlowInspector";
import { OrchestrationCenter } from "./Center";
import { OrchestrationColumn } from "./column/RunColumn";
import { DocumentsSection } from "./DocumentsSection";
import { CardSizeSettings } from "./CardSizeSettings";
import { ZoomSettings } from "./ZoomSettings";
import { ColumnSettings } from "./column/ColumnSettings";
import { ActorShortcuts } from "./ActorCanvasControls";
import { MaterialSettings } from "@aicontainer/web/MaterialSettings";
import { JournalStatus } from "./JournalStatus";
import { StopRunHeader } from "./StopRunButton";
import { EXECUTIONS_TAB_ID, ExecutionsPanel, IconExecutions } from "./ExecutionsPanel";
import { ORCHESTRATION_PLUGIN_ID, ORCHESTRATION_TAB_ID } from "./constants";
import { runViewFrom } from "./run-view";
import {
  CanvasControllerProvider,
  type EntityReference,
  type SessionProviderProps,
  type WebPlugin,
  type WorkspaceTabContext,
} from "@aicontainer/web/PluginRegistry";

export { ORCHESTRATION_PLUGIN_ID, ORCHESTRATION_TAB_ID } from "./constants";

interface OrchestrationController {
  canGoBack: boolean;
  selection: NetworkSelection | undefined;
  selectionRevision: number;
  acceptCanvasSelection: (selection: EntityReference | undefined) => void;
  navigateBack: () => void;
  navigateFromPanel: (selection: NetworkSelection) => void;
}

const OrchestrationContext = createContext<OrchestrationController | undefined>(undefined);

const isNetworkSelection = (selection: EntityReference): selection is NetworkSelection =>
  selection.type === "actor"
  || selection.type === "input"
  || selection.type === "turn"
  || selection.type === "subscription"
  || selection.type === "action"
  || selection.type === "artifact";

function OrchestrationSessionProvider({ children, navigation, session }: SessionProviderProps) {
  const inspect = useAccess().can("runs.inspect");
  const runView = runViewFrom(session.runView);
  const [selection, setSelection] = useState<NetworkSelection>();
  const [history, setHistory] = useState<NetworkSelection[]>([]);
  const [selectionRevision, setSelectionRevision] = useState(0);

  useEffect(() => {
    if (runView) return;
    setSelection(undefined);
    setHistory([]);
    setSelectionRevision((revision) => revision + 1);
  }, [runView]);

  const publishSelection = (next: NetworkSelection | undefined) => {
    setSelection(next);
    setSelectionRevision((revision) => revision + 1);
  };

  const acceptCanvasSelection = (nextEntity: EntityReference | undefined) => {
    if (nextEntity && !isNetworkSelection(nextEntity)) return;
    const next = nextEntity;
    if (next?.type === "artifact" && navigation.revealEntity(next)) {
      setSelectionRevision((revision) => revision + 1);
      return;
    }
    setHistory([]);
    publishSelection(next);
    if (next && inspect) navigation.openTab(ORCHESTRATION_TAB_ID);
  };

  const navigateFromPanel = (next: NetworkSelection) => {
    if (next.type === "artifact" && navigation.revealEntity(next)) return;
    const current = selection
      ?? (runView ? { type: "actor" as const, id: runView.primaryActorId ?? runView.ownerId } : undefined);
    if (current) setHistory((entries) => [...entries.slice(-31), current]);
    publishSelection(next);
  };

  const navigateBack = () => {
    const previous = history.at(-1);
    setHistory((entries) => entries.slice(0, -1));
    publishSelection(previous);
  };

  return (
    <CanvasControllerProvider value={{
      acceptSelection: acceptCanvasSelection,
      selection,
      selectionRevision,
      tabId: ORCHESTRATION_TAB_ID,
    }}>
      <OrchestrationContext.Provider value={{
        acceptCanvasSelection,
        canGoBack: history.length > 0,
        navigateBack,
        navigateFromPanel,
        selection,
        selectionRevision,
      }}>
        {children}
      </OrchestrationContext.Provider>
    </CanvasControllerProvider>
  );
}

export const useOrchestrationController = () => useContext(OrchestrationContext);

function OrchestrationInspectorPanel({ session }: WorkspaceTabContext) {
  const controller = useOrchestrationController();
  if (!controller) throw new Error("Orchestrierungs-Plugin ist nicht aktiv");
  return (
    <NetworkInspector
      canGoBack={controller.canGoBack}
      composerVisible={session.centerMode === "workflow"}
      primaryMessages={session.messages}
      actorConversations={session.actorConversations}
      conversationError={session.conversationError}
      primaryRunning={session.running}
      onBack={controller.navigateBack}
      onNavigate={controller.navigateFromPanel}
      selection={controller.selection}
      view={runViewFrom(session.runView)}
    />
  );
}

function IconOrchestration() {
  return (
    <svg aria-hidden fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15">
      <rect height="6" rx="1.5" width="8" x="3" y="3" />
      <rect height="6" rx="1.5" width="8" x="13" y="15" />
      <path d="M7 9v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

export const webPlugin: WebPlugin = {
  id: ORCHESTRATION_PLUGIN_ID,
  needsRunView: true,
  sessionStatus: [{ id: "ragents.orchestration.journal", readRight: "runs.inspect", order: 20, Status: JournalStatus }],
  sessionHeaders: [
    { id: "ragents.orchestration.stop", readRight: "runs.write", order: 100, Header: StopRunHeader },
    { id: "ragents.orchestration.actors", order: 300, placement: "canvas", Header: ActorShortcuts },
  ],
  settings: [
    { id: "ragents.orchestration.material", category: "appearance", label: "Schichtwerk-Material", Settings: MaterialSettings },
    { id: "ragents.orchestration.card-size", category: "appearance", label: "LLM-Karten", Settings: CardSizeSettings },
    { id: "ragents.orchestration.zoom", category: "appearance", label: "Canvas-Zoom", Settings: ZoomSettings },
    { id: "ragents.orchestration.column", category: "appearance", label: "Arbeitsspalte", Settings: ColumnSettings },
  ],
  canvas: { Center: OrchestrationCenter, Column: OrchestrationColumn, tabId: ORCHESTRATION_TAB_ID },
  cardSections: [{
    id: "ragents.orchestration.documents",
    order: 300,
    Section: DocumentsSection,
  }],
  SessionProvider: OrchestrationSessionProvider,
  workspaceTabs: [{
    readRight: "runs.inspect",
    id: ORCHESTRATION_TAB_ID,
    label: "Netz",
    order: 100,
    Icon: IconOrchestration,
    Panel: OrchestrationInspectorPanel,
    available: (session) => (runViewFrom(session.runView)?.actors.length ?? 0) > 0,
  }, {
    id: EXECUTIONS_TAB_ID,
    readRight: "runs.inspect",
    label: "Executions",
    order: 110,
    Icon: IconExecutions,
    Panel: ExecutionsPanel,
    keepMounted: true,
    available: (session) => runViewFrom(session.runView) !== undefined,
  }],
};
