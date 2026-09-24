import type { ToolContributor } from "@ragents/engine";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import { facesOperator } from "@ragents/host/plugin-support/tool-availability.js";
import { askToolMetadata, createAskTool } from "./ask-tool.js";
import type { AskService } from "./contract.js";

export const createAskToolContributor = (service: AskService): ToolContributor => ({
  name: "ragents.ask",
  descriptors: [toolDescriptorFrom(askToolMetadata, facesOperator)],
  tools: () => [createAskTool(service)],
});
