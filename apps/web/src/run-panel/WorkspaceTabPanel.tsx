import { memo } from "react";
import type { WorkspaceTabContext, WorkspaceTabContribution } from "../PluginRegistry";

export const WorkspaceTabPanel = memo(function WorkspaceTabPanel({ Panel, ...props }: WorkspaceTabContext & { Panel: WorkspaceTabContribution["Panel"] }) {
  return <Panel {...props} />;
});
