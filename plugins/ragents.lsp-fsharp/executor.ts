import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { LanguageServerDescription, WorkspaceExecutorContribution } from "@ragents/workspace-executor";

export const FSHARP_SERVER_VARIABLE = "FSHARP_LANGUAGE_SERVER";
export const FSHARP_SERVER_FILE = "fsautocomplete/fsautocomplete.dll";

const languages = { ".fs": "fsharp", ".fsi": "fsharp", ".fsx": "fsharp" } as const;

export const fsharpLanguageServer: LanguageServerDescription = {
  id: "fsharp",
  label: "FSAC",
  languages,
  rootDescription: "the .sln file (or a single .fsproj)",
};

const PROJECT_LINE = /^Project\("\{[^}]+\}"\)\s*=\s*"[^"]*",\s*"([^"]+)"/gm;

/** Die Projekte einer .sln, aufgelöst neben ihr; Ordnereinträge der Solution zählen nicht. */
export const solutionProjects = async (solutionFile: string): Promise<string[]> => {
  const text = await readFile(solutionFile, "utf8");
  const directory = path.dirname(solutionFile);
  return [...text.matchAll(PROJECT_LINE)]
    .map((match) => match[1].replaceAll("\\", "/"))
    .filter((relative) => /\.[a-z]+proj$/i.test(relative))
    .map((relative) => path.resolve(directory, relative));
};

const dotnetCommand = (server: string, args: readonly string[]): { command: string; args: string[] } =>
  server.toLowerCase().endsWith(".dll")
    ? { command: "dotnet", args: [server, ...args] }
    : { command: server, args: [...args] };

const serverPath = (toolsDirectory: string): string => {
  const configured = process.env[FSHARP_SERVER_VARIABLE];
  if (configured) return configured;
  const provisioned = path.join(toolsDirectory, ...FSHARP_SERVER_FILE.split("/"));
  if (existsSync(provisioned)) return provisioned;
  throw new Error("fsautocomplete gibt es auf diesem Rechner nicht: weder "
    + `${FSHARP_SERVER_VARIABLE} gesetzt noch ${provisioned} vorhanden. Ein Arbeitsplatz holt es mit `
    + `pnpm provision --workspace, ein Server über pnpm provision <profil>; ${FSHARP_SERVER_VARIABLE} übersteuert beides`);
};

const contentOf = (params: unknown): string => (params as { content?: string } | undefined)?.content ?? "";

export const executor: WorkspaceExecutorContribution = (machine) => ({
  languageServers: [{
    ...fsharpLanguageServer,
    resolveRoot: (workspaceRoot, root) => machine.resolveRootFile(workspaceRoot, root, [".sln", ".fsproj"]),
    rootDirectory: (root) => path.dirname(root),
    launch: async (context, root) => ({
      label: "FSAC",
      ...dotnetCommand(serverPath(machine.toolsDirectory), ["--state-directory", path.join(context.logDirectory, "fsautocomplete")]),
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
  }],
});
