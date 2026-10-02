import path from "node:path";
import { DomainError, type RAgentsPlugin } from "@ragents/engine";
import { FILE_OPERATIONS, type FileText } from "@ragents/workspace-executor";
import { createDocumentToolContributor } from "./tool-contributor.js";
import { documentsApiPrefix } from "../contract.js";
import { createFileContentRoute, createFilesMethod, createWorkspaceContentRoute } from "./files-route.js";
import { ragentsDocumentsConfig, ragentsDocumentsConfigDescriptors } from "./config.js";
import type { DocumentSources } from "./sources.js";
import { RunDocumentStore } from "./store.js";
import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { boundToTools, handlebarsPrompt } from "@ragents/host/plugin-support/prompt.js";
import { sandboxServicesToken } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { documentStoreToken } from "@ragents/host/ragents/document-store.js";
import { runGuardToken, workspaceGuardToken } from "@ragents/host/ragents/host-services.js";

const documentsPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.documents" },
  register: (host) => {
    const store = new RunDocumentStore({
      sessionDirectory: (runId) => host.storage.session(runId, "documents"),
      sessionsDirectoryPattern: path.join(host.storage.sessionsRoot, "{runId}", "plugins", host.manifest.id, "documents"),
      externalRoot: ragentsDocumentsConfig.externalRoot,
    });
    const filesFor = (runId: string) => store.directoryFor(runId);
    const sources: DocumentSources = {
      storeFor: filesFor,
      workspaceText: async (runId, filePath, call = {}) => {
        const text = await host.service(sandboxServicesToken).execute(runId, FILE_OPERATIONS.text, { path: filePath }, call) as FileText;
        if (!text.previewable) throw new DomainError("document-not-text", `${filePath}: ${text.reason}`, 422);
        return text.content;
      },
    };
    host.provide(documentStoreToken, store);
    host.config(...ragentsDocumentsConfigDescriptors);
    host.clientConfig({ routePrefix: documentsApiPrefix });
    host.functions(createDocumentToolContributor(sources));
    host.prompts(boundToTools({ ...handlebarsPrompt("ragents.documents.prompt", 400, pluginAsset("ragents.documents", "prompt.hbs")), delivery: "initial" }, "document_write"));
    const files = { filesFor, ensureSession: host.service(runGuardToken) };
    host.methods(createFilesMethod(files));
    host.http(
      createFileContentRoute(files),
      createWorkspaceContentRoute({ ensureWorkspaceAccess: host.service(workspaceGuardToken), workspaceText: (runId, filePath) => sources.workspaceText(runId, filePath) }),
    );
  },
};

export const plugin: PluginModule = {
  requires: ["ragents.orchestration", "ragents.workspace"],
  create: () => documentsPlugin,
};
