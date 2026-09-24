import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { LanguageServerAdapter } from "../host.js";
import { resolveRootDirectory } from "../roots.js";

const languages = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascriptreact",
} as const;

/** Der Sprachserver liegt in den node_modules des Hosts; ohne Host gibt es ihn auf dieser Maschine nicht. */
const hostRequire = (hostRoot: string | undefined): NodeRequire => {
  if (!hostRoot) {
    throw new Error("Für TypeScript ist auf diesem Rechner kein Host bekannt, aus dem sich typescript-language-server "
      + "auflösen ließe. Ein Arbeitsplatz bekommt ihn mit der ersten Verbindung zu einem verteilenden Server oder über "
      + "die Einstellung ragents.hostPath");
  }
  return createRequire(path.join(hostRoot, "package.json"));
};

const missing = (hostRoot: string | undefined, name: string, cause: unknown): Error =>
  new Error(`${name} liegt nicht im Host ${hostRoot}: ${cause instanceof Error ? cause.message : String(cause)}`);

const serverScript = (hostRoot: string | undefined): string => {
  const require = hostRequire(hostRoot);
  try {
    return require.resolve("typescript-language-server/lib/cli.mjs");
  } catch (cause) {
    throw missing(hostRoot, "typescript-language-server", cause);
  }
};

const bundledTypeScriptLib = (hostRoot: string | undefined): string => {
  const require = hostRequire(hostRoot);
  try {
    return path.dirname(require.resolve("typescript"));
  } catch (cause) {
    throw missing(hostRoot, "typescript", cause);
  }
};

const hasWorkspaceTypeScript = (root: string): Promise<boolean> =>
  stat(path.join(root, "node_modules", "typescript", "lib", "tsserver.js")).then((info) => info.isFile(), () => false);

export const typescriptAdapter: LanguageServerAdapter = {
  id: "typescript",
  label: "TypeScript",
  languages,
  rootDescription: "the directory whose tsconfig.json projects should be served (e.g. src)",
  resolveRoot: resolveRootDirectory,
  rootDirectory: (root) => root,
  launch: async (context, root) => ({
    label: "TypeScript",
    command: process.execPath,
    args: [serverScript(context.hostRoot), "--stdio"],
    cwd: root,
    // Im Extension-Host ist process.execPath Electron; ohne diese Variable startet es die Anwendung statt des Skripts.
    env: { ...context.env, ELECTRON_RUN_AS_NODE: "1" },
    uid: context.uid,
    gid: context.gid,
    rootUri: pathToFileURL(root).href,
    initializationOptions: await hasWorkspaceTypeScript(root) ? {} : { tsserver: { path: bundledTypeScriptLib(context.hostRoot) } },
    languages,
    publishesOnlyChangedDiagnostics: true,
  }),
  open: async (_session, root) =>
    `TypeScript-Server auf ${path.basename(root)} bereit; Projekte werden je Datei aus der nächsten tsconfig.json geladen`,
};
