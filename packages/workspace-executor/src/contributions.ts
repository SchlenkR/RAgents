import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WorkspaceOperationError } from "./errors.js";
import type { LanguageServerAdapter } from "./language-server/host.js";
import { resolveRootDirectory, resolveRootFile } from "./language-server/roots.js";
import type { WorkspaceModuleFactory } from "./module.js";
import { RUN_MARKER_ENV } from "./run-marker.js";
import { safeProcessEnvironment } from "./safe-environment.js";

/** Wo ein Bundle seinen Beitrag zum Executor trägt: eine in sich geschlossene Datei, die jeder Node-Prozess ohne Host-Auflösung lädt. */
export const EXECUTOR_CONTRIBUTION_FILE = "executor/index.mjs";

/** Was der Executor einer Maschine einem Beitrag über sie sagt; ein Beitrag importiert vom Host nur Typen, alles andere kommt hierüber. */
export interface WorkspaceExecutorMachine {
  /** Der Werkzeugordner des Plugins auf dieser Maschine, wohin seine Provisionierung lädt. */
  readonly toolsDirectory: string;
  /** Eine Datei aus einem Paket in den node_modules des Hosts dieser Maschine; ohne Host oder Paket scheitert der Aufruf mit Ursache. */
  readonly hostPackageFile: (hostRoot: string | undefined, specifier: string) => string;
  /** Eine Datei mit einer der Endungen im Arbeitsbereich, aufgelöst und geprüft. */
  readonly resolveRootFile: (workspaceRoot: string, requested: string, extensions: readonly string[]) => Promise<string>;
  /** Ein Ordner im Arbeitsbereich, aufgelöst und geprüft. */
  readonly resolveRootDirectory: (workspaceRoot: string, requested: string) => Promise<string>;
  /** Ein fachlicher Fehler einer Operation mit Kennung und Status; beim Aufrufer kommt er als derselbe Fehler an wie einer des Executors. */
  readonly operationError: (code: string, message: string, status: number) => Error;
  /** Die Umgebung eines Prozesses, den ein Beitrag selbst startet: die sichere Auswahl dieser Maschine, ihr HOME und der Marker des Runs für die Prozessanzeige. */
  readonly processEnvironment: (runId: string) => NodeJS.ProcessEnv;
}

/** Was ein Beitrag dem Executor einer Maschine hinzufügt. */
export interface WorkspaceExecutorParts {
  readonly languageServers?: readonly LanguageServerAdapter[];
  /** Module mit eigenen Operationen; jede Operation gehört genau einem Modul. */
  readonly modules?: readonly WorkspaceModuleFactory[];
}

/** Was ein Plugin-Bundle als `executor` exportiert; es läuft in jedem Executor, im Server wie auf jedem Arbeitsplatz, und berührt beim Bauen weder Platte noch Netz. */
export type WorkspaceExecutorContribution = (machine: WorkspaceExecutorMachine) => WorkspaceExecutorParts;

/** Wessen Beitrag in welchem Stand; Server und Arbeitsplatz verlangen dieselben. */
export interface ExecutorContributionStand {
  readonly plugin: string;
  /** SHA-256 der Datei des Beitrags. */
  readonly stand: string;
}

export interface LoadedExecutorContribution extends ExecutorContributionStand {
  readonly contribution: WorkspaceExecutorContribution;
}

/** Ein Beitrag, gebaut für diese Maschine. */
export interface PreparedExecutorContribution extends ExecutorContributionStand {
  readonly parts: WorkspaceExecutorParts;
}

const LANGUAGE_SERVER_ID = /^[a-z][a-z0-9]{0,39}$/;
const PART_KEYS = new Set(["languageServers", "modules"]);

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** Der Paketname eines Bezeichners wie acme-server/lib/cli.mjs oder @scope/name/datei. */
const packageOf = (specifier: string): string =>
  specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");

const hostPackageFile = (hostRoot: string | undefined, specifier: string): string => {
  if (!hostRoot) {
    throw new Error(`Auf diesem Rechner ist kein Host bekannt, aus dem sich ${packageOf(specifier)} auflösen ließe. Ein Arbeitsplatz `
      + "bekommt ihn mit der ersten Verbindung zu einem verteilenden Server oder über die Einstellung ragents.hostPath");
  }
  try {
    return createRequire(path.join(hostRoot, "package.json")).resolve(specifier);
  } catch (cause) {
    throw new Error(`${packageOf(specifier)} liegt nicht im Host ${hostRoot}: ${messageOf(cause)}`);
  }
};

export const executorMachine = (toolsDirectory: string): WorkspaceExecutorMachine => ({
  toolsDirectory,
  hostPackageFile,
  resolveRootFile,
  resolveRootDirectory,
  operationError: (code, message, status) => new WorkspaceOperationError(code, message, status),
  processEnvironment: (runId) => ({ ...safeProcessEnvironment(process.env), HOME: homedir(), [RUN_MARKER_ENV]: runId }),
});

/** Lädt die Datei eines Beitrags, mit `expected` nur in diesem Stand; der Stand steht in ihrer Adresse, damit ein neu gebauter Beitrag nie aus dem Modulcache kommt. */
export const loadExecutorContribution = async (plugin: string, file: string, expected?: string): Promise<LoadedExecutorContribution> => {
  const content = await readFile(file).catch((cause: unknown) => {
    throw new Error(`Der Executor-Beitrag von ${plugin} fehlt unter ${file}: ${messageOf(cause)}`);
  });
  const stand = createHash("sha256").update(content).digest("hex");
  if (expected !== undefined && stand !== expected) {
    throw new Error(`Der Executor-Beitrag von ${plugin} unter ${file} hat den Stand ${stand.slice(0, 12)}, verlangt ist ${expected.slice(0, 12)}`);
  }
  const exported = await import(`${pathToFileURL(file).href}?stand=${stand}`).catch((cause: unknown) => {
    throw new Error(`Der Executor-Beitrag von ${plugin} (${file}) lädt nicht: ${messageOf(cause)}`, { cause });
  }) as Readonly<Record<string, unknown>>;
  const contribution = exported.executor;
  if (typeof contribution !== "function") {
    throw new Error(`Das Bundle ${plugin} exportiert in ${file} keinen gültigen Executor-Beitrag; erwartet wird `
      + "\"export const executor: WorkspaceExecutorContribution\" als Funktion der Maschine");
  }
  return { plugin, stand, contribution: contribution as WorkspaceExecutorContribution };
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/** Was an einem Sprachserver fehlt oder die falsche Form hat; leer, wenn er taugt. */
const adapterProblems = (value: Readonly<Record<string, unknown>>): readonly string[] => [
  ...typeof value.id === "string" && LANGUAGE_SERVER_ID.test(value.id) ? [] : ["id aus Kleinbuchstaben und Ziffern"],
  ...typeof value.label === "string" ? [] : ["label"],
  ...isRecord(value.languages) && Object.values(value.languages).every((entry) => typeof entry === "string") ? [] : ["languages"],
  ...typeof value.rootDescription === "string" ? [] : ["rootDescription"],
  ...value.solutionExtensions === undefined || isStringList(value.solutionExtensions) ? [] : ["solutionExtensions"],
  ...(["resolveRoot", "rootDirectory", "launch", "open"] as const).filter((name) => typeof value[name] !== "function"),
];

/** Baut einen geladenen Beitrag für diese Maschine und prüft, was er liefert; eine falsche Form ist ein Fehler mit Ursache. */
export const prepareExecutorContribution = (loaded: LoadedExecutorContribution, toolsDirectory: string): PreparedExecutorContribution => {
  const invalid = (detail: string): Error => new Error(`Der Executor-Beitrag von ${loaded.plugin} ist ungültig: ${detail}`);
  const parts = ((): unknown => {
    try {
      return loaded.contribution(executorMachine(toolsDirectory));
    } catch (cause) {
      throw invalid(`die Funktion wirft: ${messageOf(cause)}`);
    }
  })();
  if (!isRecord(parts)) throw invalid("die Funktion liefert kein Objekt");
  const unknown = Object.keys(parts).filter((key) => !PART_KEYS.has(key));
  if (unknown.length > 0) throw invalid(`unbekannte Teile ${unknown.join(", ")}; erlaubt sind ${[...PART_KEYS].join(", ")}`);
  const modules = parts.modules;
  if (modules !== undefined && (!Array.isArray(modules) || !modules.every((module) => typeof module === "function"))) {
    throw invalid("modules ist keine Liste von Modulfabriken");
  }
  const servers = parts.languageServers;
  if (servers !== undefined && !Array.isArray(servers)) throw invalid("languageServers ist keine Liste");
  for (const [index, server] of (servers ?? []).entries()) {
    if (!isRecord(server)) throw invalid(`der Sprachserver ${index + 1} ist kein Objekt`);
    const problems = adapterProblems(server);
    if (problems.length > 0) throw invalid(`der Sprachserver ${index + 1} braucht ${problems.join(", ")}`);
  }
  return { plugin: loaded.plugin, stand: loaded.stand, parts: parts as WorkspaceExecutorParts };
};
