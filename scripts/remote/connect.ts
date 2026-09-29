import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract as extractTar } from "tar";
import { ragentsDataRoot } from "../../apps/server/src/data-directory.ts";
import { filesBelow } from "../../apps/server/src/folder-install.ts";
import { removeHostRecord, writeHostRecord } from "../../apps/server/src/host-record.ts";
import { hostRoot, readHostApiVersion, readHostPackage } from "../../apps/server/src/host-version.ts";
import { BUNDLE_MANIFEST_FILE, bundleRevision } from "../../apps/server/src/profile/bundle-manifest.ts";
import { readProfileTarget } from "../../apps/server/src/profile-target.ts";
import { RpcClient } from "../../apps/web/src/rpc/client.ts";
import { profileDistributionContracts, type ClientProfileDescription } from "../../plugins/ragents.profile-distribution/contract.ts";

const usage = (): string => `Usage: RAGENTS_TOKEN=<token> ragents connect <server-url> [--port <n>] [--clean] [--no-start]
Fetches the server's client profile together with its bundles into the local cache, checks the host
API against this host and starts the local server with the profile and this host's web app. --clean
removes older versions, --no-start ends after fetching and names the profile file and data folder.
In the checkout the command is pnpm connect.`;

export interface ConnectOptions {
  readonly serverUrl: string;
  readonly token: string;
  readonly dataRoot?: string;
  /** The host whose host API and built-in bundles must fit the profile: checkout or package; defaults to this one. */
  readonly hostPath?: string;
  readonly clean?: boolean;
  readonly fetch?: typeof fetch;
}

export interface ConnectedProfile {
  readonly description: ClientProfileDescription;
  readonly profileFile: string;
  readonly dataDirectory: string;
  readonly cacheDirectory: string;
  readonly downloaded: boolean;
}

/** The version that ragents start brings up again without the server. */
export interface CachedProfile {
  readonly serverUrl: string;
  readonly profile: string;
  readonly version: string;
  readonly profileFile: string;
  readonly dataDirectory: string;
}

export const parseArguments = (argv: readonly string[]): { serverUrl: string; port: number | undefined; clean: boolean; start: boolean } => {
  let serverUrl: string | undefined;
  let port: number | undefined;
  let clean = false;
  let start = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--clean") { clean = true; continue; }
    if (argument === "--no-start") { start = false; continue; }
    if (argument === "--port") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error(`--port needs an integer from 0 to 65535, not ${argv[index + 1]}`);
      port = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-") || serverUrl) throw new Error(`Unknown argument: ${argument}\n${usage()}`);
    serverUrl = argument;
  }
  if (!serverUrl) throw new Error(`The server address is missing.\n${usage()}`);
  return { serverUrl, port, clean, start };
};

/** One folder name per server: hostname and port, so two servers never share the same cache. */
export const serverFolderName = (serverUrl: string): string => {
  const parsed = new URL(serverUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`The server address needs http or https: ${serverUrl}`);
  const host = parsed.hostname.toLowerCase().replace(/[^a-z0-9.-]/g, "_");
  return parsed.port ? `${host}-${parsed.port}` : host;
};

export const remoteLayout = (dataRoot: string, serverUrl: string, profile: string) => {
  const base = path.join(dataRoot, "remote", serverFolderName(serverUrl), profile);
  return { base, profiles: path.join(base, "profiles"), data: path.join(base, "data"), current: path.join(base, "current.json") };
};

const describeProfile = async (options: ConnectOptions): Promise<ClientProfileDescription> => {
  const baseUrl = options.serverUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const rpc = new RpcClient({
    baseUrl,
    fetch: (input, init) => fetchImpl(input, { ...init, headers: { ...init?.headers as Record<string, string> | undefined, authorization: `Bearer ${options.token}` } }),
  });
  const description = await rpc.call(profileDistributionContracts.describe, {}).catch((error: unknown) => {
    throw new Error(`The server ${baseUrl} provides no client profile: ${error instanceof Error ? error.message : String(error)}`);
  });
  return checkedDescription(baseUrl, description);
};

/** Version, profile and file become paths in the cache; only what cannot lead out of it is accepted. */
const checkedDescription = (baseUrl: string, description: ClientProfileDescription): ClientProfileDescription => {
  const rejected = (field: string, value: string): Error =>
    new Error(`The server ${baseUrl} names an invalid client profile: ${field} ${JSON.stringify(value)}`);
  if (!/^[0-9a-f]{64}$/.test(description.version)) throw rejected("version", description.version);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(description.profile)) throw rejected("profile", description.profile);
  const segments = description.file.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.includes("\\"))
    || segments.at(-1) !== `ragents.config.${description.profile}.ts`) throw rejected("file", description.file);
  return description;
};

const downloadArchive = async (options: ConnectOptions, description: ClientProfileDescription): Promise<Buffer> => {
  const address = `${options.serverUrl.replace(/\/+$/, "")}${description.archivePath}`;
  const response = await (options.fetch ?? fetch)(address, { headers: { authorization: `Bearer ${options.token}` } });
  if (!response.ok) throw new Error(`The archive ${address} does not arrive: ${response.status} ${(await response.text()).slice(0, 200)}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== description.version) throw new Error(`The archive ${address} does not match the announced version: expected ${description.version}, received ${digest}`);
  if (archive.byteLength !== description.size) throw new Error(`The archive ${address} has ${archive.byteLength} bytes, ${description.size} were announced`);
  return archive;
};

/** The profile file is ESM; without this marker Node reads it as CommonJS in the cache. The host's hook loads bundles as ESM anyway. */
const markAsModule = async (directory: string): Promise<void> => {
  const file = path.join(directory, "package.json");
  if (!existsSync(file)) {
    await writeFile(file, `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
    return;
  }
  const declared = (JSON.parse(await readFile(file, "utf8")) as { type?: unknown }).type;
  if (declared !== "module") throw new Error(`The archive brings a package.json with type ${JSON.stringify(declared)}; RAgents profiles are ESM`);
};

/** Every bundle in the archive must carry exactly the files it was built with; lossy packing would otherwise only show up when loading. */
const assertArchivedBundles = (staging: string): void => {
  for (const manifestFile of filesBelow(staging).filter((file) => path.posix.basename(file) === BUNDLE_MANIFEST_FILE)) {
    const folder = path.join(staging, ...path.posix.dirname(manifestFile).split("/"));
    const manifest = JSON.parse(readFileSync(path.join(folder, BUNDLE_MANIFEST_FILE), "utf8")) as { id?: unknown; revision?: unknown };
    if (bundleRevision(folder) !== manifest.revision) {
      throw new Error(`The bundle ${String(manifest.id)} in the server's archive does not have the files it was built with (revision in ${manifestFile}); rebuild it on the server and repeat ragents connect`);
    }
  }
};

/** How a host gets to the server's version depends on where it comes from: package or checkout. */
const hostAdvice = (hostPath: string, description: ClientProfileDescription): string => {
  const packaged = readHostPackage(hostPath);
  return packaged
    ? `Get the server's version: npm install -g ${packaged.name}@${description.packageVersion} (installed is ${packaged.version}).`
    : `Switch to the server's commit: git -C ${JSON.stringify(hostPath)} fetch && git -C ${JSON.stringify(hostPath)} checkout ${description.hostVersion}, then pnpm build:plugins and pnpm build:web.`;
};

/** The profile's built-in plugins for which the host has no bundle; without them the profile does not start. */
const missingBuiltIns = (hostPath: string, description: ClientProfileDescription): readonly string[] =>
  description.plugins
    .filter((plugin) => plugin.source === "host" && !existsSync(path.join(hostPath, "bundles", plugin.id, "ragents-bundle.json")))
    .map((plugin) => plugin.id);

/** The bundles in the archive are built against the server's host API, the built-in ones come from the client's host; both must fit there. */
const assertHostFits = (hostPath: string, description: ClientProfileDescription): void => {
  const localApi = readHostApiVersion(hostPath);
  if (localApi !== description.hostApi) {
    throw new Error(`The server distributes its profile for host API ${description.hostApi}, the host ${hostPath} offers host API ${localApi}.\n${hostAdvice(hostPath, description)}`);
  }
  const missing = missingBuiltIns(hostPath, description);
  if (missing.length === 0) return;
  const rebuild = readHostPackage(hostPath) ? "" : "In the checkout, run pnpm build:plugins first; if the source under plugins/ is missing: ";
  throw new Error(`The profile names built-in plugins for which the host ${hostPath} has no bundle: ${missing.join(", ")}.\n${rebuild}${hostAdvice(hostPath, description)}`);
};

/** Fetches description and archive, checks host API, built-in bundles and version and stores the version in the cache; starts nothing. */
export const prepareProfile = async (options: ConnectOptions): Promise<ConnectedProfile> => {
  const description = await describeProfile(options);
  assertHostFits(options.hostPath ?? hostRoot(), description);
  const layout = remoteLayout(options.dataRoot ?? ragentsDataRoot(), options.serverUrl, description.profile);
  const cacheDirectory = path.join(layout.profiles, description.version);
  const profileFile = path.join(cacheDirectory, ...description.file.split("/"));
  let downloaded = false;
  if (!existsSync(profileFile)) {
    const archive = await downloadArchive(options, description);
    const staging = `${cacheDirectory}.part`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const file = path.join(staging, "profile.tar.gz");
    await writeFile(file, archive);
    const foreign: string[] = [];
    await extractTar({ file, cwd: staging, strict: true, filter: (entryPath, entry) => {
      const type = "type" in entry ? entry.type : undefined;
      if (type === "File" || type === "Directory") return true;
      foreign.push(`${entryPath} (${String(type)})`);
      return false;
    } });
    if (foreign.length > 0) throw new Error(`The archive contains entries that are neither file nor folder: ${foreign.join(", ")}; a client profile carries only files`);
    await rm(file);
    if (!existsSync(path.join(staging, ...description.file.split("/")))) throw new Error(`The archive does not contain the profile file ${description.file}`);
    assertArchivedBundles(staging);
    await markAsModule(staging);
    await rm(cacheDirectory, { recursive: true, force: true });
    await rename(staging, cacheDirectory);
    downloaded = true;
  }
  if (options.clean) {
    for (const entry of await readdir(layout.profiles)) {
      if (entry !== description.version) await rm(path.join(layout.profiles, entry), { recursive: true, force: true });
    }
  }
  await mkdir(layout.data, { recursive: true });
  const cached: CachedProfile = {
    serverUrl: options.serverUrl,
    profile: description.profile,
    version: description.version,
    profileFile,
    dataDirectory: layout.data,
  };
  await writeFile(layout.current, `${JSON.stringify(cached, null, 2)}\n`);
  return { description, profileFile, dataDirectory: layout.data, cacheDirectory, downloaded };
};

/** Starts a host script like the checkout does: Node with the tsx loader, working directory apps/server, without pnpm. */
export const hostScript = (script: string, args: readonly string[] = []): { file: string; args: readonly string[]; cwd: string } => ({
  file: process.execPath,
  args: ["--import", "tsx", path.join(hostRoot(), script), ...args],
  cwd: path.join(hostRoot(), "apps/server"),
});

const run = (
  command: { file: string; args: readonly string[]; cwd: string },
  env: NodeJS.ProcessEnv,
  started?: (pid: number) => void,
): Promise<number> => new Promise((resolve, reject) => {
  const child = spawn(command.file, [...command.args], { cwd: command.cwd, env, stdio: "inherit" });
  if (child.pid) started?.(child.pid);
  const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
  const onInterrupt = forward("SIGINT");
  const onTerminate = forward("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    resolve(code ?? (signal ? 1 : 0));
  });
});

const main = async (): Promise<void> => {
  const arguments_ = parseArguments(process.argv.slice(2));
  const token = process.env.RAGENTS_TOKEN;
  if (!token) throw new Error(`RAGENTS_TOKEN is missing: the personal token from the server profile.\n${usage()}`);
  const prepared = await prepareProfile({ serverUrl: arguments_.serverUrl, token, clean: arguments_.clean });
  const { description } = prepared;
  console.log(`== Profile ${description.profile} from server ${arguments_.serverUrl}, version ${description.version.slice(0, 12)} (${prepared.downloaded ? "fetched" : "in cache"})`);
  console.log(`== Profile file ${prepared.profileFile}`);
  console.log(`== Data ${prepared.dataDirectory}`);
  if (!arguments_.start) return;
  process.exitCode = await startCached({
    serverUrl: arguments_.serverUrl,
    profile: description.profile,
    version: description.version,
    profileFile: prepared.profileFile,
    dataDirectory: prepared.dataDirectory,
  }, arguments_.port);
};

export interface StartedProfile {
  readonly profile: string;
  readonly profileFile: string;
  /** Set only for a fetched version; a host profile takes the defaults of its own configuration. */
  readonly dataDirectory?: string;
  readonly port: number | undefined;
}

/** ragents run and ragents start record the same host in the profile's data folder; a port 0 picks its own port and cannot be recorded. */
export const noteHost = (profile: string, dataDirectory: string, port: number): ((pid: number) => void) | undefined =>
  port > 0 ? (pid: number): void => writeHostRecord(dataDirectory, {
    profile,
    url: `http://localhost:${port}`,
    pid,
    log: path.join(dataDirectory, "logs", "server.log"),
    startedAt: new Date().toISOString(),
  }) : undefined;

/** Provisions the profile's tools and starts the server with them. */
export const startProfile = async (started: StartedProfile): Promise<number> => {
  const target = await readProfileTarget(started.profile, started.profileFile);
  const dataDirectory = started.dataDirectory ?? target.dataDirectory;
  const port = started.port ?? target.port;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PRODUCT_PROFILE: started.profile,
    PRODUCT_PROFILE_FILE: started.profileFile,
    DATA_DIR: dataDirectory,
  };
  console.log("== Provisioning tools");
  const provisioned = await run(hostScript("scripts/provision/run-provision.ts"), env);
  if (provisioned !== 0) throw new Error(`Provisioning ended with code ${provisioned}`);
  console.log(`== Starting server (data ${dataDirectory})`);
  const note = noteHost(started.profile, dataDirectory, port);
  try {
    return await run(hostScript("apps/server/src/main.ts", started.port !== undefined ? ["--port", String(started.port)] : []), env, note);
  } finally {
    if (note) removeHostRecord(dataDirectory);
  }
};

/** Starts a version that connect has fetched; the web app comes from the host as with every profile. */
export const startCached = (cached: CachedProfile, port: number | undefined): Promise<number> => startProfile({
  profile: cached.profile,
  profileFile: cached.profileFile,
  dataDirectory: cached.dataDirectory,
  port,
});

// In the extension's bundle import.meta is empty; then there is no command line entry.
const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
