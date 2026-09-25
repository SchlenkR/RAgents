import {
  builtinProfiles,
  type AgentProfile,
  type CatalogModel,
  type RAgentsPlugin,
} from "@ragents/engine";
import { modelLabel } from "@ragents/host/plugin-support/model-aliases.js";
import type { ModelChoice } from "@ragents/host/plugin-support/model-choice.js";
import { modelUpstreamsToken } from "@ragents/host/plugin-support/model-upstreams.js";
import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { productStartOptions } from "@ragents/host/plugin-support/product-start-options.js";
import { ProductModelSettingsStore, productModelSettingsMethods } from "@ragents/host/plugin-support/product-model-settings.js";
import { handlebarsPrompt, systemPromptSelectionPrompt } from "@ragents/host/plugin-support/prompt.js";
import { productRuntimeToken } from "@ragents/host/ragents/product-runtime.js";
import { ragentsProductConfig, ragentsProductConfigDescriptors, ragentsProductModelNames } from "./config.js";
import { ragentsProductRuntime } from "./runtime.js";

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
      thinking: ragentsProductConfig.coordinatorThinking(),
    },
    {
      ...base,
      name: "relay",
      description: "Für Vermittlung mit wenigen Werkzeugen.",
      model: coordinatorModel,
      thinking: ragentsProductConfig.coordinatorThinking(),
    },
    {
      ...base,
      name: "standard",
      description: "Für alle Agenten.",
      model,
      thinking: ragentsProductConfig.thinking(),
    },
    ...builtinProfiles.filter((profile) => profile.name === "manual"),
  ];
};

const productModels = (): CatalogModel[] =>
  [...new Set([...ragentsProductModelNames(), ...ragentsProductConfig.modelChoice.options])].map((model) => ({
    driver: "agent" as const,
    provider: ragentsProductConfig.provider,
    model,
    label: modelLabel(ragentsProductConfig.provider, model),
    thinking: ragentsProductConfig.modelChoice.thinkingOptionsFor(model),
  }));

const ragentsProductPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.product" },
  register: (host) => {
    host.provide(productRuntimeToken, ragentsProductRuntime);
    host.provide(modelUpstreamsToken, ragentsProductConfig.upstreams);
    host.config(...ragentsProductConfigDescriptors);
    void ragentsProductConfig.modelChoice.options;
    // Die Modellvorgaben prüfen gegen den Katalog; mit Relay liegt der erst nach dem Abruf beim Start vor.
    let store: ProductModelSettingsStore | undefined;
    const settings = (): ProductModelSettingsStore =>
      store ??= new ProductModelSettingsStore(host.storage.root("model-settings.json"), ragentsProductConfig.modelChoice, productProfiles());
    const modelChoice: ModelChoice = {
      provider: ragentsProductConfig.modelChoice.provider,
      get options() { return settings().modelChoice.options; },
      get selectable() { return settings().modelChoice.selectable; },
      get defaultModel() { return settings().modelChoice.defaultModel; },
      thinkingOptionsFor: (model) => settings().modelChoice.thinkingOptionsFor(model),
    };
    host.lifecycle({
      id: "ragents.product.models",
      initialize: async () => {
        await ragentsProductConfig.relay?.load();
        settings();
      },
    });
    host.methods(...productModelSettingsMethods(host.manifest.id, { get: () => settings().get(), save: (value) => settings().save(value) }));
    host.clientConfig({ chatSteps: ragentsProductConfig.chatDisplayPolicy });
    host.startOptions(...productStartOptions({
      modelChoice,
      coordinatorThinking: () => settings().coordinatorThinking(),
      systemPrompts: ragentsProductConfig.systemPrompts,
    }));
    host.skills({
      id: "ragents.product.external-skills",
      paths: () => ragentsProductConfig.skills.paths,
    });
    host.profiles({
      id: "ragents.product.profiles",
      models: productModels,
      profiles: () => settings().profiles(),
      providers: async () => ragentsProductConfig.relay ? [await ragentsProductConfig.relay.registration()] : [],
    });
    host.startEntries(...ragentsProductConfig.skills.startEntries);
    host.prompts(
      handlebarsPrompt("ragents.product.preamble", 0, ragentsProductConfig.systemPromptPath ?? pluginAsset("ragents.product", "preamble.hbs")),
      systemPromptSelectionPrompt("ragents.product.selected-prompt", 50, ragentsProductConfig.systemPrompts()),
    );
  },
};

export const plugin: PluginModule = {
  requires: ["ragents.orchestration", "ragents.workspace"],
  create: () => ragentsProductPlugin,
};
