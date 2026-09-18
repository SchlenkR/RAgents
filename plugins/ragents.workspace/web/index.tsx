import {
  pluginRoutePrefixFrom,
  type WebPlugin,
  type WebPluginDescriptor,
} from "@aicontainer/web/PluginRegistry";
import { WORKSPACE_PLUGIN_ID } from "../contract";
import { fileBrowserPanel } from "./FileBrowser";

export const WORKSPACE_FILES_TAB_ID = "ragents.workspace.files";

function IconFiles() {
  return (
    <svg aria-hidden fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4L10 7h9.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
      <path d="M3 11h18" />
    </svg>
  );
}

const configuredPlugin = (descriptor: WebPluginDescriptor, routePrefix: string): WebPlugin => ({
  ...descriptor,
  workspaceTabs: [{
    readRight: "runs.inspect",
    id: WORKSPACE_FILES_TAB_ID,
    label: "Dateien",
    order: 260,
    Icon: IconFiles,
    Panel: fileBrowserPanel(routePrefix),
  }],
});

const descriptor: WebPluginDescriptor = { id: WORKSPACE_PLUGIN_ID };

export const webPlugin: WebPlugin = {
  ...descriptor,
  activate: (config) => configuredPlugin(descriptor, pluginRoutePrefixFrom(descriptor.id, config)),
};
