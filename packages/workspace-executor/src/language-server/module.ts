import { WorkspaceOperationError } from "../errors.js";
import type { WorkspaceExecutorModule, WorkspaceModuleFactory, WorkspaceModuleHost, WorkspaceOperation } from "../module.js";
import { rootsOfFields, type OperationFootprint } from "../paths.js";
import { LanguageServerHost, type LanguageServerAdapter, type LanguageServerHostOptions } from "./host.js";

export const languageServerOpenOperation = (adapterId: string): string => `${adapterId}_open`;

export const languageServerDiagnosticsOperation = (adapterId: string): string => `${adapterId}_diagnostics`;

export const languageServerCloseOperation = (adapterId: string): string => `${adapterId}_close`;

export const languageServerSnapshotOperation = (adapterId: string): string => `${adapterId}_snapshot`;

export const languageServerSolutionsOperation = (adapterId: string): string => `${adapterId}_solutions`;

export const languageServerSwitchOperation = (adapterId: string): string => `${adapterId}_switch`;

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

const settledAll = async (operations: readonly Promise<void>[]): Promise<void> => {
  const results = await Promise.allSettled(operations);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
};

const invalid = (operation: string, message: string): WorkspaceOperationError =>
  new WorkspaceOperationError("language-server-input-invalid", `${operation}: ${message}`, 400);

const fieldsOf = (operation: string, input: unknown): Readonly<Record<string, unknown>> => {
  const fields = input ?? {};
  if (typeof fields !== "object" || Array.isArray(fields)) throw invalid(operation, "The input must be an object");
  return fields as Readonly<Record<string, unknown>>;
};

const optionalRoot = (operation: string, value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw invalid(operation, "root must be a text");
  return value;
};

const solutionOperationsOf = (server: LanguageServerHost): Array<readonly [string, WorkspaceOperation]> => {
  const change = languageServerSwitchOperation(server.adapter.id);
  return [
    [languageServerSolutionsOperation(server.adapter.id), ({ runId }) => server.solutions(runId)],
    [change, ({ runId, input }) => {
      const { root } = fieldsOf(change, input);
      if (root !== null && typeof root !== "string") throw invalid(change, "root must be a text or null");
      return server.switchTo(runId, root);
    }],
  ];
};

const operationsOf = (server: LanguageServerHost): Array<readonly [string, WorkspaceOperation]> => {
  const { id } = server.adapter;
  const open = languageServerOpenOperation(id);
  const close = languageServerCloseOperation(id);
  const diagnostics = languageServerDiagnosticsOperation(id);
  return [
    [open, ({ runId, input }) => {
      const { root, ifNoneOpen } = fieldsOf(open, input);
      const checked = optionalRoot(open, root);
      if (checked === undefined) throw invalid(open, "root is missing");
      if (ifNoneOpen !== undefined && typeof ifNoneOpen !== "boolean") throw invalid(open, "ifNoneOpen must be true or false");
      return server.open(runId, checked, ifNoneOpen ?? false);
    }],
    [close, ({ runId, input }) => server.close(runId, optionalRoot(close, fieldsOf(close, input).root))],
    [diagnostics, ({ runId, input }) => {
      const { paths, warnings, root } = fieldsOf(diagnostics, input);
      if (paths !== undefined && (!Array.isArray(paths) || !paths.every((entry) => typeof entry === "string"))) throw invalid(diagnostics, "paths must be a list of texts");
      if (warnings !== undefined && typeof warnings !== "boolean") throw invalid(diagnostics, "warnings must be true or false");
      return server.diagnostics(runId, paths as readonly string[] | undefined, warnings ?? false, optionalRoot(diagnostics, root));
    }],
    [languageServerSnapshotOperation(id), ({ runId }) => server.snapshot(runId)],
    ...server.adapter.solutionExtensions ? solutionOperationsOf(server) : [],
  ];
};

/** Open and close address the root of their instance, diagnostics also the roots of its files; without root and files no specific one. */
const footprintsOf = (server: LanguageServerHost): Array<readonly [string, (input: unknown) => OperationFootprint]> => {
  const { id } = server.adapter;
  return [
    [languageServerOpenOperation(id), (input) => ({ roots: rootsOfFields(input, "root") })],
    [languageServerCloseOperation(id), (input) => ({ roots: rootsOfFields(input, "root") })],
    [languageServerDiagnosticsOperation(id), (input) => ({ roots: rootsOfFields(input, "root", "paths") })],
  ];
};

/** The language servers of this machine: per adapter open, diagnostics, close and state, with solutions also search and switching, plus the diagnostics of written files. */
export const languageServerModule = (
  adapters: readonly LanguageServerAdapter[],
  options: LanguageServerHostOptions = {},
): WorkspaceModuleFactory => {
  const duplicate = adapters.find((adapter, index) => adapters.findIndex((other) => other.id === adapter.id) !== index);
  if (duplicate) throw new Error(`The language server ${duplicate.id} occurs twice in the executor; its operations belong to exactly one contribution`);
  return (host) => languageServersOn(host, adapters, options);
};

const languageServersOn = (
  host: WorkspaceModuleHost,
  adapters: readonly LanguageServerAdapter[],
  options: LanguageServerHostOptions,
): WorkspaceExecutorModule => {
  const servers = adapters.map((adapter) => new LanguageServerHost(adapter, host.contextFor, options));
  return {
    operations: Object.fromEntries(servers.flatMap(operationsOf)),
    footprints: Object.fromEntries(servers.flatMap(footprintsOf)),
    annotate: async (runId, absolutePath) => {
      const notes = await Promise.all(servers.map((server) =>
        server.annotate(runId, absolutePath).catch((error: unknown) =>
          `Diagnostics (${server.adapter.label}) failed: ${messageOf(error)}`)));
      const text = notes.filter((note): note is string => Boolean(note)).join("\n");
      return text || undefined;
    },
    stopRun: (runId) => settledAll(servers.map((server) => server.stopSession(runId))),
    shutdown: () => settledAll(servers.map((server) => server.shutdown())),
  };
};
