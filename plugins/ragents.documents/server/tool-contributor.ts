import type { ToolContributor } from "@ragents/engine";
import { createDocumentWriteTool, documentWriteToolMetadata } from "./document-write-tool.js";
import { createShowDocumentTool, showDocumentToolMetadata } from "./show-document-tool.js";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import { alwaysAvailable, facesOperator } from "@ragents/host/plugin-support/tool-availability.js";

export const createDocumentToolContributor = (
  filesFor: (runId: string) => Promise<string>,
): ToolContributor => ({
  name: "ragents.documents",
  descriptors: [
    toolDescriptorFrom(showDocumentToolMetadata, facesOperator),
    toolDescriptorFrom(documentWriteToolMetadata, alwaysAvailable),
  ],
  tools: () => [createShowDocumentTool(filesFor), createDocumentWriteTool(filesFor)],
});
