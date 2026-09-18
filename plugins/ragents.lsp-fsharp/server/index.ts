import path from "node:path";
import { pathToFileURL } from "node:url";
import type { LanguageServerAdapter } from "@aicontainer/server/plugin-support/language-server/host.js";
import { createLanguageServerPlugin } from "@aicontainer/server/plugin-support/language-server/plugin.js";
import { dotnetCommand, resolveRootFile } from "@aicontainer/server/plugin-support/language-server/roots.js";
import { solutionProjects } from "@aicontainer/server/plugin-support/language-server/solution.js";
import { declaredEnvironment } from "@aicontainer/server/plugin-support/plugin-config.js";
import type { PluginModule } from "@aicontainer/server/plugin-support/plugin-module.js";

export const fsharpConfigDescriptors = [
  { key: "FSHARP_LANGUAGE_SERVER", source: "environment" },
] as const;

const env = declaredEnvironment(fsharpConfigDescriptors);

const languages = { ".fs": "fsharp", ".fsi": "fsharp", ".fsx": "fsharp" } as const;

const serverPath = (): string => {
  const server = env.optional("FSHARP_LANGUAGE_SERVER");
  if (!server) {
    throw new Error("FSHARP_LANGUAGE_SERVER ist nicht konfiguriert: Pfad zu fsautocomplete "
      + "(Binary oder .dll) in der Sektion ragents.lsp-fsharp");
  }
  return server;
};

const contentOf = (params: unknown): string => (params as { content?: string } | undefined)?.content ?? "";

export const fsharpAdapter: LanguageServerAdapter = {
  id: "fsharp",
  label: "FSAC",
  languages,
  rootDescription: "the .sln file (or a single .fsproj)",
  resolveRoot: (workspaceRoot, root) => resolveRootFile(workspaceRoot, root, [".sln", ".fsproj"]),
  launch: async (context, root) => ({
    label: "FSAC",
    ...dotnetCommand(serverPath(), ["--state-directory", path.join(context.home, "fsautocomplete")]),
    cwd: path.dirname(root),
    env: context.env,
    uid: context.uid,
    gid: context.gid,
    rootUri: pathToFileURL(path.dirname(root)).href,
    initializationOptions: { AutomaticWorkspaceInit: false },
    languages,
  }),
  open: async (session, root, timeoutMs) => {
    const projects = root.toLowerCase().endsWith(".sln")
      ? (await solutionProjects(root)).filter((project) => project.toLowerCase().endsWith(".fsproj"))
      : [root];
    if (projects.length === 0) throw new Error(`${path.basename(root)} enthält keine F#-Projekte`);
    const finished = session.waitForNotification(timeoutMs, "Projekte geladen", (method, params) =>
      method === "fsharp/notifyWorkspace"
      && contentOf(params).includes("\"workspaceLoad\"")
      && contentOf(params).includes("\"finished\""));
    await session.request("fsharp/workspaceLoad", {
      textDocuments: projects.map((project) => ({ uri: pathToFileURL(project).href })),
    });
    await finished;
    return `${projects.length} F#-Projekt${projects.length === 1 ? "" : "e"} aus ${path.basename(root)} geladen`;
  },
};

export const plugin: PluginModule = {
  create: () => createLanguageServerPlugin({
    id: "ragents.lsp-fsharp",
    adapter: fsharpAdapter,
    tabLabel: "F#",
    configDescriptors: fsharpConfigDescriptors,
  }),
};
