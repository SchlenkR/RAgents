import { stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { LanguageServerDescription, WorkspaceExecutorContribution } from "@ragents/workspace-executor";

const languages = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascriptreact",
} as const;

export const typescriptLanguageServer: LanguageServerDescription = {
  id: "typescript",
  label: "TypeScript",
  languages,
  rootDescription: "the directory whose tsconfig.json projects should be served (e.g. src)",
};

const hasWorkspaceTypeScript = (root: string): Promise<boolean> =>
  stat(path.join(root, "node_modules", "typescript", "lib", "tsserver.js")).then((info) => info.isFile(), () => false);

/** Sprachserver und Compiler liegen in den node_modules des Hosts dieser Maschine; ohne Host gibt es sie hier nicht. */
export const executor: WorkspaceExecutorContribution = (machine) => ({
  languageServers: [{
    ...typescriptLanguageServer,
    resolveRoot: machine.resolveRootDirectory,
    rootDirectory: (root) => root,
    launch: async (context, root) => ({
      label: "TypeScript",
      command: process.execPath,
      args: [machine.hostPackageFile(context.hostRoot, "typescript-language-server/lib/cli.mjs"), "--stdio"],
      cwd: root,
      // Im Extension-Host ist process.execPath Electron; ohne diese Variable startet es die Anwendung statt des Skripts.
      env: { ...context.env, ELECTRON_RUN_AS_NODE: "1" },
      uid: context.uid,
      gid: context.gid,
      rootUri: pathToFileURL(root).href,
      initializationOptions: await hasWorkspaceTypeScript(root)
        ? {}
        : { tsserver: { path: path.dirname(machine.hostPackageFile(context.hostRoot, "typescript")) } },
      languages,
      publishesOnlyChangedDiagnostics: true,
    }),
    open: async (_session, root) =>
      `TypeScript-Server auf ${path.basename(root)} bereit; Projekte werden je Datei aus der nächsten tsconfig.json geladen`,
  }],
});
