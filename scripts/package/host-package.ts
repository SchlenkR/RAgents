import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";
import { readPackageVersion } from "../../apps/server/src/host-version.ts";
import { MissingEnvironmentError, parseMissingEnvironmentNotice, type MissingEnvironment } from "../../apps/server/src/missing-environment.ts";
import { DomainError } from "../../packages/ragents/src/runtime/domain-error.ts";
import type { HostPackageDownload } from "../../apps/server/src/api/contracts.ts";
import { packageManagerInvocation } from "./package-manager.ts";

const KEPT_LINES = 30;
const DRAIN_TIMEOUT_MS = 1_000;

export const isHostRoot = (candidate: string): boolean =>
  statSync(path.join(candidate, "package.json"), { throwIfNoEntry: false })?.isFile() === true
  && statSync(path.join(candidate, "apps/server/src/main.ts"), { throwIfNoEntry: false })?.isFile() === true;

export interface HostPackageSource {
  readonly download: HostPackageDownload | null | undefined;
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

export const findExecutable = (name: string, environment: NodeJS.ProcessEnv = process.env): string | undefined => {
  const extensions = process.platform === "win32" && !path.extname(name) ? (environment.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
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

export const drained = (readers: readonly Interface[]): Promise<unknown> => Promise.race([
  Promise.all(readers.map((reader) => new Promise<void>((settle) => reader.once("close", () => settle())))),
  new Promise<void>((settle) => setTimeout(settle, DRAIN_TIMEOUT_MS).unref()),
]);

/** A failure that carries a child process's finding about a missing environment variable. */
export const hostProcessFailure = (message: string, missing: MissingEnvironment | undefined): Error =>
  missing ? new MissingEnvironmentError(missing, message) : new Error(message);

export const runHostCommand = (file: string, args: readonly string[], cwd: string, environment: NodeJS.ProcessEnv, log: (line: string) => void): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let missing: MissingEnvironment | undefined;
    const recent: string[] = [];
    const line = (text: string) => {
      const notice = parseMissingEnvironmentNotice(text);
      if (notice) missing ??= notice;
      else {
        recent.push(text);
        if (recent.length > KEPT_LINES) recent.shift();
        log(text);
      }
    };
    const output = drained([child.stdout, child.stderr].map((stream) => createInterface({ input: stream }).on("line", line)));
    child.once("error", reject);
    child.once("exit", (code) => void output.then(() =>
      code === 0 ? resolve() : reject(hostProcessFailure(`${path.basename(file)} ${args.join(" ")} ended with code ${code}${recent.length ? `\n${recent.join("\n")}` : ""}`, missing))));
  });

export const HOST_PACKAGE_NAME = "@schlenkr/ragents";

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
    throw new Error("npm was not found in the PATH; without npm, the workstation cannot fetch the host. "
      + "Install Node 22 with npm.");
  }
  await mkdir(folder, { recursive: true });
  const args = ["install", "--prefix", folder, specifier];
  const node = process.platform === "win32" ? findExecutable("node.exe", environment) : undefined;
  if (process.platform === "win32" && !node) throw new Error("node.exe was not found in the PATH; npm needs Node 22 to install the workstation host");
  const invocation = packageManagerInvocation("npm", args, { node, npmExecpath: environment.npm_execpath, locations: () => [npm] });
  await runHostCommand(process.platform === "win32" ? invocation.command : npm, invocation.args, folder, environment, log);
  const root = installedHostRoot(folder);
  if (!isHostRoot(root)) throw new Error(`${specifier} did not leave a RAgents host in ${root}`);
  return root;
};

/** The host of a version: the already fetched folder, otherwise an installation from npm. */
export const ensureHostPackage = async (storage: string, version: string, environment: NodeJS.ProcessEnv, log: (line: string) => void, source?: HostPackageSource): Promise<string> => {
  if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(version)) throw new Error(`The server's host package version ${version} is not an exact npm version`);
  const folder = hostPackageFolder(storage, version);
  const pending = fetchingHosts.get(folder);
  if (pending) return pending;
  const fetching = fetchHostPackage(folder, version, environment, log, source);
  fetchingHosts.set(folder, fetching);
  try {
    return await fetching;
  } finally {
    fetchingHosts.delete(folder);
  }
};

const fetchingHosts = new Map<string, Promise<string>>();

export const verifyHostIntegrity = (content: Uint8Array, integrity: string): void => {
  if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) throw new Error("The server's host package integrity is not a SHA-512 integrity");
  const expected = Buffer.from(integrity.slice(7), "base64");
  const actual = createHash("sha512").update(content).digest();
  if (!timingSafeEqual(actual, expected)) throw new Error("The server's host package integrity does not match the downloaded tarball");
};

const fetchHostPackage = async (folder: string, version: string, environment: NodeJS.ProcessEnv, log: (line: string) => void, source?: HostPackageSource): Promise<string> => {
  const installed = installedHostRoot(folder);
  if (isHostRoot(installed)) return matchingHostVersion(installed, version);
  const specifier = hostPackageSpecifier(version, environment);
  log(`== Fetching host package ${specifier} into ${folder}`);
  let root: string;
  try {
    root = await installHostPackage(folder, specifier, environment, log);
  } catch (npmFailure) {
    await rm(folder, { recursive: true, force: true });
    const cause = npmFailure instanceof Error ? npmFailure.message : String(npmFailure);
    if (!source?.download) throw new Error(`Host ${version} is unavailable: npm failed: ${cause}. The server offers no host package download.`);
    try {
      const { download } = source;
      if (download.path !== "/api/host-package") throw new Error("The server reports an unsupported host package download path");
      log(`== npm failed: ${cause}; downloading host ${version} from the server`);
      const response = await source.fetch(download.path, { redirect: "error" });
      if (!response.ok) throw new Error(`Host package download failed: HTTP ${response.status} ${await response.text()}`);
      const content = Buffer.from(await response.arrayBuffer());
      verifyHostIntegrity(content, download.integrity);
      await mkdir(folder, { recursive: true });
      const tarball = path.join(folder, "host.tgz");
      await writeFile(tarball, content);
      try {
        root = await installHostPackage(folder, tarball, environment, log);
      } finally {
        await rm(tarball, { force: true });
      }
    } catch (serverFailure) {
      await rm(folder, { recursive: true, force: true });
      throw new Error(`Host ${version} is unavailable: npm failed: ${cause}. Server download failed: ${serverFailure instanceof Error ? serverFailure.message : String(serverFailure)}`);
    }
  }
  return matchingHostVersion(root, version);
};

export const matchingHostVersion = (root: string, version: string): string => {
  const actual = readPackageVersion(root);
  if (actual !== version) throw new DomainError("workspace-executor-version", `The workstation host at ${root} has RAgents version ${actual}, the server requires ${version}. `
    + `Use a matching checkout or install @schlenkr/ragents@${version}.`, 409);
  return root;
};
