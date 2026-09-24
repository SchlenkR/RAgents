import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";
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
  startTimeoutMs?: number;
}

const START_TIMEOUT_MS = 180_000;
const STOP_TIMEOUT_MS = 10_000;
const KEPT_LINES = 30;
const DRAIN_TIMEOUT_MS = 1_000;

/** Die Umgebung der Erweiterung ohne die Variablen des umgebenden VS Code, damit Kindprozesse sich nicht daran hängen. */
export const inheritedEnvironment = (): Record<string, string> => Object.fromEntries(Object.entries(process.env)
  .filter(([name, value]) => typeof value === "string" && !name.startsWith("VSCODE_") && !name.startsWith("ELECTRON_"))
  .map(([name, value]) => [name, value as string]));

/** Sucht ein Programm im PATH; unter Windows mit den Endungen aus PATHEXT. */
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

/** Der Host aus Paket oder Checkout: Node mit dem tsx-Loader in apps/server, auf einem freien Port mit Ansage. */
export const hostCommand = (hostPath: string, environment: NodeJS.ProcessEnv = process.env): HostCommand => {
  const node = findExecutable("node", environment);
  if (!node) throw new Error("node wurde im PATH nicht gefunden; der lokale Host braucht Node 22");
  return { file: node, args: ["--import", "tsx", "src/main.ts", "--port", "0"], cwd: path.join(hostPath, "apps/server") };
};

/** Wartet, bis die Ausgabeströme zu Ende gelesen sind; die letzte Zeile kommt oft erst nach dem Ende des Prozesses.
 * Hält ein Enkelprozess einen Strom offen, wartet das Ergebnis nicht auf ihn. */
const drained = (readers: readonly Interface[]): Promise<unknown> => Promise.race([
  Promise.all(readers.map((reader) => new Promise<void>((settle) => reader.once("close", () => settle())))),
  new Promise<void>((settle) => setTimeout(settle, DRAIN_TIMEOUT_MS).unref()),
]);

/** Ein Fehlschlag, der den Befund eines Kindprozesses über eine fehlende Umgebungsvariable mitnimmt. */
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
      code === 0 ? resolve() : reject(failure(`${path.basename(file)} ${args.join(" ")} endete mit Code ${code}`, missing))));
  });

/** Provisioniert die Werkzeuge eines Profils oder mit --workspace die dieses Arbeitsplatzes, wie pnpm provision. */
export const provisionTools = (hostPath: string, selection: string, environment: NodeJS.ProcessEnv, log: (line: string) => void): Promise<void> => {
  const node = findExecutable("node", environment);
  if (!node) throw new Error("node wurde im PATH nicht gefunden; die Werkzeuge lassen sich nicht provisionieren");
  return run(node, ["--import", "tsx", "../../scripts/provision/run-provision.ts", selection], path.join(hostPath, "apps/server"), environment, log);
};

export const HOST_PACKAGE_NAME = "@schlenkr/ragents";

/** Die Paketfassung, die zu dieser Erweiterung gehört; der Build der Erweiterung trägt sie in ihre package.json ein. */
export const packagedHostVersion = (extensionPath: string): string => {
  const file = path.join(extensionPath, "package.json");
  const version = (JSON.parse(readFileSync(file, "utf8")) as { ragents?: { packageVersion?: unknown } }).ragents?.packageVersion;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`${file}: ragents.packageVersion nennt die Fassung von ${HOST_PACKAGE_NAME}, die zu dieser Erweiterung gehört`);
  }
  return version;
};

/** Was npm installiert: das veröffentlichte Paket; RAGENTS_HOST_PACKAGE_SPEC setzt für Tests eine lokale .tgz an dessen Stelle. */
export const hostPackageSpecifier = (version: string, environment: NodeJS.ProcessEnv = process.env): string =>
  environment.RAGENTS_HOST_PACKAGE_SPEC?.trim() || `${HOST_PACKAGE_NAME}@${version}`;

/** Je Fassung ein eigener Ordner im Speicher der Erweiterung; geholte Fassungen bleiben liegen. */
export const hostPackageFolder = (storage: string, version: string): string => path.join(storage, "hosts", version);

const installedHostRoot = (folder: string): string => path.join(folder, "node_modules", ...HOST_PACKAGE_NAME.split("/"));

/** Holt den Host als npm-Paket in einen eigenen Ordner und gibt dessen Wurzel zurück. */
export const installHostPackage = async (folder: string, specifier: string, environment: NodeJS.ProcessEnv, log: (line: string) => void): Promise<string> => {
  const npm = findExecutable("npm", environment);
  if (!npm) {
    throw new Error("npm wurde im PATH nicht gefunden; ohne npm kann die Erweiterung den Host nicht holen. "
      + "Installiere Node 22 samt npm oder setze ragents.hostPath auf einen Checkout oder ein installiertes Paket.");
  }
  await mkdir(folder, { recursive: true });
  await run(npm, ["install", "--prefix", folder, specifier], folder, environment, log);
  const root = installedHostRoot(folder);
  if (!isHostRoot(root)) throw new Error(`${specifier} hat keinen RAgents-Host in ${root} hinterlassen`);
  return root;
};

/** Der Host einer Fassung: der schon geholte Ordner, sonst eine Installation von npm. */
export const ensureHostPackage = async (storage: string, version: string, environment: NodeJS.ProcessEnv, log: (line: string) => void): Promise<string> => {
  const folder = hostPackageFolder(storage, version);
  const installed = installedHostRoot(folder);
  if (isHostRoot(installed)) return installed;
  const specifier = hostPackageSpecifier(version, environment);
  log(`== Host-Paket ${specifier} nach ${folder} holen`);
  return installHostPackage(folder, specifier, environment, log);
};

const terminate = (child: ChildProcess): void => {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
};

/** Startet den Host und wartet auf seine Ansage {"ragents":{"url","token","pid"}} auf stdout. */
export const startHost = (options: HostStartOptions): Promise<RunningHost> => new Promise((resolve, reject) => {
  const environment: NodeJS.ProcessEnv = {
    ...options.environment,
    PRODUCT_PROFILE: options.profile,
    PRODUCT_PROFILE_FILE: options.profileFile,
    DATA_DIR: options.dataDirectory,
    // Der lokale Host ist der Arbeitsplatz des Entwicklers: dort bleibt es seine eigene Bash.
    PROCESS_SANDBOX: options.environment.PROCESS_SANDBOX ?? "off",
    // Der Host überwacht diesen Prozess und beendet sich, wenn ihn ein Reload oder Absturz von VS Code mitnimmt.
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
  const timer = setTimeout(() => fail(`Der Host hat sich nach ${Math.round((options.startTimeoutMs ?? START_TIMEOUT_MS) / 1000)} Sekunden nicht gemeldet`), options.startTimeoutMs ?? START_TIMEOUT_MS);
  child.once("error", (cause) => { clearTimeout(timer); fail(`Der Host konnte nicht gestartet werden: ${cause.message}`); });
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
    void output.then(() => fail(`Der Host endete vor seiner Ansage mit Code ${code}`));
  });
});
