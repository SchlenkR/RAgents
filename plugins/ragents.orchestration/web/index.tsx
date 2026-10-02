import { ListIcon, SearchIcon } from "lucide-react";
import { INSPECTION_TAB_ID, InspectionHeader, InspectionPanel } from "./InspectionPanel";
import { useEffect, useState } from "react";
import { OrchestrationRunPanel } from "./run-panel/RunPanel";
import { DocumentsSection } from "./DocumentsSection";
import { JournalPanel, JournalStatus } from "./JournalStatus";
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

/** The selection on the surface: an artifact opens the documents; actors and mini-apps report the current location. */
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
  ],
  surface: { RunPanel: OrchestrationRunPanel },
  cardSections: [{
    id: "ragents.orchestration.documents",
    order: 300,
    Section: DocumentsSection,
  }],
  SessionProvider: OrchestrationSessionProvider,
  workspaceTabs: [{
    id: "ragents.orchestration.journal",
    hosts: ["browser"],
    readRight: "runs.inspect",
    label: "Journal",
    order: 90,
    Icon: ListIcon,
    Panel: JournalPanel,
  }, {
    id: INSPECTION_TAB_ID,
    readRight: "runs.inspect",
    label: "Inspection",
    order: 100,
    Icon: SearchIcon,
    Panel: InspectionPanel,
    Header: InspectionHeader,
    keepMounted: true,
    available: (session) => runViewFrom(session.runView) !== undefined,
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
