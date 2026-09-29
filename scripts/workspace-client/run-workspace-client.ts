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

const usage = (): string => `Usage: [RAGENTS_TOKEN=<token>] pnpm workspace-client <server-url> [folder ...] [--id <id>] [--label <name>]
Registers the folders as a workspace with the server and executes its tasks with the executor
of this machine - the same as the VS Code extension does, just without VS Code. Without folders
the current directory applies. Every tool call appears as one line on stdout.
What the server's plugins contribute to the executor, such as language servers, the workspace loads
at registration from this host's bundles; startup fetches their tools onto this machine
(the same as pnpm provision --workspace). On Windows
RAGENTS_BASH names the bash.exe that RAgents brings along (from the Windows build of the VS Code
extension); without it the bash tool fails. RAGENTS_RG names an rg whose folder the bash has at the
front of its PATH, such as the one from the extension; if not given, one in the PATH applies. The
script runs until it is ended with Ctrl-C.`;

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
      if (!value || value.startsWith("-")) throw new Error(`${argument} needs a value.\n${usage()}`);
      if (argument === "--id") id = value;
      else label = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unknown argument: ${argument}\n${usage()}`);
    if (serverUrl === undefined) serverUrl = argument;
    else folders.push(argument);
  }
  if (!serverUrl) throw new Error(`The server address is missing.\n${usage()}`);
  if (id !== undefined && !/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new Error("--id needs 8 to 64 characters from A-Z, a-z, 0-9, _ and -.");
  return { serverUrl, folders, id, label };
};

/** A stable id per machine and folder set, so the server recognizes the same workspace again. */
export const workspaceClientId = (host: string, folders: readonly string[]): string =>
  `cli-${createHash("sha256").update([host, ...folders].join("\n")).digest("hex").slice(0, 32)}`;

/** Folders are resolved from the caller; pnpm and the bin command start the script in apps/server. */
export const resolvedFolders = (folders: readonly string[], caller = callerDirectory()): string[] => {
  const resolved = (folders.length > 0 ? folders : [caller]).map((folder) => path.resolve(caller, folder));
  for (const folder of resolved) {
    if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Not a directory: ${folder}`);
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
    rg: process.env.RAGENTS_RG || undefined,
    onExecuted: ({ runId, operation, durationMs, error }) =>
      console.log(`== ${runId.slice(0, 8)} ${operation} ${durationMs} ms ${error ?? "ok"}`),
  });
  console.log(`== Workspace ${identity.label} (${identity.id})`);
  for (const folder of folders) console.log(`== Folder ${folder}`);
  console.log("== Provisioning tools");
  await provisionWorkspace((line) => console.log(line));
  console.log(`== Server ${parsed.serverUrl}`);
  client.onChange(() => {
    const status = client.status;
    console.log(status.kind === "failed" ? `== Registration failed: ${status.message}` : `== State ${status.kind}`);
  });
  await client.register();
  if (client.status.kind !== "registered") {
    process.exitCode = 1;
    transport.rpc.close();
    return;
  }
  console.log("== Registered; Ctrl-C ends the workspace");
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
