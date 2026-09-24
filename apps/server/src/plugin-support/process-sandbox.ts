import { spawn } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { containsWorkspacePath, type ProcessLaunch, type ProcessSandbox } from "@ragents/workspace-executor";
import { hostRoot } from "../host-version.js";

/** Paketquellen und Git-Hosting, die Builds im Arbeitsbereich brauchen; der eigene Server kommt immer dazu. */
export const PROCESS_SANDBOX_DEFAULT_NETWORK: readonly string[] = [
  "registry.npmjs.org",
  "api.nuget.org",
  "globalcdn.nuget.org",
  "github.com",
  "*.github.com",
  "*.githubusercontent.com",
];

/** Die Ordner eines Runs, aus denen seine Regeln entstehen; alles andere unter den geschützten Wurzeln bleibt ihm verborgen. */
export interface RunSandboxFolders {
  readonly writable: readonly string[];
  readonly readable: readonly string[];
  /** Der eigene Temp-Ordner des Runs; er ist beschreibbar und steht in TMPDIR. */
  readonly temporary: string;
}

/** Was der Sandbox-Host je Run von der Prozess-Sandbox braucht. */
export interface RunProcessSandboxes {
  readonly forRun: (folders: RunSandboxFolders) => ProcessSandbox;
}

export interface ServerProcessSandboxOptions {
  /** Erlaubte Ziele im Netz, Domains wie in der Profildatei; alles andere scheitert am Proxy. */
  readonly network: readonly string[];
  /** Die Adresse dieses Servers, etwa http://127.0.0.1:4710; ohne HTTP keine. */
  readonly serverAddress: string | undefined;
  readonly dataDirectory: string;
  readonly hostRoot?: string;
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
}

const SELF_TEST_TIMEOUT_MS = 30_000;

const shellWord = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const shellCommand = (words: readonly string[]): string => words.map(shellWord).join(" ");

/** Die Umgebung innerhalb der Sandbox: eigener Temp-Ordner, und jeder Netzaufruf geht über den Proxy, auch der zum eigenen Server. */
const insideEnvironment = (temporary: string, searchPath: string, platform: NodeJS.Platform): readonly string[] => [
  `PATH=${searchPath}`,
  `TMPDIR=${temporary}`,
  `TMP=${temporary}`,
  `TEMP=${temporary}`,
  "NO_PROXY=",
  "no_proxy=",
  "NODE_USE_ENV_PROXY=1",
  // .NET verbindet sich sonst über IPv4-gemappte IPv6-Adressen mit dem Proxy, die die Sandbox von macOS nicht als localhost erkennt.
  "DOTNET_SYSTEM_NET_DISABLEIPV6=1",
  // Build-Knoten und Compiler-Server von .NET überleben den Befehl und nähmen sonst Builds anderer Runs in ihrer eigenen Sandbox an.
  "MSBUILDDISABLENODEREUSE=1",
  "DOTNET_CLI_USE_MSBUILD_SERVER=0",
  "UseSharedCompilation=false",
  // Die Werkzeug-Shims von macOS (git, clang) legen ihren Cache sonst im gesperrten Temp des Servers an.
  ...platform === "darwin" ? [`xcrun_db=${path.join(temporary, "xcrun_db")}`] : [],
];

const serverTarget = (address: string | undefined): readonly string[] => {
  if (address === undefined) return [];
  const url = new URL(address);
  return [`${url.hostname}:${url.port}`];
};

const homeRoots = (platform: NodeJS.Platform): readonly string[] =>
  platform === "darwin" ? ["/Users"] : ["/home", "/root"];

/** Der echte Pfad, auch für einen Ordner, den es noch nicht gibt: sein nächster vorhandener Vorfahr wird aufgelöst. */
const realOrGiven = (entry: string): string => {
  try {
    return realpathSync(entry);
  } catch {
    const parent = path.dirname(entry);
    return parent === entry ? entry : path.join(realOrGiven(parent), path.basename(entry));
  }
};

/** Ein Eintrag ist oft ein Symlink (fnm, Homebrew, /tmp unter macOS); die Sandbox prüft das Ziel. */
const resolvedTarget = (entry: string): readonly string[] => {
  const target = realOrGiven(entry);
  return target === entry ? [] : [target];
};

/** Unter Linux sind alle Unix-Sockets erlaubt; die Sockets, die aus der Sandbox hinausführen, bleiben deshalb unsichtbar. */
const hostSockets = (platform: NodeJS.Platform): readonly string[] =>
  platform === "linux" ? ["/var/run/docker.sock", "/run/docker.sock"].filter((socket) => existsSync(socket)) : [];

/** Wo Geheimnisse und fremde Runs liegen können: Home-Ordner, Temp und der Datenordner des Servers. */
const protectedRoots = (options: ServerProcessSandboxOptions, platform: NodeJS.Platform): readonly string[] => [
  os.homedir(),
  ...homeRoots(platform),
  os.tmpdir(),
  "/tmp",
  options.dataDirectory,
  ...hostSockets(platform),
].map(realOrGiven);

/** Was sich alle Runs teilen müssen: unter macOS legen .NET seine benannten Mutexe und MSBuild die Sockets seiner Build-Knoten fest unter /tmp an; unter Linux ist /tmp je Befehl ein eigener leerer Ordner. */
const sharedWritable = (platform: NodeJS.Platform): readonly string[] => platform === "darwin"
  ? [".dotnet", `.dotnet-uid${os.userInfo().uid}`, "MSBuild*"].map((name) => path.join(realOrGiven("/tmp"), name))
  : [];

/** Wo Prozesse der Sandbox Unix-Sockets anlegen und erreichen: im Datenordner (Temp der Runs) und unter macOS in /tmp für die Build-Knoten von MSBuild. */
const socketRoots = (dataDirectory: string, platform: NodeJS.Platform): readonly string[] =>
  [dataDirectory, ...platform === "darwin" ? ["/tmp"] : []].map(realOrGiven);

/** Die Sandbox liest einen Symlink in einem gesperrten Ordner nicht (etwa fnm unter ~/.local/state); PATH nennt deshalb die Ziele. */
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

/** Ein freigegebener Ordner, der einen gesperrten enthält, wird in seine übrigen Einträge zerlegt; sonst hebelte er die Sperre aus oder die Sperre die Freigaben darin. */
const besideProtected = (entry: string, hidden: readonly string[]): readonly string[] => {
  if (hidden.some((root) => isInside(root, entry))) return [];
  if (!hidden.some((root) => isInside(entry, root))) return [entry];
  return entriesOf(entry).flatMap((child) => besideProtected(child, hidden));
};

/** Bubblewrap bindet lesbare Ordner nach den beschreibbaren ein; ein lesbarer Vorfahr überdeckte einen beschreibbaren Ordner darin schreibgeschützt und wird deshalb in seine übrigen Einträge zerlegt. */
const readableBeside = (entry: string, writable: readonly string[]): readonly string[] => {
  const inside = writable.filter((candidate) => isInside(entry, candidate));
  if (inside.length === 0) return [entry];
  if (inside.includes(entry)) return [];
  return entriesOf(entry).flatMap((child) => readableBeside(child, inside));
};

/** Toolchains unter einem geschützten Ordner (etwa Node aus fnm oder dotnet-Werkzeuge im Home) bleiben lesbar, nie aber ein Vorfahr des Datenordners. */
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

/** Was ein Server der Sandbox für alle seine Runs freigibt: Netzziele und die Ordner, in denen Unix-Sockets liegen dürfen. */
interface SandboxGrant {
  readonly network: readonly string[];
  readonly unixSockets: readonly string[];
}

/** Die Bibliothek hat genau einen Zustand je Prozess; mehrere Hosts in einem Prozess teilen ihn, ihre Netzfreigaben werden vereinigt. */
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
        // Linux kann Unix-Sockets nur ganz oder gar nicht sperren; die Build-Werkzeuge (MSBuild-Knoten) brauchen sie.
        ...process.platform === "linux" ? { allowAllUnixSockets: true } : {},
      },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [], allowGitConfig: true },
      // Unter macOS prüfen .NET und Go Zertifikate über trustd; ohne diesen Dienst scheitert jedes TLS.
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

const unsupported = (platform: NodeJS.Platform): Error => new Error(platform === "win32"
  ? "Die Prozess-Sandbox gibt es auf einem Windows-Server nicht: dort lassen sich die Ordnerregeln je Run nicht setzen. "
    + "Wer den Server trotzdem unter Windows betreibt, schaltet sie in der Profildatei ausdrücklich ab: "
    + "PROCESS_SANDBOX: \"off\" in der Sektion ragents.workspace."
  : `Die Prozess-Sandbox kennt die Plattform ${platform} nicht; unterstützt sind macOS und Linux. `
    + "PROCESS_SANDBOX: \"off\" in der Sektion ragents.workspace schaltet sie ausdrücklich ab.");

const missingDependencies = (errors: readonly string[]): Error => new Error(
  `Die Prozess-Sandbox kann nicht starten: ${errors.join("; ")}. `
  + "Unter Linux braucht sie bubblewrap, socat und ripgrep (Debian/Ubuntu: apt-get install bubblewrap socat ripgrep). "
  + "PROCESS_SANDBOX: \"off\" in der Sektion ragents.workspace schaltet sie ausdrücklich ab.");

const failedSelfTest = (detail: string): Error => new Error(
  `Die Prozess-Sandbox lässt sich auf diesem Rechner nicht starten: ${detail.trim() || "ohne Ausgabe"}. `
  + "Unter Linux braucht bubblewrap Benutzer-Namensräume; in einem Container muss das Profil des Containers sie erlauben. "
  + "PROCESS_SANDBOX: \"off\" in der Sektion ragents.workspace schaltet sie ausdrücklich ab.");

const runSelfTest = (launch: ProcessLaunch, environment: NodeJS.ProcessEnv): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(launch.command, [...launch.args], { stdio: ["ignore", "ignore", "pipe"], env: environment });
  let stderr = "";
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    reject(failedSelfTest(`keine Antwort nach ${SELF_TEST_TIMEOUT_MS / 1000} Sekunden`));
  }, SELF_TEST_TIMEOUT_MS);
  child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-2_000); });
  child.once("error", (error) => {
    clearTimeout(timer);
    reject(failedSelfTest(error.message));
  });
  child.once("close", (code) => {
    clearTimeout(timer);
    if (code === 0) resolve();
    else reject(failedSelfTest(`Code ${code ?? "Signal"}: ${stderr}`));
  });
});

/** Die Prozess-Sandbox des Servers: jeder Prozess eines Runs, den der Executor des Servers startet, läuft mit den Ordnern und Netzzielen seines Runs. */
export class ServerProcessSandbox implements RunProcessSandboxes {
  readonly #options: ServerProcessSandboxOptions;
  readonly #platform: NodeJS.Platform;
  readonly #protected: readonly string[];
  readonly #readable: readonly string[];
  readonly #searchPath: string;

  constructor(options: ServerProcessSandboxOptions) {
    this.#options = options;
    this.#platform = options.platform ?? process.platform;
    if (this.#platform !== "darwin" && this.#platform !== "linux") throw unsupported(this.#platform);
    this.#protected = protectedRoots(options, this.#platform);
    this.#readable = [options.hostRoot ?? hostRoot(), ...toolchainDirectories(options, this.#protected)];
    this.#searchPath = resolvedSearchPath(options.environment ?? process.env);
  }

  /** Prüft die Voraussetzungen, startet den Netz-Proxy und startet einmal einen Prozess in der Sandbox; jedes Scheitern ist ein Startfehler. */
  async start(): Promise<void> {
    const { errors } = SandboxManager.checkDependencies();
    if (errors.length > 0) throw missingDependencies(errors);
    await sharedRuntime.acquire(this, {
      network: [...this.#options.network, ...serverTarget(this.#options.serverAddress)],
      unixSockets: socketRoots(this.#options.dataDirectory, this.#platform),
    });
    try {
      const probe = this.forRun({ writable: [], readable: [], temporary: path.join(this.#options.dataDirectory, "sandbox-self-test") });
      await runSelfTest(await probe.wrap({ command: "true", args: [] }), this.#options.environment ?? process.env);
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
