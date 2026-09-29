import { spawn } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { containsWorkspacePath, type ProcessLaunch, type ProcessSandbox } from "@ragents/workspace-executor";
import { hostRoot } from "../host-version.js";

/** Package sources and git hosting that builds in the workspace need; the own server is always added. */
export const PROCESS_SANDBOX_DEFAULT_NETWORK: readonly string[] = [
  "registry.npmjs.org",
  "api.nuget.org",
  "globalcdn.nuget.org",
  "github.com",
  "*.github.com",
  "*.githubusercontent.com",
];

/** The folders of a run from which its rules are made; everything else under the protected roots stays hidden from it. */
export interface RunSandboxFolders {
  readonly writable: readonly string[];
  readonly readable: readonly string[];
  /** The run's own temp folder; it is writable and set in TMPDIR. */
  readonly temporary: string;
}

/** What the sandbox host needs from the process sandbox per run. */
export interface RunProcessSandboxes {
  readonly forRun: (folders: RunSandboxFolders) => ProcessSandbox;
}

export interface ServerProcessSandboxOptions {
  /** Allowed network targets, domains as in the profile file; everything else fails at the proxy. */
  readonly network: readonly string[];
  /** The address of this server, such as http://127.0.0.1:4710; none without HTTP. */
  readonly serverAddress: string | undefined;
  readonly dataDirectory: string;
  /** How the operator turns the sandbox off, as written in the profile file; every message that prevents the start names it. */
  readonly disableSetting: string;
  readonly hostRoot?: string;
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
}

const SELF_TEST_TIMEOUT_MS = 30_000;

const shellWord = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const shellCommand = (words: readonly string[]): string => words.map(shellWord).join(" ");

/** The environment inside the sandbox: its own temp folder, and every network call goes through the proxy, including the one to the own server. */
const insideEnvironment = (temporary: string, searchPath: string, platform: NodeJS.Platform): readonly string[] => [
  `PATH=${searchPath}`,
  `TMPDIR=${temporary}`,
  `TMP=${temporary}`,
  `TEMP=${temporary}`,
  "NO_PROXY=",
  "no_proxy=",
  "NODE_USE_ENV_PROXY=1",
  // Otherwise .NET connects to the proxy over IPv4-mapped IPv6 addresses, which the macOS sandbox does not recognize as localhost.
  "DOTNET_SYSTEM_NET_DISABLEIPV6=1",
  // .NET build nodes and compiler servers outlive the command and would otherwise accept builds of other runs in their own sandbox.
  "MSBUILDDISABLENODEREUSE=1",
  "DOTNET_CLI_USE_MSBUILD_SERVER=0",
  "UseSharedCompilation=false",
  // Otherwise the macOS tool shims (git, clang) create their cache in the server's blocked temp.
  ...platform === "darwin" ? [`xcrun_db=${path.join(temporary, "xcrun_db")}`] : [],
];

const serverTarget = (address: string | undefined): readonly string[] => {
  if (address === undefined) return [];
  const url = new URL(address);
  return [`${url.hostname}:${url.port}`];
};

const homeRoots = (platform: NodeJS.Platform): readonly string[] =>
  platform === "darwin" ? ["/Users"] : ["/home", "/root"];

/** The real path, even for a folder that does not exist yet: its nearest existing ancestor is resolved. */
const realOrGiven = (entry: string): string => {
  try {
    return realpathSync(entry);
  } catch {
    const parent = path.dirname(entry);
    return parent === entry ? entry : path.join(realOrGiven(parent), path.basename(entry));
  }
};

/** An entry is often a symlink (fnm, Homebrew, /tmp on macOS); the sandbox checks the target. */
const resolvedTarget = (entry: string): readonly string[] => {
  const target = realOrGiven(entry);
  return target === entry ? [] : [target];
};

/** On Linux all Unix sockets are allowed; the sockets that lead out of the sandbox therefore stay invisible. */
const hostSockets = (platform: NodeJS.Platform): readonly string[] =>
  platform === "linux" ? ["/var/run/docker.sock", "/run/docker.sock"].filter((socket) => existsSync(socket)) : [];

/** Where secrets and other runs can live: home folders, temp and the server's data folder. */
const protectedRoots = (options: ServerProcessSandboxOptions, platform: NodeJS.Platform): readonly string[] => [
  os.homedir(),
  ...homeRoots(platform),
  os.tmpdir(),
  "/tmp",
  options.dataDirectory,
  ...hostSockets(platform),
].map(realOrGiven);

/** What all runs must share: on macOS .NET creates its named mutexes and MSBuild the sockets of its build nodes at fixed places under /tmp; on Linux /tmp is a separate empty folder per command. */
const sharedWritable = (platform: NodeJS.Platform): readonly string[] => platform === "darwin"
  ? [".dotnet", `.dotnet-uid${os.userInfo().uid}`, "MSBuild*"].map((name) => path.join(realOrGiven("/tmp"), name))
  : [];

/** Where sandbox processes create and reach Unix sockets: in the data folder (temp of the runs) and on macOS in /tmp for the MSBuild build nodes. */
const socketRoots = (dataDirectory: string, platform: NodeJS.Platform): readonly string[] =>
  [dataDirectory, ...platform === "darwin" ? ["/tmp"] : []].map(realOrGiven);

/** The sandbox does not read a symlink in a blocked folder (such as fnm under ~/.local/state); PATH therefore names the targets. */
const resolvedSearchPath = (environment: NodeJS.ProcessEnv): string =>
  [...new Set((environment.PATH ?? "").split(path.delimiter).filter((entry) => entry !== "").map(realOrGiven))].join(path.delimiter);

const isInside = (root: string, candidate: string): boolean => containsWorkspacePath(root, candidate);

const entriesOf = (directory: string): readonly string[] => {
  try {
    return readdirSync(directory).map((name) => path.join(directory, name));
  } catch {
    return [];
  }
};

/** An allowed folder that contains a blocked one is split into its remaining entries; otherwise it would override the block, or the block the allowances inside it. */
const besideProtected = (entry: string, hidden: readonly string[]): readonly string[] => {
  if (hidden.some((root) => isInside(root, entry))) return [];
  if (!hidden.some((root) => isInside(entry, root))) return [entry];
  return entriesOf(entry).flatMap((child) => besideProtected(child, hidden));
};

/** Bubblewrap binds readable folders after the writable ones; a readable ancestor would cover a writable folder inside it as read-only and is therefore split into its remaining entries. */
const readableBeside = (entry: string, writable: readonly string[]): readonly string[] => {
  const inside = writable.filter((candidate) => isInside(entry, candidate));
  if (inside.length === 0) return [entry];
  if (inside.includes(entry)) return [];
  return entriesOf(entry).flatMap((child) => readableBeside(child, inside));
};

/** Toolchains under a protected folder (such as Node from fnm or dotnet tools in the home folder) stay readable, but never an ancestor of the data folder. */
const toolchainDirectories = (options: ServerProcessSandboxOptions, protectedPaths: readonly string[]): readonly string[] => {
  const environment = options.environment ?? process.env;
  const entries = [
    ...(environment.PATH ?? "").split(path.delimiter),
    environment.DOTNET_ROOT,
    environment.PNPM_HOME,
    path.dirname(path.dirname(process.execPath)),
  ].filter((entry): entry is string => entry !== undefined && path.isAbsolute(entry));
  const withTargets = entries.flatMap((entry) => [entry, ...resolvedTarget(entry)]);
  const withPrefixes = withTargets.flatMap((entry) => path.basename(entry) === "bin" ? [entry, path.dirname(entry)] : [entry]);
  const underProtected = withPrefixes.filter((entry) => protectedPaths.some((root) => isInside(root, entry)));
  const safe = underProtected.filter((entry) => !protectedPaths.some((root) => isInside(entry, root)));
  return [...new Set(safe)];
};

/** What a server grants the sandbox for all its runs: network targets and the folders in which Unix sockets may live. */
interface SandboxGrant {
  readonly network: readonly string[];
  readonly unixSockets: readonly string[];
}

/** The library has exactly one state per process; several hosts in one process share it, and their network grants are merged. */
class SharedSandboxRuntime {
  readonly #holders = new Map<object, SandboxGrant>();
  #started: Promise<void> | undefined;

  #config(): SandboxRuntimeConfig {
    const grants = [...this.#holders.values()];
    return {
      network: {
        allowedDomains: [...new Set(grants.flatMap((grant) => grant.network))],
        deniedDomains: [],
        allowUnixSockets: [...new Set(grants.flatMap((grant) => grant.unixSockets))],
        // Linux can block Unix sockets only all or nothing; the build tools (MSBuild nodes) need them.
        ...process.platform === "linux" ? { allowAllUnixSockets: true } : {},
      },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [], allowGitConfig: true },
      // On macOS .NET and Go check certificates via trustd; without this service every TLS connection fails.
      ...process.platform === "darwin" ? { enableWeakerNetworkIsolation: true } : {},
    };
  }

  async acquire(holder: object, grant: SandboxGrant): Promise<void> {
    this.#holders.set(holder, grant);
    if (!this.#started) {
      this.#started = SandboxManager.initialize(this.#config());
      await this.#started.catch((error: unknown) => {
        this.#holders.delete(holder);
        this.#started = undefined;
        throw error;
      });
      return;
    }
    await this.#started;
    SandboxManager.updateConfig(this.#config());
  }

  async release(holder: object): Promise<void> {
    if (!this.#holders.delete(holder)) return;
    if (this.#holders.size > 0) {
      SandboxManager.updateConfig(this.#config());
      return;
    }
    this.#started = undefined;
    await SandboxManager.reset();
  }
}

const sharedRuntime = new SharedSandboxRuntime();

const unsupported = (platform: NodeJS.Platform, disableSetting: string): Error => new Error(platform === "win32"
  ? "The process sandbox does not exist on a Windows server: the folder rules per run cannot be set there. "
    + `Whoever runs the server on Windows anyway turns it off explicitly in the profile file: ${disableSetting}.`
  : `The process sandbox does not know the platform ${platform}; macOS and Linux are supported. `
    + `${disableSetting} turns it off explicitly.`);

const missingDependencies = (errors: readonly string[], disableSetting: string): Error => new Error(
  `The process sandbox cannot start: ${errors.join("; ")}. `
  + "On Linux it needs bubblewrap, socat and ripgrep (Debian/Ubuntu: apt-get install bubblewrap socat ripgrep). "
  + `${disableSetting} turns it off explicitly.`);

const failedSelfTest = (detail: string, disableSetting: string): Error => new Error(
  `The process sandbox cannot be started on this machine: ${detail.trim() || "no output"}. `
  + "On Linux bubblewrap needs user namespaces; in a container the container's profile must allow them. "
  + `${disableSetting} turns it off explicitly.`);

const runSelfTest = (launch: ProcessLaunch, environment: NodeJS.ProcessEnv, disableSetting: string): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(launch.command, [...launch.args], { stdio: ["ignore", "ignore", "pipe"], env: environment });
  let stderr = "";
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    reject(failedSelfTest(`no response after ${SELF_TEST_TIMEOUT_MS / 1000} seconds`, disableSetting));
  }, SELF_TEST_TIMEOUT_MS);
  child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-2_000); });
  child.once("error", (error) => {
    clearTimeout(timer);
    reject(failedSelfTest(error.message, disableSetting));
  });
  child.once("close", (code) => {
    clearTimeout(timer);
    if (code === 0) resolve();
    else reject(failedSelfTest(`code ${code ?? "signal"}: ${stderr}`, disableSetting));
  });
});

/** The server's process sandbox: every process of a run that the server's executor starts runs with the folders and network targets of its run. */
export class ServerProcessSandbox implements RunProcessSandboxes {
  readonly #options: ServerProcessSandboxOptions;
  readonly #platform: NodeJS.Platform;
  readonly #protected: readonly string[];
  readonly #readable: readonly string[];
  readonly #searchPath: string;

  constructor(options: ServerProcessSandboxOptions) {
    this.#options = options;
    this.#platform = options.platform ?? process.platform;
    if (this.#platform !== "darwin" && this.#platform !== "linux") throw unsupported(this.#platform, options.disableSetting);
    this.#protected = protectedRoots(options, this.#platform);
    this.#readable = [options.hostRoot ?? hostRoot(), ...toolchainDirectories(options, this.#protected)];
    this.#searchPath = resolvedSearchPath(options.environment ?? process.env);
  }

  /** Checks the prerequisites, starts the network proxy and starts one process in the sandbox once; every failure is a start error. */
  async start(): Promise<void> {
    const { errors } = SandboxManager.checkDependencies();
    if (errors.length > 0) throw missingDependencies(errors, this.#options.disableSetting);
    await sharedRuntime.acquire(this, {
      network: [...this.#options.network, ...serverTarget(this.#options.serverAddress)],
      unixSockets: socketRoots(this.#options.dataDirectory, this.#platform),
    });
    try {
      const probe = this.forRun({ writable: [], readable: [], temporary: path.join(this.#options.dataDirectory, "sandbox-self-test") });
      await runSelfTest(await probe.wrap({ command: "true", args: [] }), this.#options.environment ?? process.env, this.#options.disableSetting);
    } catch (error) {
      await sharedRuntime.release(this);
      throw error;
    }
  }

  stop(): Promise<void> {
    return sharedRuntime.release(this);
  }

  forRun(folders: RunSandboxFolders): ProcessSandbox {
    const bridges = [SandboxManager.getLinuxHttpSocketPath(), SandboxManager.getLinuxSocksSocketPath()]
      .filter((socket): socket is string => socket !== undefined);
    const environment = insideEnvironment(folders.temporary, this.#searchPath, this.#platform);
    const allowed = (entries: readonly string[]): readonly string[] => entries.map(realOrGiven)
      .flatMap((entry) => besideProtected(entry, this.#protected.filter((root) => !isInside(root, entry))));
    return {
      wrap: async (launch) => {
        const writable = allowed([...folders.writable, folders.temporary, ...sharedWritable(this.#platform)]);
        const readable = allowed([...this.#readable, ...folders.readable]).flatMap((entry) => readableBeside(entry, writable));
        const filesystem = {
          denyRead: [...this.#protected],
          allowRead: [...bridges, ...readable, ...writable],
          allowWrite: [...writable],
          denyWrite: [],
        };
        const inner = shellCommand(["env", ...environment, launch.command, ...launch.args]);
        const wrapped = await SandboxManager.wrapWithSandbox(inner, undefined, { filesystem });
        return { command: "/bin/sh", args: ["-c", wrapped] };
      },
    };
  }
}
