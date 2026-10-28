import type { RAgentsPlugin } from "@ragents/engine";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { braveSearchConfig, braveSearchConfigDescriptors } from "./config.js";
import { braveSearchFunctions } from "./functions.js";

const braveSearchPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.brave-search" },
  register: (host) => {
    host.config(...braveSearchConfigDescriptors);
    const config = braveSearchConfig();
    host.lifecycle({
      id: "ragents.brave-search",
      initialize: () => console.log(config
        ? "Web search: web_search and news_search use Brave Search"
        : "Web search: BRAVE_API_KEY is not set, web_search and news_search are not offered"),
    });
    if (config) host.functions(...braveSearchFunctions(config));
  },
};

export const plugin: PluginModule = { create: () => braveSearchPlugin };
