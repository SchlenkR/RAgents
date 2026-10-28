import { spawn } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { wrapCommandWithSandboxMacOS } from "@anthropic-ai/sandbox-runtime/dist/sandbox/macos-sandbox-utils.js";
import { cleanupBwrapMountPoints, wrapCommandWithSandboxLinux } from "@anthropic-ai/sandbox-runtime/dist/sandbox/linux-sandbox-utils.js";
import { matchesDomainPatternWithPort } from "@anthropic-ai/sandbox-runtime/dist/sandbox/domain-pattern.js";
import { containsWorkspacePath } from "./paths.js";
import { safeProcessEnvironment, withoutProcessStartupHooks } from "./safe-environment.js";
import { WorkspaceOperationError } from "./errors.js";
import { PROCESS_RESOURCE_PATHS, ruleAllowsPath, type WorkspaceAccessRule } from "./access-rule.js";
import { DANGEROUS_FILES, getDangerousDirectories } from "@anthropic-ai/sandbox-runtime/dist/sandbox/sandbox-utils.js";

const mandatoryWriteNames = [...DANGEROUS_FILES, ...getDangerousDirectories(), ".git/hooks"];
import type { ProcessLaunch, ProcessSandbox, TcpForward } from "./process-sandbox.js";
import { checkAvailablePorts, checkedPublishedPorts, checkedTcpForwards } from "./process-sandbox.js";
import { forwardLoopbackTargets, publishLoopbackPorts } from "./process-sandbox-ports.js";

/** Public web access; explicit targets and the own server are allowed separately. */
export const PROCESS_SANDBOX_DEFAULT_NETWORK: readonly string[] = ["*"];

const PRIVATE_NETWORK_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "fc00::/7"];

const publicWebTarget = (host: string, port: number | undefined): boolean => {
  if (port !== 80 && port !== 443) return false;
  const hostname = new URL(`http://${host}`).hostname.toLowerCase().replace(/\.$/, "");
  return isIP(hostname) === 0 && !hostname.startsWith("[")
    && hostname !== "localhost" && !hostname.endsWith(".localhost");
};

/** The folders of a run from which its rules are made; everything else under the protected roots stays hidden from it. */
export interface RunSandboxFolders {
  readonly writable: readonly string[];
  readonly readable: readonly string[];
  /** The run's own temp folder; it is writable and set in TMPDIR. */
  readonly temporary: string;
  readonly isolated?: boolean;
  readonly readOnly?: readonly string[];
  readonly grants?: WorkspaceAccessRule["grants"];
}

/** What the sandbox host needs from the process sandbox per run. */
export interface RunProcessSandboxes {
  readonly forRun: (folders: RunSandboxFolders) => ProcessSandbox;
}

export interface MachineProcessSandboxOptions {
  /** Explicit network targets; "*" additionally allows public web domains on ports 80 and 443. */
  readonly network: readonly string[];
  /** The address of this server, such as http://127.0.0.1:4710; none without HTTP. */
  readonly serverAddress: string | undefined;
  readonly dataDirectory: string;
  /** How the operator turns the sandbox off, as written in the profile file; every message that prevents the start names it. */
  readonly disableSetting: string;
  readonly blocked: readonly string[];
  readonly readable: readonly string[];
  readonly searchPath: string;
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
}

const SELF_TEST_TIMEOUT_MS = 30_000;

const shellWord = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export const sandboxShellCommand = (words: readonly string[]): string => words.map(shellWord).join(" ");

const ancestorsOf = (entry: string): readonly string[] => path.dirname(entry) === entry ? [entry] : [entry, ...ancestorsOf(path.dirname(entry))];

export const processSandboxLaunch = (command: string, platform: NodeJS.Platform, directories: readonly string[], ports: readonly number[] = [], forwardPorts: readonly number[] = [], exactPaths: readonly string[] = [], workstation = false, aliases: readonly string[] = [], machServices: readonly string[] = []): ProcessLaunch => {
  if (platform !== "darwin") return { command: "/bin/sh", args: ["-c", command] };
  const prefix = "/usr/bin/sandbox-exec -p ";
  const start = command.indexOf(prefix) + prefix.length;
  const quoted = /^'(?:[^']|'"'"')*'/.exec(command.slice(start))?.[0];
  if (start < prefix.length || !quoted) throw new Error("The macOS process sandbox command has no recognized quoted profile.");
  const profile = quoted.slice(1, -1).replaceAll("'\"'\"'", "'");
  const taskPermission = "(allow mach-priv-task-port (target same-sandbox))";
  if (!profile.startsWith("(version 1)") || !profile.includes(taskPermission))
    throw new Error("The process sandbox profile has no recognized Mach task-port restriction.");
  const metadata = [...new Set([...directories, ...aliases].flatMap(ancestorsOf))].map((entry) => JSON.stringify(entry)).join(" ");
  const exactProfile = exactPaths.reduce((result, entry) => result.replaceAll(`(subpath ${JSON.stringify(entry)})`, `(literal ${JSON.stringify(entry)})`), profile);
  const protectedProfile = exactProfile
    .replace("(version 1)", `(version 3)\n(import ${JSON.stringify("dyld-support.sb")})`)
    .replace(taskPermission, "(deny mach-priv-task-port)")
    .replace("(allow ipc-posix-shm)", "(allow ipc-posix-shm*)")
    .replace("(allow ipc-posix-sem)", "(allow ipc-posix-sem*)")
    .replace("(allow iokit-open", "(allow iokit-open*")
    .replace("(allow process-exec)", "(allow process-exec*)")
    .replace(/\bfile-read\*/g, `file-read* file-test-existence${workstation ? " file-clone" : ""}`)
    .replace("(allow file-read-metadata", "(allow file-read-metadata file-test-existence")
    .replace(/\((?:local|remote) unix-socket (\((?:subpath|path-regex) [^\n]+?\))\)/g, "$1")
    .replace(/\(sysctl-name-prefix "kern\.proc[^"\n]*"\)/g, "")
    + `\n(allow file-read-metadata file-test-existence (literal ${metadata}))`
    + '\n(allow mach-bootstrap syscall* system-fcntl socket-option*)\n(deny syscall-unix (syscall-number 202) (with errno 1))\n(allow file-map-executable dynamic-code-generation)\n(allow system-socket (socket-domain AF_INET AF_INET6))\n(allow system-mac-syscall (mac-policy-name "AMFI"))';
  const aliasRules = aliases.map((alias) => `\n(allow file-read* file-test-existence file-clone (subpath ${JSON.stringify(alias)}))\n(allow file-write* file-write-unlink file-write-create (subpath ${JSON.stringify(alias)}))\n(deny file-write-unlink file-write-create (literal ${JSON.stringify(alias)}))`).join("");
  const machRules = machServices.map((service) => {
    if (!/^[a-z0-9_.-]+\.\*$/i.test(service)) throw new Error("A process Mach service allowance must name one explicit service prefix.");
    return `\n(allow mach-register mach-lookup (global-name-prefix ${JSON.stringify(service.slice(0, -1))}))`;
  }).join("");
  const workstationRules = workstation ? '\n(allow iokit-open-service (iokit-registry-entry-class "IOSurfaceRoot") (iokit-registry-entry-class "IOPMrootDomain"))\n(allow iokit-open-user-client (iokit-user-client-class "IOSurfaceRootUserClient") (iokit-user-client-class "RootDomainUserClient"))\n(allow sysctl-read (sysctl-name "kern.hv_vmm_present") (sysctl-name "machdep.virtual_address_size"))' : "";
  const publishedProfile = protectedProfile + aliasRules + machRules + workstationRules + ports.map((port) => `\n(allow network-bind network-inbound (local ip "localhost:${port}"))`).join("")
    + forwardPorts.map((port) => `\n(allow network-outbound (remote tcp "localhost:${port}"))`).join("");
  return { command: "/bin/sh", args: ["-c", command.slice(0, start) + shellWord(publishedProfile) + command.slice(start + quoted.length)] };
};

/** The sandbox's own temp folder and proxy environment; raw TCP uses only explicit launch forwards. */
export const processSandboxEnvironment = (temporary: string, searchPath: string, platform: NodeJS.Platform): readonly string[] => [
  `PATH=${searchPath}`,
  `TMPDIR=${temporary}`,
  // Claude Code ignores TMPDIR and otherwise writes to the blocked /tmp/claude-<uid>.
  `CLAUDE_CODE_TMPDIR=${temporary}`,
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

export const sandboxHomeRoots = (platform: NodeJS.Platform): readonly string[] =>
  platform === "darwin" ? ["/Users"] : ["/home", "/root"];

/** The real path, even for a folder that does not exist yet: its nearest existing ancestor is resolved. */
export const canonicalSandboxPath = (entry: string): string => {
  try {
    return realpathSync(entry);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    const info = (() => {
      try { return lstatSync(entry); }
      catch (cause) {
        const code = (cause as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") throw cause;
        return undefined;
      }
    })();
    if (info?.isSymbolicLink()) throw error;
    const parent = path.dirname(entry);
    return parent === entry ? entry : path.join(canonicalSandboxPath(parent), path.basename(entry));
  }
};

/** An entry is often a symlink (fnm, Homebrew, /tmp on macOS); the sandbox checks the target. */
const resolvedTarget = (entry: string): readonly string[] => {
  const target = canonicalSandboxPath(entry);
  return target === entry ? [] : [target];
};

/** On Linux all Unix sockets are allowed; the sockets that lead out of the sandbox therefore stay invisible. */
export const sandboxHostSockets = (platform: NodeJS.Platform): readonly string[] =>
  platform === "linux" ? ["/var/run/docker.sock", "/run/docker.sock"].filter((socket) => existsSync(socket)) : [];

/** What all runs must share: on macOS .NET creates its named mutexes and MSBuild the sockets of its build nodes at fixed places under /tmp; on Linux /tmp is a separate empty folder per command. */
const sharedWritable = (platform: NodeJS.Platform): readonly string[] => platform === "darwin"
  ? [".dotnet", `.dotnet-uid${os.userInfo().uid}`, "MSBuild*"].map((name) => path.join(canonicalSandboxPath("/tmp"), name))
  : [];

/** Where sandbox processes create and reach Unix sockets: in the data folder (temp of the runs) and on macOS in /tmp for the MSBuild build nodes. */
const socketRoots = (dataDirectory: string, platform: NodeJS.Platform): readonly string[] =>
  [dataDirectory, ...platform === "darwin" ? ["/tmp"] : []].map(canonicalSandboxPath);

/** The sandbox does not read a symlink in a blocked folder (such as fnm under ~/.local/state); PATH therefore names the targets. */
export const sandboxSearchPath = (environment: NodeJS.ProcessEnv): string =>
  [...new Set((environment.PATH ?? "").split(path.delimiter).filter((entry) => entry !== "").map(canonicalSandboxPath))].join(path.delimiter);

const isInside = (root: string, candidate: string): boolean => containsWorkspacePath(root, candidate);

const entriesOf = (directory: string): readonly string[] => {
  try {
    return readdirSync(directory).map((name) => path.join(directory, name));
  } catch {
    return [];
  }
};

/** An allowed folder that contains a blocked one is split into its remaining entries; otherwise it would override the block, or the block the allowances inside it. */
export const sandboxBesideProtected = (entry: string, hidden: readonly string[]): readonly string[] => {
  if (hidden.some((root) => isInside(root, entry))) return [];
  if (!hidden.some((root) => isInside(entry, root))) return [entry];
  return entriesOf(entry).flatMap((child) => sandboxBesideProtected(child, hidden));
};

/** Bubblewrap binds readable folders after the writable ones; a readable ancestor would cover a writable folder inside it as read-only and is therefore split into its remaining entries. */
export const sandboxReadableBeside = (entry: string, writable: readonly string[]): readonly string[] => {
  const inside = writable.filter((candidate) => isInside(entry, candidate));
  if (inside.length === 0) return [entry];
  if (inside.includes(entry)) return [];
  return entriesOf(entry).flatMap((child) => sandboxReadableBeside(child, inside));
};

/** Toolchains under a protected folder (such as Node from fnm or dotnet tools in the home folder) stay readable, but never an ancestor of the data folder. */
export const sandboxToolchainDirectories = (environment: NodeJS.ProcessEnv, protectedPaths: readonly string[]): readonly string[] => {
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
    const network = [...new Set(grants.flatMap((grant) => grant.network))];
    return {
      network: {
        allowedDomains: network.filter((target) => target !== "*"),
        deniedDomains: [],
        ...(network.includes("*") ? { deniedResolvedAddresses: PRIVATE_NETWORK_RANGES } : {}),
        allowUnixSockets: [...new Set(grants.flatMap((grant) => grant.unixSockets))],
        // Linux can block Unix sockets only all or nothing; the build tools (MSBuild nodes) need them.
        ...process.platform === "linux" ? { allowAllUnixSockets: true } : {},
      },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [], allowGitConfig: true },
      credentials: { envVars: [{ name: "JAVA_TOOL_OPTIONS", mode: "deny" }] },
      enableWeakerNestedSandbox: false,
      // On macOS .NET and Go check certificates via trustd; without this service every TLS connection fails.
      ...process.platform === "darwin" ? { enableWeakerNetworkIsolation: true } : {},
    };
  }

  async acquire(holder: object, grant: SandboxGrant): Promise<void> {
    this.#holders.set(holder, grant);
    if (!this.#started) {
      this.#started = SandboxManager.initialize(this.#config(), async ({ host, port }) =>
        [...this.#holders.values()].some((grant) => grant.network.includes("*")) && publicWebTarget(host, port));
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

const sandboxRemedy = (setting: string): string => /[.!?]$/.test(setting) ? setting : `${setting} turns it off explicitly.`;

const unsupported = (platform: NodeJS.Platform, disableSetting: string): Error => new Error(platform === "win32"
  ? "The process sandbox does not exist on a Windows server: the folder rules per run cannot be set there. "
    + `Whoever runs the server on Windows anyway turns it off explicitly in the profile file: ${disableSetting}.`
  : `The process sandbox does not know the platform ${platform}; macOS and Linux are supported. `
    + sandboxRemedy(disableSetting));

const missingDependencies = (errors: readonly string[], disableSetting: string): Error => new Error(
  `The process sandbox cannot start: ${errors.join("; ")}. `
  + "On Linux it needs bubblewrap, socat and ripgrep (Debian/Ubuntu: apt-get install bubblewrap socat ripgrep). "
  + sandboxRemedy(disableSetting));

const failedSelfTest = (detail: string, disableSetting: string): Error => new Error(
  `The process sandbox cannot be started on this machine: ${detail.trim() || "no output"}. `
  + "On Linux bubblewrap needs user namespaces; in a container the container's profile must allow them. "
  + sandboxRemedy(disableSetting));

export const checkSandboxLaunch = (launch: ProcessLaunch, environment: NodeJS.ProcessEnv, disableSetting: string): Promise<void> => new Promise((resolve, reject) => {
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
export class MachineProcessSandbox implements RunProcessSandboxes {
  readonly #options: MachineProcessSandboxOptions;
  readonly #platform: NodeJS.Platform;
  readonly #protected: readonly string[];
  readonly #readable: readonly string[];
  readonly #searchPath: string;
  readonly #linuxWraps = new Map<string, number>();

  constructor(options: MachineProcessSandboxOptions) {
    this.#options = options;
    this.#platform = options.platform ?? process.platform;
    if (this.#platform !== "darwin" && this.#platform !== "linux") throw unsupported(this.#platform, options.disableSetting);
    this.#protected = options.blocked;
    this.#readable = options.readable;
    this.#searchPath = options.searchPath;
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
      const check = this.#platform === "linux" ? {
        command: realpathSync(process.execPath),
        args: ["-e", `if (require('node:fs').statSync('/proc').dev === ${statSync("/proc").dev}) throw new Error('The sandbox exposes the server proc filesystem');`],
      } : { command: "true", args: [] };
      try { await checkSandboxLaunch(await probe.wrap(check), safeProcessEnvironment(this.#options.environment ?? process.env), this.#options.disableSetting); }
      finally { await probe.cleanup?.(); }
    } catch (error) {
      await sharedRuntime.release(this);
      throw error;
    }
  }

  async stop(): Promise<void> {
    for (const temporary of [...this.#linuxWraps.keys()]) await this.#cleanup(temporary);
    await sharedRuntime.release(this);
  }

  #track(temporary: string, launch: ProcessLaunch): ProcessLaunch {
    if (this.#platform === "linux") this.#linuxWraps.set(temporary, (this.#linuxWraps.get(temporary) ?? 0) + 1);
    return launch;
  }

  async #cleanup(temporary: string): Promise<void> {
    while ((this.#linuxWraps.get(temporary) ?? 0) > 0) {
      cleanupBwrapMountPoints();
      this.#linuxWraps.set(temporary, this.#linuxWraps.get(temporary)! - 1);
    }
    this.#linuxWraps.delete(temporary);
  }

  forRun(folders: RunSandboxFolders): ProcessSandbox {
    const sandbox = this.#forRun(folders);
    const checkedTargets = (forwards: readonly TcpForward[], ports: readonly number[] = []): readonly TcpForward[] => {
      const checked = checkedTcpForwards(forwards, ports);
      for (const target of checked) {
        const host = isIP(target.host) === 6 ? new URL(`http://[${target.host}]`).hostname.slice(1, -1) : target.host;
        if (!this.#options.network.some((grant) => grant !== "*" && matchesDomainPatternWithPort(host, target.port, grant))) {
          throw new WorkspaceOperationError("process-tcp-denied", `TCP target ${target.host}:${target.port} is not allowed by PROCESS_SANDBOX_NETWORK; add an explicit matching grant`, 403);
        }
      }
      return checked;
    };
    return {
      rule: sandbox.rule,
      cleanup: sandbox.cleanup,
      wrap: sandbox.wrap,
      tcpEndpoints: async (forwards) => checkedTargets(forwards).map(({ insidePort }) => ({ host: "127.0.0.1", port: insidePort })),
      forwardTcp: async (launch, forwards, ports) => {
        const checkedPorts = checkedPublishedPorts(ports);
        const checked = checkedTargets(forwards, checkedPorts);
        if (this.#platform === "linux") {
          const forwarding = this.#forRun(folders, [...checkedPorts, ...checked.map((target) => target.insidePort)]);
          return publishLoopbackPorts(canonicalSandboxPath(folders.temporary), {
            ...launch, command: path.isAbsolute(launch.command) ? canonicalSandboxPath(launch.command) : launch.command,
          }, checkedPorts, forwarding.wrap, checked);
        }
        await checkAvailablePorts(checkedPorts);
        return forwardLoopbackTargets(launch, checked, this.#forRun(folders, checkedPorts, checked.map((target) => target.insidePort)).wrap);
      },
      publishPorts: async (launch, ports) => {
        const checked = checkedPublishedPorts(ports);
        const publishing = this.#forRun(folders, checked);
        if (this.#platform !== "linux" || checked.length === 0) {
          await checkAvailablePorts(checked);
          return { launch: await publishing.wrap(launch), close: async () => undefined };
        }
        return publishLoopbackPorts(canonicalSandboxPath(folders.temporary), {
          ...launch, command: path.isAbsolute(launch.command) ? canonicalSandboxPath(launch.command) : launch.command,
        }, checked, publishing.wrap);
      },
    };
  }

  #forRun(folders: RunSandboxFolders, ports: readonly number[] = [], forwardPorts: readonly number[] = []): ProcessSandbox {
    const temporary = canonicalSandboxPath(folders.temporary);
    const commandFor = (launch: ProcessLaunch): string => path.isAbsolute(launch.command) ? canonicalSandboxPath(launch.command) : launch.command;
    if (folders.isolated) return {
      cleanup: () => this.#cleanup(temporary),
      wrap: async (launch) => {
        const readable = [
          ...folders.readable, ...folders.writable, temporary,
          realpathSync(process.execPath),
          ...this.#platform === "darwin"
            ? ["/System/Library", "/usr/lib", "/usr/bin/env", "/bin/sh", "/bin/bash", "/dev/null", "/dev/urandom", "/dev/random", "/private/etc/localtime"]
            : ["/usr/lib", "/usr/bin/env", "/bin/sh", "/bin/bash", "/lib", "/lib64", "/proc", "/etc/ld.so.cache"],
        ].map(canonicalSandboxPath);
        const parameters = {
          command: sandboxShellCommand(["env", ...processSandboxEnvironment(temporary, this.#searchPath, this.#platform), commandFor(launch), ...launch.args]),
          needsNetworkRestriction: true,
          readConfig: { denyOnly: ["/"], allowWithinDeny: readable },
          writeConfig: { allowOnly: [...folders.writable, temporary].map(canonicalSandboxPath), denyWithinAllow: [] },
          allowAllUnixSockets: this.#platform === "linux" && ports.length > 0,
          enableWeakerNestedSandbox: false,
          unsetEnvVars: ["JAVA_TOOL_OPTIONS"],
        };
        const wrapped = this.#platform === "darwin" ? wrapCommandWithSandboxMacOS(parameters) : await wrapCommandWithSandboxLinux(parameters);
        return this.#track(temporary, processSandboxLaunch(wrapped, this.#platform, readable, ports, forwardPorts));
      },
    };
    const bridges = [SandboxManager.getLinuxHttpSocketPath(), SandboxManager.getLinuxSocksSocketPath()]
      .filter((socket): socket is string => socket !== undefined);
    const environment = processSandboxEnvironment(temporary, this.#searchPath, this.#platform);
    const allowed = (entries: readonly string[]): readonly string[] => entries.map(canonicalSandboxPath)
      .flatMap((entry) => sandboxBesideProtected(entry, this.#protected.filter((root) => !isInside(root, entry))));
    const writable = allowed([...folders.writable, temporary, ...sharedWritable(this.#platform)]);
    const writeGrants = (folders.grants ?? []).filter((grant) => grant.access === "write").map((grant) => grant.path);
    const readable = allowed([...this.#readable, ...folders.readable]);
    const rule: WorkspaceAccessRule = {
      blocked: this.#protected,
      processNamespaces: PROCESS_RESOURCE_PATHS,
      readable: [...bridges, ...readable],
      writable,
      readOnly: (folders.readOnly ?? []).map(canonicalSandboxPath),
      grants: folders.grants,
      writeProtected: [{ root: canonicalSandboxPath(process.cwd()), names: mandatoryWriteNames }],
    };
    return {
      rule,
      cleanup: () => this.#cleanup(temporary),
      wrap: async (launch) => {
        const processReadable = rule.readable.flatMap((entry) => sandboxReadableBeside(entry, [...writable, ...writeGrants]));
        const readGrants = (rule.grants ?? []).flatMap((grant) => sandboxReadableBeside(grant.path, [...writable, ...writeGrants]));
        const filesystem = {
          denyRead: [...rule.blocked],
          allowRead: [...processReadable, ...rule.writable, ...readGrants, ...writeGrants],
          allowWrite: [...rule.writable, ...writeGrants],
          denyWrite: [...rule.readOnly ?? []],
        };
        const inner = sandboxShellCommand(["env", ...environment, commandFor(launch), ...launch.args]);
        const wrapped = await SandboxManager.wrapWithSandbox(inner, undefined, { filesystem });
        return this.#track(temporary, processSandboxLaunch(wrapped, this.#platform, [...readable, ...writable, ...readGrants, ...writeGrants], ports, forwardPorts,
          (rule.grants ?? []).filter((grant) => !grant.directory).map((grant) => grant.path)));
      },
    };
  }
}

export { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";

export const checkProcessSandboxDependencies = (
  platform: NodeJS.Platform,
  remedy: string,
  check: () => { readonly errors: readonly string[] } = () => SandboxManager.checkDependencies(),
): void => {
  if (platform !== "darwin" && platform !== "linux") throw unsupported(platform, remedy);
  const { errors } = check();
  if (errors.length > 0) throw missingDependencies(errors, remedy);
};

export interface UnrestrictedNetworkSandboxOptions {
  readonly rule: WorkspaceAccessRule;
  readonly temporary: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly validate?: () => Promise<void>;
}

const workstationPrerequisites = new Map<NodeJS.Platform, Promise<void>>();

export const createUnrestrictedNetworkSandbox = (options: UnrestrictedNetworkSandboxOptions): ProcessSandbox => {
  const platform = options.platform ?? process.platform;
  const remedy = "Install the missing prerequisites or switch the run to Full access.";
  let linuxWraps = 0;
  const cleanup = async (): Promise<void> => {
    while (linuxWraps > 0) {
      cleanupBwrapMountPoints();
      linuxWraps--;
    }
  };
  const wrap = async (launch: ProcessLaunch): Promise<ProcessLaunch> => {
    const temporary = canonicalSandboxPath(options.temporary);
    const rule = options.rule;
    const aliases = (launch.directoryAliases ?? []).map((alias) => {
      const target = canonicalSandboxPath(alias.target);
      const parent = canonicalSandboxPath(path.dirname(alias.path));
      const lexical = path.join(parent, path.basename(alias.path));
      if (/[*?\[\]\r\n]/.test(alias.path + alias.target) || canonicalSandboxPath(alias.path) !== target || !statSync(target).isDirectory() || !isInside(temporary, target)
        || ruleAllowsPath(rule, parent, "write") || !ruleAllowsPath(rule, target, "read") || !ruleAllowsPath(rule, target, "write")
        || rule.blocked.some((entry) => isInside(target, entry))
        || (rule.writeProtected ?? []).some((entry) => isInside(target, entry.root))
        || (rule.readOnly ?? []).some((entry) => isInside(target, entry) || isInside(entry, target))) {
        throw new Error("A process directory alias must have a fixed permitted target and a parent outside the run's writable areas.");
      }
      return { path: lexical, readable: ruleAllowsPath(rule, target, "read"), writable: ruleAllowsPath(rule, target, "write") };
    });
    const writable = [...rule.writable, ...(rule.grants ?? []).filter((grant) => grant.access === "write").map((grant) => grant.path),
      ...aliases.filter((alias) => alias.writable).map((alias) => alias.path)];
    const readable = [...rule.readable, ...writable, ...(rule.grants ?? []).map((grant) => grant.path),
      ...aliases.filter((alias) => alias.readable).map((alias) => alias.path)]
      .flatMap((entry) => sandboxReadableBeside(entry, writable));
    const variables = processSandboxEnvironment(temporary, sandboxSearchPath(options.environment ?? process.env), platform)
      .filter((entry) => !/^(?:NO_PROXY|no_proxy|NODE_USE_ENV_PROXY|DOTNET_SYSTEM_NET_DISABLEIPV6)=/.test(entry));
    const command = sandboxShellCommand(["env", ...variables,
      path.isAbsolute(launch.command) ? canonicalSandboxPath(launch.command) : launch.command, ...launch.args]);
    const parameters = {
      command,
      needsNetworkRestriction: false,
      readConfig: { denyOnly: [...rule.blocked], allowWithinDeny: [...readable, ...writable] },
      writeConfig: { allowOnly: writable, denyWithinAllow: [...rule.readOnly ?? [],
        ...(rule.writeProtected ?? []).flatMap(({ root, names }) => names.flatMap((name) => [path.join(root, name), `${root}/**/${name}`]))] },
      allowAllUnixSockets: true,
      allowLocalBinding: true,
      allowGitConfig: true,
      enableWeakerNestedSandbox: false,
      enableWeakerNetworkIsolation: platform === "darwin",
      unsetEnvVars: ["JAVA_TOOL_OPTIONS"],
    };
    const wrapped = platform === "darwin" ? wrapCommandWithSandboxMacOS(parameters) : await wrapCommandWithSandboxLinux(parameters);
    if (platform === "linux") linuxWraps++;
    return processSandboxLaunch(wrapped, platform, [...readable, ...writable, ...rule.blocked], [], [],
      (rule.grants ?? []).filter((grant) => !grant.directory).map((grant) => grant.path), true, aliases.map((alias) => alias.path), launch.machServices);
  };
  const ready = async (): Promise<void> => {
    const pending = workstationPrerequisites.get(platform);
    if (pending) return pending;
    const checking = (async () => {
      try { await checkSandboxLaunch(await wrap({ command: "true", args: [] }), withoutProcessStartupHooks(options.environment ?? process.env), remedy); }
      finally { await cleanup(); }
    })();
    workstationPrerequisites.set(platform, checking);
    await checking.catch((error: unknown) => {
      workstationPrerequisites.delete(platform);
      throw error;
    });
  };
  const checkedWrap = async (launch: ProcessLaunch): Promise<ProcessLaunch> => {
    await options.validate?.();
    checkProcessSandboxDependencies(platform, remedy);
    await ready();
    return wrap(launch);
  };
  return {
    rule: options.rule,
    cleanup,
    wrap: checkedWrap,
    publishPorts: async (launch, ports) => {
      await checkAvailablePorts(checkedPublishedPorts(ports));
      return { launch: await checkedWrap(launch), close: async () => undefined };
    },
    tcpEndpoints: async (forwards) => checkedTcpForwards(forwards).map(({ host, port }) => ({ host, port })),
    forwardTcp: async (launch, forwards, ports) => {
      const checked = checkedTcpForwards(forwards, checkedPublishedPorts(ports));
      await checkAvailablePorts(ports);
      return forwardLoopbackTargets(launch, checked, checkedWrap);
    },
  };
};

export const sandboxAllowedPaths = (entries: readonly string[], blocked: readonly string[]): readonly string[] =>
  entries.map(canonicalSandboxPath).flatMap((entry) => sandboxBesideProtected(entry, blocked.filter((root) => !isInside(root, entry))));

export const sandboxSharedWritable = sharedWritable;

export const sandboxWriteProtectedNames: readonly string[] = mandatoryWriteNames;
