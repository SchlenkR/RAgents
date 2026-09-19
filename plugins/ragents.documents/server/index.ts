import path from "node:path";
import type { RAgentsPlugin } from "@aicontainer/ragents";
import { createDocumentToolContributor } from "./tool-contributor.js";
import { createFileContentRoute, createFilesMethod, documentsApiPrefix } from "./files-route.js";
import { ragentsDocumentsConfig, ragentsDocumentsConfigDescriptors } from "./config.js";
import { RunDocumentStore } from "./store.js";
import { pluginAssetPath } from "@aicontainer/server/plugin-support/asset-path.js";
import type { PluginModule } from "@aicontainer/server/plugin-support/plugin-module.js";
import { boundToTools, handlebarsPrompt } from "@aicontainer/server/plugin-support/prompt.js";
import { documentStoreToken } from "@aicontainer/server/ragents/document-store.js";
import { sessionGuardToken } from "@aicontainer/server/ragents/host-services.js";

const promptFile = pluginAssetPath(import.meta.url, "../prompt.hbs");

const documentsPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.documents" },
  register: (host) => {
    const store = new RunDocumentStore({
      sessionDirectory: (runId) => host.storage.session(runId, "documents"),
      sessionsDirectoryPattern: path.join(host.storage.sessionsRoot, "{runId}", "plugins", host.manifest.id, "documents"),
      externalRoot: ragentsDocumentsConfig.externalRoot,
    });
    const filesFor = (runId: string) => store.directoryFor(runId);
    host.provide(documentStoreToken, store);
    host.config(...ragentsDocumentsConfigDescriptors);
    host.clientConfig({ routePrefix: documentsApiPrefix });
    host.functions(createDocumentToolContributor(filesFor));
    host.prompts(boundToTools({ ...handlebarsPrompt("ragents.documents.prompt", 400, promptFile), delivery: "initial" }, "show_document"));
    const files = { filesFor, ensureSession: host.service(sessionGuardToken) };
    host.methods(createFilesMethod(files));
    host.http(createFileContentRoute(files));
  },
};

export const plugin: PluginModule = {
  requires: ["ragents.orchestration"],
  create: () => documentsPlugin,
};
