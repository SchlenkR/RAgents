import {
  type WebPlugin,
  type WebPluginDescriptor,
} from "@aicontainer/web/PluginRegistry";
import { PROCESSES_PLUGIN_ID } from "../contract";
import { processHeader } from "./ProcessHeader";

const configuredPlugin = (descriptor: WebPluginDescriptor): WebPlugin => ({
  ...descriptor,
  sessionHeaders: [{
    readRight: "ragents.processes.read",
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
