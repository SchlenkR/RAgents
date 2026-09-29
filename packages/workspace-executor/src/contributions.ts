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

/** Where a bundle carries its contribution to the executor: a self-contained file that every Node process loads without host resolution. */
export const EXECUTOR_CONTRIBUTION_FILE = "executor/index.mjs";

/** What the executor of a machine tells a contribution about it; a contribution imports only types from the host, everything else comes through here. */
export interface WorkspaceExecutorMachine {
  /** The tools folder of the plugin on this machine, where its provisioning downloads to. */
  readonly toolsDirectory: string;
  /** A file from a package in the node_modules of the host of this machine; without a host or package the call fails with a cause. */
  readonly hostPackageFile: (hostRoot: string | undefined, specifier: string) => string;
  /** A file with one of the extensions in the workspace, resolved and checked. */
  readonly resolveRootFile: (workspaceRoot: string, requested: string, extensions: readonly string[]) => Promise<string>;
  /** A folder in the workspace, resolved and checked. */
  readonly resolveRootDirectory: (workspaceRoot: string, requested: string) => Promise<string>;
  /** A domain error of an operation with code and status; it reaches the caller as the same error as one of the executor. */
  readonly operationError: (code: string, message: string, status: number) => Error;
  /** The environment of a process that a contribution starts itself: the safe selection of this machine, its HOME and the marker of the run for the process view. */
  readonly processEnvironment: (runId: string) => NodeJS.ProcessEnv;
}

/** What a contribution adds to the executor of a machine. */
export interface WorkspaceExecutorParts {
  readonly languageServers?: readonly LanguageServerAdapter[];
  /** Modules with their own operations; every operation belongs to exactly one module. */
  readonly modules?: readonly WorkspaceModuleFactory[];
}

/** What a plugin bundle exports as `executor`; it runs in every executor, in the server as on every workspace, and touches neither disk nor network while building. */
export type WorkspaceExecutorContribution = (machine: WorkspaceExecutorMachine) => WorkspaceExecutorParts;

/** Whose contribution in which version; server and workspace require the same ones. */
export interface ExecutorContributionStand {
  readonly plugin: string;
  /** SHA-256 of the file of the contribution. */
  readonly stand: string;
}

export interface LoadedExecutorContribution extends ExecutorContributionStand {
  readonly contribution: WorkspaceExecutorContribution;
}

/** A contribution built for this machine. */
export interface PreparedExecutorContribution extends ExecutorContributionStand {
  readonly parts: WorkspaceExecutorParts;
}

const LANGUAGE_SERVER_ID = /^[a-z][a-z0-9]{0,39}$/;
const PART_KEYS = new Set(["languageServers", "modules"]);

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** The package name of a specifier like acme-server/lib/cli.mjs or @scope/name/file. */
const packageOf = (specifier: string): string =>
  specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");

const hostPackageFile = (hostRoot: string | undefined, specifier: string): string => {
  if (!hostRoot) {
    throw new Error(`No host is known on this machine from which ${packageOf(specifier)} could be resolved. A workspace `
      + "gets it with the first connection to a distributing server or through the setting ragents.hostPath");
  }
  try {
    return createRequire(path.join(hostRoot, "package.json")).resolve(specifier);
  } catch (cause) {
    throw new Error(`${packageOf(specifier)} is not in the host ${hostRoot}: ${messageOf(cause)}`);
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

/** Loads the file of a contribution, with `expected` only in that version; the version is part of its address so that a newly built contribution never comes from the module cache. */
export const loadExecutorContribution = async (plugin: string, file: string, expected?: string): Promise<LoadedExecutorContribution> => {
  const content = await readFile(file).catch((cause: unknown) => {
    throw new Error(`The executor contribution of ${plugin} is missing at ${file}: ${messageOf(cause)}`);
  });
  const stand = createHash("sha256").update(content).digest("hex");
  if (expected !== undefined && stand !== expected) {
    throw new Error(`The executor contribution of ${plugin} at ${file} has the version ${stand.slice(0, 12)}, required is ${expected.slice(0, 12)}`);
  }
  const exported = await import(`${pathToFileURL(file).href}?stand=${stand}`).catch((cause: unknown) => {
    throw new Error(`The executor contribution of ${plugin} (${file}) does not load: ${messageOf(cause)}`, { cause });
  }) as Readonly<Record<string, unknown>>;
  const contribution = exported.executor;
  if (typeof contribution !== "function") {
    throw new Error(`The bundle ${plugin} exports no valid executor contribution in ${file}; expected is `
      + "\"export const executor: WorkspaceExecutorContribution\" as a function of the machine");
  }
  return { plugin, stand, contribution: contribution as WorkspaceExecutorContribution };
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/** What is missing from a language server or has the wrong shape; empty if it is usable. */
const adapterProblems = (value: Readonly<Record<string, unknown>>): readonly string[] => [
  ...typeof value.id === "string" && LANGUAGE_SERVER_ID.test(value.id) ? [] : ["id of lowercase letters and digits"],
  ...typeof value.label === "string" ? [] : ["label"],
  ...isRecord(value.languages) && Object.values(value.languages).every((entry) => typeof entry === "string") ? [] : ["languages"],
  ...typeof value.rootDescription === "string" ? [] : ["rootDescription"],
  ...value.solutionExtensions === undefined || isStringList(value.solutionExtensions) ? [] : ["solutionExtensions"],
  ...(["resolveRoot", "rootDirectory", "launch", "open"] as const).filter((name) => typeof value[name] !== "function"),
];

/** Builds a loaded contribution for this machine and checks what it returns; a wrong shape is an error with a cause. */
export const prepareExecutorContribution = (loaded: LoadedExecutorContribution, toolsDirectory: string): PreparedExecutorContribution => {
  const invalid = (detail: string): Error => new Error(`The executor contribution of ${loaded.plugin} is invalid: ${detail}`);
  const parts = ((): unknown => {
    try {
      return loaded.contribution(executorMachine(toolsDirectory));
    } catch (cause) {
      throw invalid(`the function throws: ${messageOf(cause)}`);
    }
  })();
  if (!isRecord(parts)) throw invalid("the function returns no object");
  const unknown = Object.keys(parts).filter((key) => !PART_KEYS.has(key));
  if (unknown.length > 0) throw invalid(`unknown parts ${unknown.join(", ")}; allowed are ${[...PART_KEYS].join(", ")}`);
  const modules = parts.modules;
  if (modules !== undefined && (!Array.isArray(modules) || !modules.every((module) => typeof module === "function"))) {
    throw invalid("modules is not a list of module factories");
  }
  const servers = parts.languageServers;
  if (servers !== undefined && !Array.isArray(servers)) throw invalid("languageServers is not a list");
  for (const [index, server] of (servers ?? []).entries()) {
    if (!isRecord(server)) throw invalid(`the language server ${index + 1} is not an object`);
    const problems = adapterProblems(server);
    if (problems.length > 0) throw invalid(`the language server ${index + 1} needs ${problems.join(", ")}`);
  }
  return { plugin: loaded.plugin, stand: loaded.stand, parts: parts as WorkspaceExecutorParts };
};
