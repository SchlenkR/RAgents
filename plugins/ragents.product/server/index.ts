import {
  builtinProfiles,
  type AgentProfile,
  type CatalogModel,
  type RAgentsPlugin,
} from "@aicontainer/ragents";
import { pluginAssetPath } from "@aicontainer/server/plugin-support/asset-path.js";
import type { PluginModule } from "@aicontainer/server/plugin-support/plugin-module.js";
import { productStartOptions } from "@aicontainer/server/plugin-support/product-start-options.js";
import { ProductModelSettingsStore, productModelSettingsMethods } from "@aicontainer/server/plugin-support/product-model-settings.js";
import { handlebarsPrompt, systemPromptSelectionPrompt } from "@aicontainer/server/plugin-support/prompt.js";
import { productRuntimeToken } from "@aicontainer/server/ragents/product-runtime.js";
import { ragentsProductConfig, ragentsProductConfigDescriptors, ragentsProductModelNames } from "./config.js";
import { ragentsProductRuntime } from "./runtime.js";

const defaultSystemPromptPath = pluginAssetPath(import.meta.url, "../preamble.hbs");

const productProfiles = (): AgentProfile[] => {
  const base = {
    driver: "agent" as const,
    provider: ragentsProductConfig.provider,
    turnTimeoutMs: 3_600_000,
    isolateWorkspace: false,
  };
  const coordinatorModel = ragentsProductConfig.coordinatorModel();
  const model = ragentsProductConfig.model();
  return [
    {
      ...base,
      name: "coordinator",
      description: "Nur für den Koordinator selbst, nicht für Agenten.",
      model: coordinatorModel,
      thinking: ragentsProductConfig.coordinatorThinking,
    },
    {
      ...base,
      name: "relay",
      description: "Für Vermittlung mit wenigen Werkzeugen.",
      model: coordinatorModel,
      thinking: ragentsProductConfig.coordinatorThinking,
    },
    {
      ...base,
      name: "standard",
      description: "Für alle Agenten.",
      model,
      thinking: ragentsProductConfig.thinking,
    },
    ...builtinProfiles.filter((profile) => profile.name === "manual"),
  ];
};

const productModels = (): CatalogModel[] =>
  [...new Set([...ragentsProductModelNames(), ...ragentsProductConfig.modelChoice.options])].map((model) => ({
    driver: "agent" as const,
    provider: ragentsProductConfig.provider,
    model,
    label: `${ragentsProductConfig.provider}/${model}`,
    thinking: ragentsProductConfig.modelChoice.thinkingOptionsFor(model),
  }));

const ragentsProductPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.product" },
  register: (host) => {
    host.provide(productRuntimeToken, ragentsProductRuntime);
    host.config(...ragentsProductConfigDescriptors);
    void ragentsProductConfig.modelChoice.options;
    const modelSettings = new ProductModelSettingsStore(host.storage.root("model-settings.json"), ragentsProductConfig.modelChoice, productProfiles());
    host.methods(...productModelSettingsMethods(host.manifest.id, modelSettings));
    host.clientConfig({ chatSteps: ragentsProductConfig.chatDisplayPolicy });
    host.startOptions(...productStartOptions({
      modelChoice: modelSettings.modelChoice,
      coordinatorThinking: modelSettings.coordinatorThinking,
      systemPrompts: ragentsProductConfig.systemPrompts,
    }));
    host.skills({
      id: "ragents.product.external-skills",
      paths: () => ragentsProductConfig.skills.paths,
    });
    host.profiles({ id: "ragents.product.profiles", models: productModels, profiles: modelSettings.profiles });
    host.startEntries(...ragentsProductConfig.skills.startEntries);
    host.prompts(
      handlebarsPrompt("ragents.product.preamble", 0, ragentsProductConfig.systemPromptPath ?? defaultSystemPromptPath),
      systemPromptSelectionPrompt("ragents.product.selected-prompt", 50, ragentsProductConfig.systemPrompts()),
    );
  },
};

export const plugin: PluginModule = {
  requires: ["ragents.orchestration", "ragents.workspace"],
  create: () => ragentsProductPlugin,
};
