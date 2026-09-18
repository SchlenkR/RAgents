import type { ChatDisplayPolicy } from "@aicontainer/web/PluginRegistry";

export const overseerChatStorageKeyPrefix = "ragents.overseer.chat-steps";

export const overseerChatDisplayPolicy: ChatDisplayPolicy = {
  modes: { coordinator: "grouped", agents: "grouped" },
  stepsVisible: true,
  stepsExpandable: true,
  selectable: true,
};
