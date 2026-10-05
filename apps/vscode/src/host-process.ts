import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { resolveBundledTools } from "@ragents/workspace-executor/src/bundled-tools";
import { editorFreeEnvironment } from "@ragents/workspace-executor/src/safe-environment";
import { parseMissingEnvironmentNotice, type MissingEnvironment } from "../../server/src/missing-environment";
import { drained, findExecutable, hostProcessFailure, runHostCommand } from "../../../scripts/package/host-package.ts";
export { ensureHostPackage, findExecutable, HOST_PACKAGE_NAME, hostPackageFolder, hostPackageSpecifier, installHostPackage, matchingHostVersion } from "../../../scripts/package/host-package.ts";

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

/** The environment of the extension without the variables of the surrounding VS Code, so child processes do not attach to it. */
export const inheritedEnvironment = (): Record<string, string> => editorFreeEnvironment(process.env);

export const bundledBash = (extensionPath: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | undefined =>
  resolveBundledTools({ root: extensionPath, distribution: "extension", platform, arch }).bash;

export const bundledRipgrep = (extensionPath: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch): string | undefined =>
  resolveBundledTools({ root: extensionPath, distribution: "extension", platform, arch }).rg;

/** The host from package or checkout: Node with the tsx loader in apps/server, on a free port with announcement. */
export const hostCommand = (hostPath: string, environment: NodeJS.ProcessEnv = process.env): HostCommand => {
  const node = findExecutable("node", environment);
  if (!node) throw new Error("node was not found in the PATH; the local host needs Node 22");
  return { file: node, args: ["--import", "tsx", "src/main.ts", "--port", "0"], cwd: path.join(hostPath, "apps/server") };
};

/** Provisions the tools of a profile or, with --workspace, those of this workspace, like pnpm provision. */
export const provisionTools = (hostPath: string, selection: string, environment: NodeJS.ProcessEnv, log: (line: string) => void): Promise<void> => {
  const node = findExecutable("node", environment);
  if (!node) throw new Error("node was not found in the PATH; the tools cannot be provisioned");
  return runHostCommand(node, ["--import", "tsx", "../../scripts/provision/run-provision.ts", selection], path.join(hostPath, "apps/server"), environment, log);
};

/** The package version that belongs to this extension; the extension build writes it into its package.json. */
export const packagedHostVersion = (extensionPath: string): string => {
  const file = path.join(extensionPath, "package.json");
  const version = (JSON.parse(readFileSync(file, "utf8")) as { ragents?: { packageVersion?: unknown } }).ragents?.packageVersion;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`${file}: ragents.packageVersion names the version of @schlenkr/ragents that belongs to this extension`);
  }
  return version;
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
    reject(hostProcessFailure(`${message}${recent.length ? `\n${recent.join("\n")}` : ""}`, missing));
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
