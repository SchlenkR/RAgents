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
import { BUNDLE_MANIFEST_FILE, bundleStand } from "../../apps/server/src/profile/bundle-manifest.ts";
import { readProfileTarget } from "../../apps/server/src/profile-target.ts";
import { RpcClient } from "../../apps/web/src/rpc/client.ts";
import { profileDistributionContracts, type ClientProfileDescription } from "../../plugins/ragents.profile-distribution/contract.ts";

const usage = (): string => `Verwendung: RAGENTS_TOKEN=<token> ragents connect <server-url> [--port <n>] [--clean] [--no-start]
Holt das Client-Profil des Servers samt seinen Bundles in den lokalen Cache, prüft die Host-API
gegen diesen Host und startet den lokalen Server mit dem Profil und dem Web dieses Hosts. --clean
entfernt ältere Stände, --no-start endet nach dem Holen und nennt Profildatei und Datenordner. Im
Checkout heißt der Befehl pnpm connect.`;

export interface ConnectOptions {
  readonly serverUrl: string;
  readonly token: string;
  readonly dataRoot?: string;
  /** Der Host, dessen Host-API und eingebaute Bundles zum Profil passen müssen: Checkout oder Paket; Vorgabe ist dieser hier. */
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

/** Der Stand, den ragents start ohne den Server wieder hochfährt. */
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
      if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error(`--port braucht eine ganze Zahl von 0 bis 65535, nicht ${argv[index + 1]}`);
      port = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-") || serverUrl) throw new Error(`Unbekanntes Argument: ${argument}\n${usage()}`);
    serverUrl = argument;
  }
  if (!serverUrl) throw new Error(`Die Serveradresse fehlt.\n${usage()}`);
  return { serverUrl, port, clean, start };
};

/** Ein Ordnername je Server: Hostname und Port, damit zwei Server nie denselben Cache teilen. */
export const serverFolderName = (serverUrl: string): string => {
  const parsed = new URL(serverUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`Die Serveradresse braucht http oder https: ${serverUrl}`);
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
    throw new Error(`Der Server ${baseUrl} liefert kein Client-Profil: ${error instanceof Error ? error.message : String(error)}`);
  });
  return checkedDescription(baseUrl, description);
};

/** Stand, Profil und Datei werden Pfade im Cache; nur, was dort nicht herausführen kann, wird angenommen. */
const checkedDescription = (baseUrl: string, description: ClientProfileDescription): ClientProfileDescription => {
  const rejected = (field: string, value: string): Error =>
    new Error(`Der Server ${baseUrl} nennt ein ungültiges Client-Profil: ${field} ${JSON.stringify(value)}`);
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
  if (!response.ok) throw new Error(`Das Archiv ${address} kommt nicht an: ${response.status} ${(await response.text()).slice(0, 200)}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== description.version) throw new Error(`Das Archiv ${address} passt nicht zum angesagten Stand: erwartet ${description.version}, erhalten ${digest}`);
  if (archive.byteLength !== description.size) throw new Error(`Das Archiv ${address} hat ${archive.byteLength} Byte, angesagt sind ${description.size}`);
  return archive;
};

/** Die Profildatei ist ESM; ohne diese Marke liest Node sie im Cache als CommonJS. Bundles lädt der Haken des Hosts ohnehin als ESM. */
const markAsModule = async (directory: string): Promise<void> => {
  const file = path.join(directory, "package.json");
  if (!existsSync(file)) {
    await writeFile(file, `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
    return;
  }
  const declared = (JSON.parse(await readFile(file, "utf8")) as { type?: unknown }).type;
  if (declared !== "module") throw new Error(`Das Archiv bringt eine package.json mit type ${JSON.stringify(declared)}; RAgents-Profile sind ESM`);
};

/** Jedes Bundle im Archiv muss genau die Dateien tragen, mit denen es gebaut wurde; ein verlustbehaftetes Packen fiele sonst erst beim Laden auf. */
const assertArchivedBundles = (staging: string): void => {
  for (const manifestFile of filesBelow(staging).filter((file) => path.posix.basename(file) === BUNDLE_MANIFEST_FILE)) {
    const folder = path.join(staging, ...path.posix.dirname(manifestFile).split("/"));
    const manifest = JSON.parse(readFileSync(path.join(folder, BUNDLE_MANIFEST_FILE), "utf8")) as { id?: unknown; stand?: unknown };
    if (bundleStand(folder) !== manifest.stand) {
      throw new Error(`Das Bundle ${String(manifest.id)} im Archiv des Servers hat nicht die Dateien, mit denen es gebaut wurde (stand in ${manifestFile}); auf dem Server neu bauen und ragents connect wiederholen`);
    }
  }
};

/** Wie ein Host zum Stand des Servers kommt, hängt daran, woher er stammt: Paket oder Checkout. */
const hostAdvice = (hostPath: string, description: ClientProfileDescription): string => {
  const packaged = readHostPackage(hostPath);
  return packaged
    ? `Hol die Fassung des Servers: npm install -g ${packaged.name}@${description.packageVersion} (installiert ist ${packaged.version}).`
    : `Wechsle auf den Commit des Servers: git -C ${JSON.stringify(hostPath)} fetch && git -C ${JSON.stringify(hostPath)} checkout ${description.hostVersion}, danach pnpm build:plugins und pnpm build:web.`;
};

/** Die eingebauten Plugins des Profils, für die der Host kein Bundle hat; ohne sie startet das Profil nicht. */
const missingBuiltIns = (hostPath: string, description: ClientProfileDescription): readonly string[] =>
  description.plugins
    .filter((plugin) => plugin.source === "host" && !existsSync(path.join(hostPath, "bundles", plugin.id, "ragents-bundle.json")))
    .map((plugin) => plugin.id);

/** Die Bundles im Archiv sind gegen die Host-API des Servers gebaut, die eingebauten kommen vom Host des Clients; beides muss dort passen. */
const assertHostFits = (hostPath: string, description: ClientProfileDescription): void => {
  const localApi = readHostApiVersion(hostPath);
  if (localApi !== description.hostApi) {
    throw new Error(`Der Server verteilt sein Profil für Host-API ${description.hostApi}, der Host ${hostPath} bietet Host-API ${localApi}.\n${hostAdvice(hostPath, description)}`);
  }
  const missing = missingBuiltIns(hostPath, description);
  if (missing.length === 0) return;
  const rebuild = readHostPackage(hostPath) ? "" : "Im Checkout zuerst pnpm build:plugins; fehlt die Quelle unter plugins/: ";
  throw new Error(`Das Profil nennt eingebaute Plugins, für die der Host ${hostPath} kein Bundle hat: ${missing.join(", ")}.\n${rebuild}${hostAdvice(hostPath, description)}`);
};

/** Holt Beschreibung und Archiv, prüft Host-API, eingebaute Bundles und Stand und legt den Stand im Cache ab; startet nichts. */
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
    if (foreign.length > 0) throw new Error(`Das Archiv enthält Einträge, die weder Datei noch Ordner sind: ${foreign.join(", ")}; ein Client-Profil trägt nur Dateien`);
    await rm(file);
    if (!existsSync(path.join(staging, ...description.file.split("/")))) throw new Error(`Das Archiv enthält die Profildatei ${description.file} nicht`);
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

/** Startet ein Host-Skript wie der Checkout: Node mit dem tsx-Loader, Arbeitsverzeichnis apps/server, ohne pnpm. */
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
  if (!token) throw new Error(`RAGENTS_TOKEN fehlt: der persönliche Token aus dem Serverprofil.\n${usage()}`);
  const prepared = await prepareProfile({ serverUrl: arguments_.serverUrl, token, clean: arguments_.clean });
  const { description } = prepared;
  console.log(`== Profil ${description.profile} vom Server ${arguments_.serverUrl}, Stand ${description.version.slice(0, 12)} (${prepared.downloaded ? "geholt" : "im Cache"})`);
  console.log(`== Profildatei ${prepared.profileFile}`);
  console.log(`== Daten ${prepared.dataDirectory}`);
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
  /** Nur bei einem geholten Stand gesetzt; ein Profil des Hosts nimmt die Vorgaben seiner eigenen Konfiguration. */
  readonly dataDirectory?: string;
  readonly port: number | undefined;
}

/** ragents run und ragents start merken denselben Host im Datenordner des Profils; ein Port 0 sucht sich seinen Port selbst und lässt sich nicht merken. */
export const noteHost = (profile: string, dataDirectory: string, port: number): ((pid: number) => void) | undefined =>
  port > 0 ? (pid: number): void => writeHostRecord(dataDirectory, {
    profile,
    url: `http://localhost:${port}`,
    pid,
    log: path.join(dataDirectory, "logs", "server.log"),
    startedAt: new Date().toISOString(),
  }) : undefined;

/** Provisioniert die Werkzeuge des Profils und startet den Server damit. */
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
  console.log("== Werkzeuge provisionieren");
  const provisioned = await run(hostScript("scripts/provision/run-provision.ts"), env);
  if (provisioned !== 0) throw new Error(`Die Provisionierung endete mit Code ${provisioned}`);
  console.log(`== Server starten (Daten ${dataDirectory})`);
  const note = noteHost(started.profile, dataDirectory, port);
  try {
    return await run(hostScript("apps/server/src/main.ts", started.port !== undefined ? ["--port", String(started.port)] : []), env, note);
  } finally {
    if (note) removeHostRecord(dataDirectory);
  }
};

/** Startet einen Stand, den connect geholt hat; das Web kommt wie bei jedem Profil vom Host. */
export const startCached = (cached: CachedProfile, port: number | undefined): Promise<number> => startProfile({
  profile: cached.profile,
  profileFile: cached.profileFile,
  dataDirectory: cached.dataDirectory,
  port,
});

// Im Bundle der Erweiterung ist import.meta leer; dann gibt es keinen Kommandozeileneinstieg.
const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
