import {
  type WebPlugin,
  type WebPluginDescriptor,
} from "@ragents/web/PluginRegistry";
import { PROCESSES_PLUGIN_ID } from "../contract";
import { IconProcess, ProcessesPanel, processHeader } from "./ProcessHeader";

const configuredPlugin = (descriptor: WebPluginDescriptor): WebPlugin => ({
  ...descriptor,
  workspaceTabs: [{
    id: "ragents.processes.live",
    hosts: ["browser"],
    readRight: "ragents.processes.read",
    requiresWorkspace: true,
    label: "Processes",
    order: 120,
    Icon: IconProcess,
    Panel: ProcessesPanel,
  }],
  sessionHeaders: [{
    readRight: "ragents.processes.read",
    requiresWorkspace: true,
    id: "ragents.processes.live",
    order: 110,
    Header: processHeader(),
  }],
});

const descriptor: WebPluginDescriptor = { id: PROCESSES_PLUGIN_ID };

export const webPlugin: WebPlugin = {
  ...descriptor,
  activate: () => configuredPlugin(descriptor),
};
