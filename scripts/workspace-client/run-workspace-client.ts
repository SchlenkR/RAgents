import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostRoot } from "../../apps/server/src/host-version.ts";
import { callerDirectory } from "../../apps/server/src/profile-target.ts";
import { provisionWorkspace } from "../../apps/server/src/profile/provisioning.ts";
import { workspaceClientTransport } from "../../plugins/ragents.workspace/client/transport.ts";
import { WorkspaceClient, workstationRunsDirectory } from "../../plugins/ragents.workspace/client/workspace-client.ts";

const usage = (): string => `Verwendung: [RAGENTS_TOKEN=<token>] pnpm workspace-client <server-url> [ordner ...] [--id <kennung>] [--label <name>]
Meldet die Ordner als Arbeitsplatz beim Server an und führt dessen Aufträge mit dem Executor
dieses Rechners aus - dasselbe, was die VS-Code-Erweiterung tut, nur ohne VS Code. Ohne Ordner
gilt das aktuelle Verzeichnis. Jeder Werkzeugaufruf erscheint als eine Zeile auf stdout.
Sprachserver und Chromium holt der Start auf diesen Rechner (dasselbe wie pnpm provision
--workspace); ROSLYN_LANGUAGE_SERVER, FSHARP_LANGUAGE_SERVER und BROWSER_EXECUTABLE_PATH
übersteuern das, TypeScript und playwright-core kommen aus dem Host-Ordner. Unter Windows nennt
RAGENTS_BASH die bash.exe, die RAgents mitbringt (aus der Windows-Fassung der VS-Code-Erweiterung);
ohne sie scheitert das Werkzeug bash. Das Skript läuft, bis es mit Strg-C beendet wird.`;

export interface WorkspaceClientArguments {
  readonly serverUrl: string;
  readonly folders: readonly string[];
  readonly id: string | undefined;
  readonly label: string | undefined;
}

export const parseArguments = (argv: readonly string[]): WorkspaceClientArguments => {
  const folders: string[] = [];
  let serverUrl: string | undefined;
  let id: string | undefined;
  let label: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--id" || argument === "--label") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error(`${argument} braucht einen Wert.\n${usage()}`);
      if (argument === "--id") id = value;
      else label = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unbekanntes Argument: ${argument}\n${usage()}`);
    if (serverUrl === undefined) serverUrl = argument;
    else folders.push(argument);
  }
  if (!serverUrl) throw new Error(`Die Serveradresse fehlt.\n${usage()}`);
  if (id !== undefined && !/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new Error("--id braucht 8 bis 64 Zeichen aus A-Z, a-z, 0-9, _ und -.");
  return { serverUrl, folders, id, label };
};

/** Eine stabile Kennung je Rechner und Ordnersatz, damit der Server denselben Arbeitsplatz wiedererkennt. */
export const workspaceClientId = (host: string, folders: readonly string[]): string =>
  `cli-${createHash("sha256").update([host, ...folders].join("\n")).digest("hex").slice(0, 32)}`;

/** Ordner gelten ab dem Aufrufer; pnpm und der bin-Befehl starten das Skript in apps/server. */
export const resolvedFolders = (folders: readonly string[], caller = callerDirectory()): string[] => {
  const resolved = (folders.length > 0 ? folders : [caller]).map((folder) => path.resolve(caller, folder));
  for (const folder of resolved) {
    if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Kein Verzeichnis: ${folder}`);
  }
  return resolved;
};

const main = async (): Promise<void> => {
  const parsed = parseArguments(process.argv.slice(2));
  const folders = resolvedFolders(parsed.folders);
  const host = hostname();
  const identity = {
    id: parsed.id ?? workspaceClientId(host, folders),
    label: parsed.label ?? `${host} (${path.basename(folders[0]!)})`,
    hostname: host,
    platform: process.platform,
    folders,
    runsDirectory: workstationRunsDirectory(),
  };
  const transport = workspaceClientTransport(parsed.serverUrl, process.env.RAGENTS_TOKEN);
  const client = new WorkspaceClient(transport, identity, {
    hostRoot,
    bash: process.env.RAGENTS_BASH || undefined,
    onExecuted: ({ runId, operation, durationMs, error }) =>
      console.log(`== ${runId.slice(0, 8)} ${operation} ${durationMs} ms ${error ?? "ok"}`),
  });
  console.log(`== Arbeitsplatz ${identity.label} (${identity.id})`);
  for (const folder of folders) console.log(`== Ordner ${folder}`);
  console.log("== Werkzeuge provisionieren");
  await provisionWorkspace((line) => console.log(line));
  console.log(`== Server ${parsed.serverUrl}`);
  client.onChange(() => {
    const status = client.status;
    console.log(status.kind === "failed" ? `== Anmeldung fehlgeschlagen: ${status.message}` : `== Zustand ${status.kind}`);
  });
  await client.register();
  if (client.status.kind !== "registered") {
    process.exitCode = 1;
    transport.rpc.close();
    return;
  }
  console.log("== Angemeldet; Strg-C beendet den Arbeitsplatz");
  await new Promise<void>((finish) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      finish();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  await client.unregister();
  transport.rpc.close();
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
