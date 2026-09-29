import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";
import { editorFreeEnvironment } from "@ragents/workspace-executor/src/safe-environment";
import { MissingEnvironmentError, parseMissingEnvironmentNotice, type MissingEnvironment } from "../../server/src/missing-environment";
import { isHostRoot } from "./connections";

export interface HostAnnouncement {
  url: string;
  token: string | undefined;
  pid: number;
}

export interface RunningHost extends HostAnnouncement {
  readonly exited: Promise<number | null>;
  stop: () => Promise<void>;
}

export interface HostCommand {
  file: string;
  args: readonly string[];
  cwd: string;
}

export interface HostStartOptions {
  profile: string;
  profileFile: string;
  dataDirectory: string;
  environment: NodeJS.ProcessEnv;
  log: (line: string) => void;
  command: HostCommand;
  /** The bundled bash for the host's executor; required on Windows, otherwise the system one if not given. */
  bash: string | undefined;
  /** The bundled rg for the host's executor; if not given, one in the PATH applies. */
  rg: string | undefined;
  startTimeoutMs?: number;
}

const START_TIMEOUT_MS = 180_000;
const STOP_TIMEOUT_MS = 10_000;
const KEPT_LINES = 30;
const DRAIN_TIMEOUT_MS = 1_000;

/** The environment of the extension without the variables of the surrounding VS Code, so child processes do not attach to it. */
export const inheritedEnvironment = (): Record<string, string> => editorFreeEnvironment(process.env);

/** The bash the Windows build of the extension brings; on other platforms, the system one applies. */
export const bundledBash = (extensionPath: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | undefined =>
  platform === "win32" ? path.join(extensionPath, "dist", "bash", `${platform}-${arch}`, "usr", "bin", "bash.exe") : undefined;

/** The rg the extension build for this platform brings; the universal one carries none, then one in the PATH applies. */
export const bundledRipgrep = (extensionPath: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | undefined => {
  const file = path.join(extensionPath, "dist", "rg", `${platform}-${arch}`, platform === "win32" ? "rg.exe" : "rg");
  return existsSync(file) ? file : undefined;
};

/** Looks for a program in the PATH; on Windows with the extensions from PATHEXT. */
export const findExecutable = (name: string, environment: NodeJS.ProcessEnv = process.env): string | undefined => {
  const extensions = process.platform === "win32" ? (environment.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const directory of (environment.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension.toLowerCase()}`);
      try {
        accessSync(candidate, constants.X_OK);
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        continue;
      }
    }
  }
  return undefined;
};

/** The host from package or checkout: Node with the tsx loader in apps/server, on a free port with announcement. */
export const hostCommand = (hostPath: string, environment: NodeJS.ProcessEnv = process.env): HostCommand => {
  const node = findExecutable("node", environment);
  if (!node) throw new Error("node was not found in the PATH; the local host needs Node 22");
  return { file: node, args: ["--import", "tsx", "src/main.ts", "--port", "0"], cwd: path.join(hostPath, "apps/server") };
};

/** Waits until the output streams are read to the end; the last line often only comes after the process has ended.
 * If a grandchild process keeps a stream open, the result does not wait for it. */
const drained = (readers: readonly Interface[]): Promise<unknown> => Promise.race([
  Promise.all(readers.map((reader) => new Promise<void>((settle) => reader.once("close", () => settle())))),
  new Promise<void>((settle) => setTimeout(settle, DRAIN_TIMEOUT_MS).unref()),
]);

/** A failure that carries a child process's finding about a missing environment variable. */
const failure = (message: string, missing: MissingEnvironment | undefined): Error =>
  missing ? new MissingEnvironmentError(missing, message) : new Error(message);

const run = (file: string, args: readonly string[], cwd: string, environment: NodeJS.ProcessEnv, log: (line: string) => void): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    let missing: MissingEnvironment | undefined;
    const line = (text: string) => {
      const notice = parseMissingEnvironmentNotice(text);
      if (notice) missing ??= notice;
      else log(text);
    };
    const output = drained([child.stdout, child.stderr].map((stream) => createInterface({ input: stream }).on("line", line)));
    child.once("error", reject);
    child.once("exit", (code) => void output.then(() =>
      code === 0 ? resolve() : reject(failure(`${path.basename(file)} ${args.join(" ")} ended with code ${code}`, missing))));
  });

/** Provisions the tools of a profile or, with --workspace, those of this workspace, like pnpm provision. */
export const provisionTools = (hostPath: string, selection: string, environment: NodeJS.ProcessEnv, log: (line: string) => void): Promise<void> => {
  const node = findExecutable("node", environment);
  if (!node) throw new Error("node was not found in the PATH; the tools cannot be provisioned");
  return run(node, ["--import", "tsx", "../../scripts/provision/run-provision.ts", selection], path.join(hostPath, "apps/server"), environment, log);
};

export const HOST_PACKAGE_NAME = "@schlenkr/ragents";

/** The package version that belongs to this extension; the extension build writes it into its package.json. */
export const packagedHostVersion = (extensionPath: string): string => {
  const file = path.join(extensionPath, "package.json");
  const version = (JSON.parse(readFileSync(file, "utf8")) as { ragents?: { packageVersion?: unknown } }).ragents?.packageVersion;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`${file}: ragents.packageVersion names the version of ${HOST_PACKAGE_NAME} that belongs to this extension`);
  }
  return version;
};

/** What npm installs: the published package; RAGENTS_HOST_PACKAGE_SPEC puts a local .tgz in its place for tests. */
export const hostPackageSpecifier = (version: string, environment: NodeJS.ProcessEnv = process.env): string =>
  environment.RAGENTS_HOST_PACKAGE_SPEC?.trim() || `${HOST_PACKAGE_NAME}@${version}`;

/** One folder per version in the extension's storage; fetched versions stay. */
export const hostPackageFolder = (storage: string, version: string): string => path.join(storage, "hosts", version);

const installedHostRoot = (folder: string): string => path.join(folder, "node_modules", ...HOST_PACKAGE_NAME.split("/"));

/** Fetches the host as an npm package into its own folder and returns its root. */
export const installHostPackage = async (folder: string, specifier: string, environment: NodeJS.ProcessEnv, log: (line: string) => void): Promise<string> => {
  const npm = findExecutable("npm", environment);
  if (!npm) {
    throw new Error("npm was not found in the PATH; without npm, the extension cannot fetch the host. "
      + "Install Node 22 with npm or set ragents.hostPath to a checkout or an installed package.");
  }
  await mkdir(folder, { recursive: true });
  await run(npm, ["install", "--prefix", folder, specifier], folder, environment, log);
  const root = installedHostRoot(folder);
  if (!isHostRoot(root)) throw new Error(`${specifier} did not leave a RAgents host in ${root}`);
  return root;
};

/** The host of a version: the already fetched folder, otherwise an installation from npm. */
export const ensureHostPackage = async (storage: string, version: string, environment: NodeJS.ProcessEnv, log: (line: string) => void): Promise<string> => {
  const folder = hostPackageFolder(storage, version);
  const installed = installedHostRoot(folder);
  if (isHostRoot(installed)) return installed;
  const specifier = hostPackageSpecifier(version, environment);
  log(`== Fetching host package ${specifier} into ${folder}`);
  return installHostPackage(folder, specifier, environment, log);
};

const terminate = (child: ChildProcess): void => {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
};

/** Starts the host and waits for its announcement {"ragents":{"url","token","pid"}} on stdout. */
export const startHost = (options: HostStartOptions): Promise<RunningHost> => new Promise((resolve, reject) => {
  const environment: NodeJS.ProcessEnv = {
    ...options.environment,
    PRODUCT_PROFILE: options.profile,
    PRODUCT_PROFILE_FILE: options.profileFile,
    DATA_DIR: options.dataDirectory,
    // The local host is the developer's workstation: there it stays their own bash.
    PROCESS_SANDBOX: options.environment.PROCESS_SANDBOX ?? "off",
    ...(options.bash === undefined ? {} : { RAGENTS_BASH: options.bash }),
    ...(options.rg === undefined ? {} : { RAGENTS_RG: options.rg }),
    // The host watches this process and ends itself when a reload or crash of VS Code takes it down.
    RAGENTS_PARENT_PID: String(process.pid),
  };
  const child = spawn(options.command.file, [...options.command.args], { cwd: options.command.cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  const recent: string[] = [];
  let missing: MissingEnvironment | undefined;
  const log = (line: string) => {
    const notice = parseMissingEnvironmentNotice(line);
    if (notice) { missing ??= notice; return; }
    recent.push(line);
    if (recent.length > KEPT_LINES) recent.shift();
    options.log(line);
  };
  let announced = false;
  const exited = new Promise<number | null>((settle) => child.once("exit", (code) => settle(code)));
  const fail = (message: string) => {
    if (announced) return;
    announced = true;
    terminate(child);
    reject(failure(`${message}${recent.length ? `\n${recent.join("\n")}` : ""}`, missing));
  };
  const timer = setTimeout(() => fail(`The host did not announce itself after ${Math.round((options.startTimeoutMs ?? START_TIMEOUT_MS) / 1000)} seconds`), options.startTimeoutMs ?? START_TIMEOUT_MS);
  child.once("error", (cause) => { clearTimeout(timer); fail(`The host could not be started: ${cause.message}`); });
  const stderr = createInterface({ input: child.stderr! }).on("line", log);
  const stdout = createInterface({ input: child.stdout! }).on("line", (line) => {
    if (announced) { log(line); return; }
    let parsed: { ragents?: { url?: unknown; token?: unknown; pid?: unknown } } | undefined;
    try { parsed = JSON.parse(line) as typeof parsed; } catch { parsed = undefined; }
    if (!parsed?.ragents || typeof parsed.ragents.url !== "string") { log(line); return; }
    announced = true;
    clearTimeout(timer);
    const announcement: HostAnnouncement = {
      url: parsed.ragents.url,
      token: typeof parsed.ragents.token === "string" ? parsed.ragents.token : undefined,
      pid: typeof parsed.ragents.pid === "number" ? parsed.ragents.pid : child.pid ?? -1,
    };
    resolve({
      ...announcement,
      exited,
      stop: async () => {
        if (child.exitCode !== null) return;
        terminate(child);
        const timeout = new Promise<void>((settle) => setTimeout(settle, STOP_TIMEOUT_MS));
        await Promise.race([exited, timeout]);
        if (child.exitCode === null) child.kill("SIGKILL");
        await exited;
      },
    });
  });
  const output = drained([stderr, stdout]);
  void exited.then((code) => {
    clearTimeout(timer);
    void output.then(() => fail(`The host ended before its announcement with code ${code}`));
  });
});
