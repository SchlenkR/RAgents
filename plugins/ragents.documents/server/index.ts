import path from "node:path";
import type { RAgentsPlugin } from "@ragents/engine";
import { createDocumentToolContributor } from "./tool-contributor.js";
import { DOCUMENTS_ALIAS, documentsApiPrefix } from "../contract.js";
import { createContentRoute, createFilesMethod } from "./files-route.js";
import { ragentsDocumentsConfig, ragentsDocumentsConfigDescriptors } from "./config.js";
import { RunDocumentStore } from "./store.js";
import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { boundToTools, handlebarsPrompt } from "@ragents/host/plugin-support/prompt.js";
import { sandboxServicesToken, type SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
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
    const sandbox: Pick<SandboxServices, "execute"> = {
      execute: (runId, operation, input, options) => host.service(sandboxServicesToken).execute(runId, operation, input, options),
    };
    host.provide(documentStoreToken, store);
    host.config(...ragentsDocumentsConfigDescriptors);
    host.clientConfig({ routePrefix: documentsApiPrefix });
    host.functions(createDocumentToolContributor(sandbox));
    host.prompts(boundToTools({ ...handlebarsPrompt("ragents.documents.prompt", 400, pluginAsset("ragents.documents", "prompt.hbs")), delivery: "initial" },
      "show_document", "write", "copy"));
    host.methods(createFilesMethod({ filesFor, ensureSession: host.service(runGuardToken) }));
    host.http(createContentRoute({
      ensureSession: host.service(runGuardToken),
      ensureWorkspaceAccess: host.service(workspaceGuardToken),
      execute: sandbox.execute,
    }));
    host.lifecycle({
      id: "ragents.documents.lifecycle",
      initialize: () => host.service(sandboxServicesToken).registerWorkspaceRoot({
        id: "ragents.documents", alias: DOCUMENTS_ALIAS, environmentVariable: "RAGENTS_DOCUMENTS_DIR", directoryFor: filesFor,
      }),
    });
  },
};

export const plugin: PluginModule = {
  requires: ["ragents.orchestration", "ragents.workspace"],
  create: () => documentsPlugin,
};
