import type { ToolContributor } from "@ragents/engine";
import { createShowDocumentTool, showDocumentToolMetadata } from "./show-document-tool.js";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import { alwaysAvailable } from "@ragents/host/plugin-support/tool-availability.js";
import type { SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";

export const createDocumentToolContributor = (sandbox: Pick<SandboxServices, "execute">): ToolContributor => ({
  name: "ragents.documents",
  descriptors: [toolDescriptorFrom(showDocumentToolMetadata, alwaysAvailable)],
  tools: () => [createShowDocumentTool(sandbox)],
});
