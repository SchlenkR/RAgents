import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { LanguageServerAdapter } from "@aicontainer/server/plugin-support/language-server/host.js";
import { createLanguageServerPlugin } from "@aicontainer/server/plugin-support/language-server/plugin.js";
import { resolveRootDirectory } from "@aicontainer/server/plugin-support/language-server/roots.js";
import type { PluginModule } from "@aicontainer/server/plugin-support/plugin-module.js";

const require = createRequire(import.meta.url);
const serverScript = require.resolve("typescript-language-server/lib/cli.mjs");
const bundledTypeScriptLib = path.dirname(require.resolve("typescript"));

const languages = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascriptreact",
} as const;

const hasWorkspaceTypeScript = (root: string): Promise<boolean> =>
  stat(path.join(root, "node_modules", "typescript", "lib", "tsserver.js")).then((info) => info.isFile(), () => false);

export const typescriptAdapter: LanguageServerAdapter = {
  id: "typescript",
  label: "TypeScript",
  languages,
  rootDescription: "the directory whose tsconfig.json projects should be served (e.g. src)",
  resolveRoot: resolveRootDirectory,
  launch: async (context, root) => ({
    label: "TypeScript",
    command: process.execPath,
    args: [serverScript, "--stdio"],
    cwd: root,
    env: context.env,
    uid: context.uid,
    gid: context.gid,
    rootUri: pathToFileURL(root).href,
    initializationOptions: await hasWorkspaceTypeScript(root) ? {} : { tsserver: { path: bundledTypeScriptLib } },
    languages,
    publishesOnlyChangedDiagnostics: true,
  }),
  open: async (_session, root) =>
    `TypeScript-Server auf ${path.basename(root)} bereit; Projekte werden je Datei aus der nächsten tsconfig.json geladen`,
};

export const plugin: PluginModule = {
  create: () => createLanguageServerPlugin({ id: "ragents.lsp-typescript", adapter: typescriptAdapter }),
};
