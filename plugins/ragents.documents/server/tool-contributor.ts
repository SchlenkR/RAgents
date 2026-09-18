import type { ToolContributor } from "@aicontainer/ragents";
import { createShowDocumentTool, showDocumentToolMetadata } from "./show-document-tool.js";
import { toolDescriptorFrom } from "@aicontainer/server/plugin-support/agent-tool.js";
import { facesOperator } from "@aicontainer/server/plugin-support/tool-availability.js";

export const createDocumentToolContributor = (
  filesFor: (runId: string) => Promise<string>,
): ToolContributor => ({
  name: "ragents.documents",
  descriptors: [toolDescriptorFrom(showDocumentToolMetadata, facesOperator)],
  tools: () => [createShowDocumentTool(filesFor)],
});
