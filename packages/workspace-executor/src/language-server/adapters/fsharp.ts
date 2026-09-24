import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hostToolFile } from "../../tools.js";
import type { LanguageServerAdapter } from "../host.js";
import { dotnetCommand, resolveRootFile } from "../roots.js";
import { solutionProjects } from "../solution.js";

export const FSHARP_SERVER_VARIABLE = "FSHARP_LANGUAGE_SERVER";
export const FSHARP_PLUGIN_ID = "ragents.lsp-fsharp";
export const FSHARP_SERVER_FILE = "fsautocomplete/fsautocomplete.dll";

const languages = { ".fs": "fsharp", ".fsi": "fsharp", ".fsx": "fsharp" } as const;

const serverPath = (): string => {
  const configured = process.env[FSHARP_SERVER_VARIABLE];
  if (configured) return configured;
  const provisioned = hostToolFile(FSHARP_PLUGIN_ID, FSHARP_SERVER_FILE);
  if (existsSync(provisioned)) return provisioned;
  throw new Error("fsautocomplete gibt es auf diesem Rechner nicht: weder "
    + `${FSHARP_SERVER_VARIABLE} gesetzt noch ${provisioned} vorhanden. Ein Arbeitsplatz holt es mit `
    + `pnpm provision --workspace, ein Server über pnpm provision <profil>; ${FSHARP_SERVER_VARIABLE} übersteuert beides`);
};

const contentOf = (params: unknown): string => (params as { content?: string } | undefined)?.content ?? "";

export const fsharpAdapter: LanguageServerAdapter = {
  id: "fsharp",
  label: "FSAC",
  languages,
  rootDescription: "the .sln file (or a single .fsproj)",
  resolveRoot: (workspaceRoot, root) => resolveRootFile(workspaceRoot, root, [".sln", ".fsproj"]),
  rootDirectory: (root) => path.dirname(root),
  launch: async (context, root) => ({
    label: "FSAC",
    ...dotnetCommand(serverPath(), ["--state-directory", path.join(context.logDirectory, "fsautocomplete")]),
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
