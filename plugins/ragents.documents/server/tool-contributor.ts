import type { ToolContributor } from "@ragents/engine";
import { createDocumentWriteTool, documentWriteToolMetadata } from "./document-write-tool.js";
import { createShowDocumentTool, showDocumentToolMetadata } from "./show-document-tool.js";
import type { DocumentSources } from "./sources.js";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import { alwaysAvailable } from "@ragents/host/plugin-support/tool-availability.js";

export const createDocumentToolContributor = (sources: DocumentSources): ToolContributor => ({
  name: "ragents.documents",
  descriptors: [
    toolDescriptorFrom(showDocumentToolMetadata, alwaysAvailable),
    toolDescriptorFrom(documentWriteToolMetadata, alwaysAvailable),
  ],
  tools: () => [createShowDocumentTool(sources), createDocumentWriteTool(sources)],
});
