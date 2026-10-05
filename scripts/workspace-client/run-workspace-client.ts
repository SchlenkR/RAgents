import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBundledTools } from "../../packages/workspace-executor/src/bundled-tools.ts";
import { exitWorkspaceProcess, watchOwnerLifetime } from "../../packages/workspace-executor/src/owner-lifetime.mjs";
import { isCheckout } from "../../apps/server/src/host-web.ts";
import { hostRoot, readPackageVersion } from "../../apps/server/src/host-version.ts";
import { callerDirectory } from "../../apps/server/src/profile-target.ts";
import { provisionWorkspace } from "../../apps/server/src/profile/provisioning.ts";
import { workspaceClientTransport } from "../../plugins/ragents.workspace/client/transport.ts";
import { WorkspaceClient, workstationRunsDirectory } from "../../plugins/ragents.workspace/client/workspace-client.ts";

const usage = (): string => `Usage: ragents workspace-client <server-url> [folder ...] [--id <id>] [--label <name>] [--detached]
Registers the folders as a workspace and executes tasks with the same tools as VS Code.
Without folders the current directory applies. Tools are provisioned before registration.
The npm package includes ripgrep and, on Windows, Bash. In a checkout run pnpm bundle:rg
(and pnpm bundle:bash on Windows) first.
Set RAGENTS_TOKEN for an existing session or RAGENTS_USER and RAGENTS_PASSWORD for automatic
sign-in and renewal. Credentials belong only in the environment.
By default closing stdin, the terminal, or the owning process ends the client and its children.
--detached explicitly opts out of terminal and parent ownership for nohup or a service manager;
SIGINT and SIGTERM still stop it. It does not daemonize the process.`;

export interface WorkspaceClientArguments {
  readonly detached: boolean;
  readonly serverUrl: string;
  readonly folders: readonly string[];
  readonly id: string | undefined;
  readonly label: string | undefined;
}

export const parseArguments = (argv: readonly string[]): WorkspaceClientArguments => {
  const folders: string[] = [];
  let detached = false;
  let serverUrl: string | undefined;
  let id: string | undefined;
  let label: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--detached") { detached = true; continue; }
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
  return { serverUrl, folders, id, label, detached };
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
  let stopping: Promise<void> | undefined;
  const stop = (code: number, reason: string): Promise<void> => stopping ??= (async () => {
    console.log(`== Stopping workspace: ${reason}`);
    const force = setTimeout(() => exitWorkspaceProcess(code || 1), 15_000);
    try {
      await client.unregister();
      transport.rpc.close();
    } finally {
      clearTimeout(force);
      exitWorkspaceProcess(code);
    }
  })();
  const releaseOwner = watchOwnerLifetime({
    detached: parsed.detached,
    parents: [process.ppid, ...process.env.RAGENTS_WORKSPACE_OWNER_PID ? [Number(process.env.RAGENTS_WORKSPACE_OWNER_PID)] : []],
    stdin: process.send ? null : process.stdin,
    onStop: (reason) => { void stop(0, reason); },
  });
  process.on("message", (message: unknown) => {
    if (typeof message === "object" && message !== null && (message as { type?: string }).type === "workspace-stop") void stop(0, "owner stopped");
  });
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
  const root = hostRoot();
  const tools = resolveBundledTools({ root: isCheckout(root) ? path.join(root, "apps/vscode") : root, distribution: isCheckout(root) ? "extension" : "package" });
  const client = new WorkspaceClient(transport, identity, {
    hostRoot,
    version: readPackageVersion(root),
    ...tools,
    onExecuted: ({ runId, operation, durationMs, error }) =>
      console.log(`== ${runId.slice(0, 8)} ${operation} ${durationMs} ms ${error ?? "ok"}`),
  });
  console.log(`== Workspace ${identity.label} (${identity.id})`);
  for (const folder of folders) console.log(`== Folder ${folder}`);
  process.send?.({ type: "workspace-ready" });
  console.log("== Provisioning tools");
  await provisionWorkspace((line) => console.log(line));
  console.log(`== Server ${parsed.serverUrl}`);
  const workspace = client;
  workspace.onChange(() => {
    const status = workspace.status;
    console.log(status.kind === "failed" ? `== Registration failed: ${status.message}` : `== State ${status.kind}`);
    if (status.kind === "failed" && !stopping && (status.mismatch || transport.rpc.status.kind === "unauthorized")) void stop(1, "registration or sign-in failed");
  });
  await workspace.register();
  if (stopping) return;
  if (workspace.status.kind !== "registered") return stop(1, "registration failed");
  console.log("== Registered; Ctrl-C ends the workspace");
  process.once("exit", releaseOwner);
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    exitWorkspaceProcess(1);
  });
}
