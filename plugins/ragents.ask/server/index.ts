import type { RAgentsPlugin } from "@aicontainer/ragents";
import { pluginAssetPath } from "@aicontainer/server/plugin-support/asset-path.js";
import type { PluginModule } from "@aicontainer/server/plugin-support/plugin-module.js";
import { handlebarsPrompt } from "@aicontainer/server/plugin-support/prompt.js";
import { sessionGuardToken } from "@aicontainer/server/ragents/host-services.js";
import { runtimeBridgeToken } from "@aicontainer/server/ragents/runtime-bridge.js";
import { askApiPrefix, createAnswerRoute } from "./answer-route.js";
import { RuntimeAskService } from "./ask-service.js";
import { askServiceToken } from "./contract.js";
import { createAskToolContributor } from "./tool-contributor.js";

const askPromptPath = pluginAssetPath(import.meta.url, "../ask.hbs");

const askPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.ask" },
  register: (host) => {
    const service = new RuntimeAskService();
    host.provide(askServiceToken, service);
    host.provide(runtimeBridgeToken, { bind: (runtime) => service.bind(runtime) });
    host.clientConfig({ routePrefix: askApiPrefix });
    host.prompts(handlebarsPrompt("ragents.ask.prompt", 480, askPromptPath));
    host.functions(createAskToolContributor(service));
    host.http(createAnswerRoute(service, host.service(sessionGuardToken)));
  },
};

export const plugin: PluginModule = { create: () => askPlugin };
