import type { StartOptionContribution } from "../PluginRegistry";
import {
  modelStartOptionId,
  systemPromptStartOptionId,
} from "@ragents/host/plugin-support/start-options-contract";
import { ModelControl } from "./ModelControl";
import { SystemPromptBadge, SystemPromptControl } from "./SystemPromptControl";

export const productStartOptions: StartOptionContribution[] = [
  { id: systemPromptStartOptionId, Control: SystemPromptControl, Badge: SystemPromptBadge },
  { id: modelStartOptionId, placement: "composer", Control: ModelControl },
];
