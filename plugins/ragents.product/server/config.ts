import path from "node:path";
import { chatDisplayEnvDescriptors, chatDisplayPolicyFromEnvironment } from "@aicontainer/server/plugin-support/chat-display-policy.js";
import { modelChoiceEnvDescriptors, modelChoiceFromEnvironment } from "@aicontainer/server/plugin-support/model-choice.js";
import { declaredEnvironment } from "@aicontainer/server/plugin-support/plugin-config.js";
import { folderSystemPrompts, pluginFolder } from "@aicontainer/server/plugin-support/plugin-folder.js";
import { checkedThinkingLevel } from "@aicontainer/server/plugin-support/thinking-level.js";
import { skillEnvDescriptors, skillsFromEnvironment } from "@aicontainer/server/plugin-support/skills.js";
import {
  lazySystemPromptCatalog,
  systemPromptEnvDescriptors,
} from "@aicontainer/server/plugin-support/system-prompts.js";

export const ragentsProductConfigDescriptors = [
  { key: "AGENT_PROVIDER", source: "environment" },
  { key: "AGENT_MODEL", source: "environment" },
  { key: "AGENT_THINKING", source: "environment" },
  { key: "AGENT_COORDINATOR_MODEL", source: "environment" },
  { key: "AGENT_COORDINATOR_THINKING", source: "environment" },
  { key: "SYSTEM_PROMPT_PATH", source: "environment" },
  { key: "OPENROUTER_API_KEY", source: "environment", secret: true },
  ...chatDisplayEnvDescriptors,
  ...skillEnvDescriptors,
  ...modelChoiceEnvDescriptors,
  ...systemPromptEnvDescriptors,
] as const;

const env = declaredEnvironment(ragentsProductConfigDescriptors);

const systemPromptPath = env.optional("SYSTEM_PROMPT_PATH");
const configuredModel = () => env.required("AGENT_MODEL");
const configuredCoordinatorModel = () => env.value("AGENT_COORDINATOR_MODEL", "") || configuredModel();

export const ragentsProductConfig = Object.freeze({
  provider: env.value("AGENT_PROVIDER", "openrouter"),
  model: configuredModel,
  thinking: checkedThinkingLevel(env.value("AGENT_THINKING", "high"), "AGENT_THINKING"),
  coordinatorModel: configuredCoordinatorModel,
  coordinatorThinking: checkedThinkingLevel(env.value("AGENT_COORDINATOR_THINKING", "high"), "AGENT_COORDINATOR_THINKING"),
  systemPromptPath: systemPromptPath ? path.resolve(systemPromptPath) : undefined,
  chatDisplayPolicy: chatDisplayPolicyFromEnvironment(env, { selectable: true }),
  skills: skillsFromEnvironment(env, "ragents.file"),
  modelChoice: modelChoiceFromEnvironment(env, {
    provider: env.value("AGENT_PROVIDER", "openrouter"),
    selectable: true,
    defaultModel: configuredCoordinatorModel,
    fallback: () => ragentsProductModelNames(),
  }),
  systemPrompts: lazySystemPromptCatalog(env, () => folderSystemPrompts(pluginFolder("ragents.product"))),
});

export const ragentsProductModelNames = (): string[] => [
  ragentsProductConfig.model(),
  ragentsProductConfig.coordinatorModel(),
];
