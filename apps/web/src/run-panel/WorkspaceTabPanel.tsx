import { memo } from "react";
import type { WorkspaceTabContext, WorkspaceTabContribution } from "../PluginRegistry";
import { RenderBoundary } from "../RenderBoundary";

export const WorkspaceTabPanel = memo(function WorkspaceTabPanel({ Panel, ...props }: WorkspaceTabContext & { Panel: WorkspaceTabContribution["Panel"] }) {
  return <RenderBoundary resetKeys={[Panel, props.session.session.id]} title="The panel could not be displayed">
    <Panel {...props} />
  </RenderBoundary>;
});
