import type { WebPlugin } from "@ragents/web/PluginRegistry";
import { ConversationGuide, SharedBoardGuide } from "./StartGuides";

export const webPlugin: WebPlugin = {
  id: "ragents.reference",
  guides: [
    { id: "ragents.reference.conversation-circle", Guide: ConversationGuide },
    { id: "ragents.reference.shared-actor-list", Guide: SharedBoardGuide },
  ],
};
