import { useEffect, useState } from "react";
import { OrchestrationCenter } from "./Center";
import { OrchestrationRunPanel } from "./run-panel/RunPanel";
import { DocumentsSection } from "./DocumentsSection";
import { RunPanelSettings } from "./run-panel/RunPanelSettings";
import { ActorShortcuts } from "./ActorSurfaceControls";
import { JournalStatus } from "./JournalStatus";
import { StopRunHeader } from "./StopRunButton";
import { EXECUTIONS_TAB_ID, ExecutionsPanel, IconExecutions } from "./ExecutionsPanel";
import { ORCHESTRATION_PLUGIN_ID } from "./constants";
import { runViewFrom } from "@ragents/web/run-view";
import {
  SurfaceControllerProvider,
  type EntityReference,
  type SessionProviderProps,
  type WebPlugin,
} from "@ragents/web/PluginRegistry";

export { ORCHESTRATION_PLUGIN_ID } from "./constants";

/** Die Auswahl auf der Fläche: ein Artefakt öffnet die Dokumente, jede andere Entität wird die gewählte Kachel und der gemeldete Standort. */
function OrchestrationSessionProvider({ children, navigation, session }: SessionProviderProps) {
  const runView = runViewFrom(session.runView);
  const [selection, setSelection] = useState<EntityReference>();

  useEffect(() => {
    if (runView) return;
    setSelection(undefined);
  }, [runView]);

  const acceptSelection = (next: EntityReference | undefined) => {
    if (next?.type === "artifact" && navigation.revealEntity(next)) return;
    setSelection(next);
  };

  return (
    <SurfaceControllerProvider value={{ acceptSelection, selection }}>
      {children}
    </SurfaceControllerProvider>
  );
}

export const webPlugin: WebPlugin = {
  id: ORCHESTRATION_PLUGIN_ID,
  needsRunView: true,
  sessionStatus: [{ id: "ragents.orchestration.journal", readRight: "runs.inspect", order: 20, Status: JournalStatus }],
  sessionHeaders: [
    { id: "ragents.orchestration.stop", readRight: "runs.write", order: 100, Header: StopRunHeader },
    { id: "ragents.orchestration.actors", order: 300, placement: "surface", Header: ActorShortcuts },
  ],
  settings: [
    { id: "ragents.orchestration.runPanel", category: "appearance", label: "Run-Panel", Settings: RunPanelSettings },
  ],
  surface: { Center: OrchestrationCenter, RunPanel: OrchestrationRunPanel },
  cardSections: [{
    id: "ragents.orchestration.documents",
    order: 300,
    Section: DocumentsSection,
  }],
  SessionProvider: OrchestrationSessionProvider,
  workspaceTabs: [{
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
