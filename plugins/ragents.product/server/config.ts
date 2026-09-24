import path from "node:path";
import type { ModelUpstream } from "@ragents/host/plugin-support/model-upstreams.js";
import { chatDisplayEnvDescriptors, chatDisplayPolicyFromEnvironment } from "@ragents/host/plugin-support/chat-display-policy.js";
import { builtinCatalog, modelChoiceEnvDescriptors, modelChoiceFromEnvironment } from "@ragents/host/plugin-support/model-choice.js";
import { declaredEnvironment } from "@ragents/host/plugin-support/plugin-config.js";
import { folderSystemPrompts, pluginFolder } from "@ragents/host/plugin-support/plugin-folder.js";
import { createRelayCatalog, RELAY_PROVIDER, type RelayCatalog } from "@ragents/host/plugin-support/product-relay.js";
import { checkedThinkingLevel } from "@ragents/host/plugin-support/thinking-level.js";
import { skillEnvDescriptors, skillsFromEnvironment } from "@ragents/host/plugin-support/skills.js";
import {
  lazySystemPromptCatalog,
  systemPromptEnvDescriptors,
} from "@ragents/host/plugin-support/system-prompts.js";

export const ragentsProductConfigDescriptors = [
  { key: "AGENT_PROVIDER", source: "environment" },
  { key: "AGENT_MODEL", source: "environment" },
  { key: "AGENT_THINKING", source: "environment" },
  { key: "AGENT_COORDINATOR_MODEL", source: "environment" },
  { key: "AGENT_COORDINATOR_THINKING", source: "environment" },
  { key: "SYSTEM_PROMPT_PATH", source: "environment" },
  { key: "OPENROUTER_API_KEY", source: "environment", secret: true },
  { key: "RELAY_URL", source: "environment" },
  { key: "RELAY_TOKEN", source: "environment", secret: true },
  ...chatDisplayEnvDescriptors,
  ...skillEnvDescriptors,
  ...modelChoiceEnvDescriptors,
  ...systemPromptEnvDescriptors,
] as const;

const env = declaredEnvironment(ragentsProductConfigDescriptors);

const systemPromptPath = env.optional("SYSTEM_PROMPT_PATH");
const configuredModel = () => env.required("AGENT_MODEL");
const configuredCoordinatorModel = () => env.value("AGENT_COORDINATOR_MODEL", "") || configuredModel();
const provider = env.value("AGENT_PROVIDER", "openrouter");

// Mit AGENT_PROVIDER "relay" kommen Katalog und Modellzugang von einem anderen RAgents-Server.
const relay: RelayCatalog | undefined = provider === RELAY_PROVIDER
  ? createRelayCatalog({ url: env.required("RELAY_URL"), token: env.required("RELAY_TOKEN") })
  : undefined;

const openrouterUpstream = (): ModelUpstream | undefined => {
  const apiKey = env.optional("OPENROUTER_API_KEY");
  return apiKey ? { id: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey, models: builtinCatalog("openrouter")() } : undefined;
};

export const ragentsProductConfig = Object.freeze({
  provider,
  relay,
  upstreams: (): readonly ModelUpstream[] => [openrouterUpstream()].filter((upstream): upstream is ModelUpstream => upstream !== undefined),
  model: configuredModel,
  thinking: checkedThinkingLevel(env.value("AGENT_THINKING", "high"), "AGENT_THINKING"),
  coordinatorModel: configuredCoordinatorModel,
  coordinatorThinking: checkedThinkingLevel(env.value("AGENT_COORDINATOR_THINKING", "high"), "AGENT_COORDINATOR_THINKING"),
  systemPromptPath: systemPromptPath ? path.resolve(systemPromptPath) : undefined,
  chatDisplayPolicy: chatDisplayPolicyFromEnvironment(env, { selectable: true }),
  skills: skillsFromEnvironment(env, "ragents.file"),
  modelChoice: modelChoiceFromEnvironment(env, {
    provider,
    selectable: true,
    defaultModel: configuredCoordinatorModel,
    fallback: () => ragentsProductModelNames(),
    ...(relay ? { catalog: relay.models } : {}),
  }),
  systemPrompts: lazySystemPromptCatalog(env, () => folderSystemPrompts(pluginFolder("ragents.product"))),
});

export const ragentsProductModelNames = (): string[] => [
  ragentsProductConfig.model(),
  ragentsProductConfig.coordinatorModel(),
];
