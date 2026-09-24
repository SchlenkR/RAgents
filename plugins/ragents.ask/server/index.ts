import type { RAgentsPlugin } from "@ragents/engine";
import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { handlebarsPrompt } from "@ragents/host/plugin-support/prompt.js";
import { runGuardToken } from "@ragents/host/ragents/host-services.js";
import { runtimeBridgeToken } from "@ragents/host/ragents/runtime-bridge.js";
import { createAnswerMethod } from "./answer-method.js";
import { RuntimeAskService } from "./ask-service.js";
import { askServiceToken } from "./contract.js";
import { createAskToolContributor } from "./tool-contributor.js";

const askPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.ask" },
  register: (host) => {
    const service = new RuntimeAskService();
    host.provide(askServiceToken, service);
    host.provide(runtimeBridgeToken, { bind: (runtime) => service.bind(runtime) });
    host.prompts(handlebarsPrompt("ragents.ask.prompt", 480, pluginAsset("ragents.ask", "ask.hbs")));
    host.functions(createAskToolContributor(service));
    host.methods(createAnswerMethod(service, host.service(runGuardToken)));
  },
};

export const plugin: PluginModule = { create: () => askPlugin };
