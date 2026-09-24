import type { RAgentsPlugin, ToolContributor } from "@ragents/engine";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { runtimeProviderToken } from "@ragents/host/ragents/host-services.js";
import { canReadTranscripts, createTranscriptTool, transcriptToolMetadata } from "./transcript.js";

const transcriptPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.transcript" },
  register: (host) => {
    const runtime = host.service(runtimeProviderToken);
    const contributor: ToolContributor = {
      name: "ragents.transcript",
      descriptors: [toolDescriptorFrom(transcriptToolMetadata, canReadTranscripts)],
      tools: () => [createTranscriptTool(runtime)],
    };
    host.functions(contributor);
  },
};

export const plugin: PluginModule = { requires: ["ragents.orchestration"], create: () => transcriptPlugin };
