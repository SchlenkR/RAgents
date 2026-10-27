import path from "node:path";
import { chatDisplayEnvDescriptors, chatDisplayPolicyFromEnvironment } from "@ragents/host/plugin-support/chat-display-policy.js";
import { providerCatalog, modelChoiceEnvDescriptors, modelChoiceFromEnvironment } from "@ragents/host/plugin-support/model-choice.js";
import { declaredEnvironment } from "@ragents/host/plugin-support/plugin-config.js";
import { folderSystemPrompts, pluginFolder } from "@ragents/host/plugin-support/plugin-folder.js";
import { createRelayCatalog, RELAY_PROVIDER, type RelayCatalog } from "@ragents/host/plugin-support/product-relay.js";
import { roleThinkingLevel } from "@ragents/host/plugin-support/thinking-level.js";
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
  { key: "RELAY_URL", source: "environment" },
  { key: "RELAY_TOKEN", source: "environment", secret: true },
  ...chatDisplayEnvDescriptors,
  ...skillEnvDescriptors,
  ...modelChoiceEnvDescriptors,
  ...systemPromptEnvDescriptors,
] as const;

const env = declaredEnvironment(ragentsProductConfigDescriptors);

const systemPromptPath = env.optional("SYSTEM_PROMPT_PATH");
const provider = env.value("AGENT_PROVIDER", "openrouter");

// With AGENT_PROVIDER "relay", catalog and model access come from another RAgents server.
const relay: RelayCatalog | undefined = provider === RELAY_PROVIDER
  ? createRelayCatalog({ url: env.required("RELAY_URL"), token: env.required("RELAY_TOKEN") })
  : undefined;

const catalog = relay?.models ?? providerCatalog(provider);
const configuredModelFor = (key: "AGENT_MODEL" | "AGENT_COORDINATOR_MODEL"): string => {
  const id = key === "AGENT_MODEL" ? env.required(key) : env.optional(key) || env.required("AGENT_MODEL");
  const models = catalog();
  if (!models.some((model) => model.id === id)) {
    throw new Error(`${key}: model ${id} is not configured for provider ${provider}; configured model ids: ${models.map((model) => model.id).join(", ") || "none"}`);
  }
  return id;
};
const configuredModel = () => configuredModelFor("AGENT_MODEL");
const configuredCoordinatorModel = () => configuredModelFor("AGENT_COORDINATOR_MODEL");

export const ragentsProductConfig = Object.freeze({
  provider,
  relay,
  model: configuredModel,
  thinking: () => roleThinkingLevel(env.optional("AGENT_THINKING"), "AGENT_THINKING", provider, configuredModel()),
  coordinatorModel: configuredCoordinatorModel,
  coordinatorThinking: () => roleThinkingLevel(env.optional("AGENT_COORDINATOR_THINKING"), "AGENT_COORDINATOR_THINKING", provider, configuredCoordinatorModel()),
  systemPromptPath: systemPromptPath ? path.resolve(systemPromptPath) : undefined,
  chatDisplayPolicy: chatDisplayPolicyFromEnvironment(env, { selectable: true }),
  skills: skillsFromEnvironment(env, "ragents.file"),
  modelChoice: modelChoiceFromEnvironment(env, {
    provider,
    selectable: true,
    defaultModel: configuredCoordinatorModel,
    catalog,
  }),
  systemPrompts: lazySystemPromptCatalog(env, () => folderSystemPrompts(pluginFolder("ragents.product"))),
});

export const ragentsProductModelNames = (): string[] => [
  ragentsProductConfig.model(),
  ragentsProductConfig.coordinatorModel(),
];
