import type { WebPlugin } from "@aicontainer/web/PluginRegistry";
import { WORKSPACE_BINDING_OPTION_ID, WORKSPACE_PLUGIN_ID } from "../contract";
import { FileBrowserPanel } from "./FileBrowser";
import { WorkspaceBindingBadge, WorkspaceBindingControl, WorkspaceMetadata } from "./WorkspaceBinding";

export const WORKSPACE_FILES_TAB_ID = "ragents.workspace.files";

function IconFiles() {
  return (
    <svg aria-hidden fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4L10 7h9.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
      <path d="M3 11h18" />
    </svg>
  );
}

export const webPlugin: WebPlugin = {
  id: WORKSPACE_PLUGIN_ID,
  workspaceTabs: [{
    readRight: "runs.inspect",
    id: WORKSPACE_FILES_TAB_ID,
    label: "Dateien",
    order: 260,
    Icon: IconFiles,
    Panel: FileBrowserPanel,
  }],
  startOptions: [{
    id: WORKSPACE_BINDING_OPTION_ID,
    Control: WorkspaceBindingControl,
    Badge: WorkspaceBindingBadge,
  }],
  sessionMetadata: [{
    id: "ragents.workspace.binding",
    order: 90,
    Metadata: WorkspaceMetadata,
  }],
};
