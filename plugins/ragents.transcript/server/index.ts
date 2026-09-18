import type { RAgentsPlugin, ToolContributor } from "@aicontainer/ragents";
import { toolDescriptorFrom } from "@aicontainer/server/plugin-support/agent-tool.js";
import type { PluginModule } from "@aicontainer/server/plugin-support/plugin-module.js";
import { runtimeProviderToken } from "@aicontainer/server/ragents/host-services.js";
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
