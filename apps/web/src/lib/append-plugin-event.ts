import type { PluginEvent } from "../PluginRegistry";

export const appendPluginEvent = (events: readonly PluginEvent[], event: PluginEvent): readonly PluginEvent[] =>
  [...events.slice(-99), event];
