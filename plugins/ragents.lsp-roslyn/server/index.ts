import path from "node:path";
import { pathToFileURL } from "node:url";
import type { LanguageServerAdapter } from "@aicontainer/server/plugin-support/language-server/host.js";
import { createLanguageServerPlugin } from "@aicontainer/server/plugin-support/language-server/plugin.js";
import { dotnetCommand, resolveRootFile } from "@aicontainer/server/plugin-support/language-server/roots.js";
import { declaredEnvironment } from "@aicontainer/server/plugin-support/plugin-config.js";
import type { PluginModule } from "@aicontainer/server/plugin-support/plugin-module.js";

export const roslynConfigDescriptors = [
  { key: "ROSLYN_LANGUAGE_SERVER", source: "environment" },
] as const;

const env = declaredEnvironment(roslynConfigDescriptors);

const languages = { ".cs": "csharp" } as const;

const serverPath = (): string => {
  const server = env.optional("ROSLYN_LANGUAGE_SERVER");
  if (!server) {
    throw new Error("ROSLYN_LANGUAGE_SERVER ist nicht konfiguriert: Pfad zu Microsoft.CodeAnalysis.LanguageServer "
      + "(Binary oder .dll) in der Sektion ragents.lsp-roslyn");
  }
  return server;
};

export const roslynAdapter: LanguageServerAdapter = {
  id: "roslyn",
  label: "Roslyn",
  languages,
  rootDescription: "the .sln file (or a single .csproj)",
  resolveRoot: (workspaceRoot, root) => resolveRootFile(workspaceRoot, root, [".sln", ".slnx", ".csproj"]),
  launch: async (context, root) => ({
    label: "Roslyn",
    ...dotnetCommand(serverPath(), [
      "--stdio",
      "--logLevel", "Warning",
      "--extensionLogDirectory", path.join(context.home, "roslyn-logs"),
    ]),
    cwd: path.dirname(root),
    env: context.env,
    uid: context.uid,
    gid: context.gid,
    rootUri: pathToFileURL(path.dirname(root)).href,
    languages,
    newFileSettleMs: 2_000,
  }),
  open: async (session, root, timeoutMs) => {
    const uri = pathToFileURL(root).href;
    const loaded = session.waitForNotification(timeoutMs, "Projekte geladen",
      (method) => method === "workspace/projectInitializationComplete");
    if (root.toLowerCase().endsWith(".csproj")) session.notify("project/open", { projects: [uri] });
    else session.notify("solution/open", { solution: uri });
    await loaded;
    return `${path.basename(root)} geladen`;
  },
};

export const plugin: PluginModule = {
  create: () => createLanguageServerPlugin({
    id: "ragents.lsp-roslyn",
    adapter: roslynAdapter,
    configDescriptors: roslynConfigDescriptors,
  }),
};
