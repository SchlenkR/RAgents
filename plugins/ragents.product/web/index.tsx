import {
  chatDisplayPolicyFrom,
  type WebPlugin,
  type WebPluginDescriptor,
} from "@ragents/web/PluginRegistry";
import { ProductModelSettings } from "@ragents/web/product/ProductModelSettings";
import { productStartOptions } from "@ragents/web/product/start-options";

const ModelSettings = () => <ProductModelSettings pluginId="ragents.product" />;

const basePlugin = (descriptor: WebPluginDescriptor): WebPlugin => ({
  ...descriptor,
  brand: {
    title: "RAgents",
  },
  startOptions: productStartOptions,
  settings: [{ id: "ragents.product.model-settings", label: "Neue Runs und Agenten", category: "models",
    order: 20, readRight: "settings.read", Settings: ModelSettings }],
});

const descriptor: WebPluginDescriptor = { id: "ragents.product" };

export const webPlugin: WebPlugin = {
  ...basePlugin(descriptor),
  activate: (config) => ({
    ...basePlugin(descriptor),
    chatDisplayPolicy: chatDisplayPolicyFrom(descriptor.id, config),
  }),
};
