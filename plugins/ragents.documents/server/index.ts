import path from "node:path";
import type { RAgentsPlugin } from "@ragents/engine";
import { createDocumentToolContributor } from "./tool-contributor.js";
import { documentsApiPrefix } from "../contract.js";
import { createFileContentRoute, createFilesMethod } from "./files-route.js";
import { ragentsDocumentsConfig, ragentsDocumentsConfigDescriptors } from "./config.js";
import { RunDocumentStore } from "./store.js";
import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { boundToTools, handlebarsPrompt } from "@ragents/host/plugin-support/prompt.js";
import { documentStoreToken } from "@ragents/host/ragents/document-store.js";
import { runGuardToken } from "@ragents/host/ragents/host-services.js";

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
    host.prompts(boundToTools({ ...handlebarsPrompt("ragents.documents.prompt", 400, pluginAsset("ragents.documents", "prompt.hbs")), delivery: "initial" }, "document_write"));
    const files = { filesFor, ensureSession: host.service(runGuardToken) };
    host.methods(createFilesMethod(files));
    host.http(createFileContentRoute(files));
  },
};

export const plugin: PluginModule = {
  requires: ["ragents.orchestration"],
  create: () => documentsPlugin,
};
