import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { LanguageServerDescription, WorkspaceExecutorContribution } from "@ragents/workspace-executor";

export const ROSLYN_SERVER_VARIABLE = "ROSLYN_LANGUAGE_SERVER";
export const ROSLYN_SERVER_FILE = "roslyn/Microsoft.CodeAnalysis.LanguageServer.dll";

const languages = { ".cs": "csharp" } as const;

export const roslynLanguageServer: LanguageServerDescription = {
  id: "roslyn",
  label: "Roslyn",
  languages,
  rootDescription: "the .sln file (or a single .csproj)",
  solutionExtensions: [".sln", ".slnx"],
};

const dotnetCommand = (server: string, args: readonly string[]): { command: string; args: string[] } =>
  server.toLowerCase().endsWith(".dll")
    ? { command: "dotnet", args: [server, ...args] }
    : { command: server, args: [...args] };

const serverPath = (toolsDirectory: string): string => {
  const configured = process.env[ROSLYN_SERVER_VARIABLE];
  if (configured) return configured;
  const provisioned = path.join(toolsDirectory, ...ROSLYN_SERVER_FILE.split("/"));
  if (existsSync(provisioned)) return provisioned;
  throw new Error("Microsoft.CodeAnalysis.LanguageServer gibt es auf diesem Rechner nicht: weder "
    + `${ROSLYN_SERVER_VARIABLE} gesetzt noch ${provisioned} vorhanden. Ein Arbeitsplatz holt ihn mit `
    + `pnpm provision --workspace, ein Server über pnpm provision <profil>; ${ROSLYN_SERVER_VARIABLE} übersteuert beides`);
};

export const executor: WorkspaceExecutorContribution = (machine) => ({
  languageServers: [{
    ...roslynLanguageServer,
    resolveRoot: (workspaceRoot, root) => machine.resolveRootFile(workspaceRoot, root, [".sln", ".slnx", ".csproj"]),
    rootDirectory: (root) => path.dirname(root),
    launch: async (context, root) => ({
      label: "Roslyn",
      ...dotnetCommand(serverPath(machine.toolsDirectory), [
        "--stdio",
        "--logLevel", "Warning",
        "--extensionLogDirectory", path.join(context.logDirectory, "roslyn-logs"),
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
  }],
});
