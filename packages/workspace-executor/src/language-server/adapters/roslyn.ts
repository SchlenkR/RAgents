import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hostToolFile } from "../../tools.js";
import type { LanguageServerAdapter } from "../host.js";
import { dotnetCommand, resolveRootFile } from "../roots.js";

export const ROSLYN_SERVER_VARIABLE = "ROSLYN_LANGUAGE_SERVER";
export const ROSLYN_PLUGIN_ID = "ragents.lsp-roslyn";
export const ROSLYN_SERVER_FILE = "roslyn/Microsoft.CodeAnalysis.LanguageServer.dll";

const languages = { ".cs": "csharp" } as const;

const serverPath = (): string => {
  const configured = process.env[ROSLYN_SERVER_VARIABLE];
  if (configured) return configured;
  const provisioned = hostToolFile(ROSLYN_PLUGIN_ID, ROSLYN_SERVER_FILE);
  if (existsSync(provisioned)) return provisioned;
  throw new Error("Microsoft.CodeAnalysis.LanguageServer gibt es auf diesem Rechner nicht: weder "
    + `${ROSLYN_SERVER_VARIABLE} gesetzt noch ${provisioned} vorhanden. Ein Arbeitsplatz holt ihn mit `
    + `pnpm provision --workspace, ein Server über pnpm provision <profil>; ${ROSLYN_SERVER_VARIABLE} übersteuert beides`);
};

export const roslynAdapter: LanguageServerAdapter = {
  id: "roslyn",
  label: "Roslyn",
  languages,
  rootDescription: "the .sln file (or a single .csproj)",
  resolveRoot: (workspaceRoot, root) => resolveRootFile(workspaceRoot, root, [".sln", ".slnx", ".csproj"]),
  rootDirectory: (root) => path.dirname(root),
  launch: async (context, root) => ({
    label: "Roslyn",
    ...dotnetCommand(serverPath(), [
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
};
