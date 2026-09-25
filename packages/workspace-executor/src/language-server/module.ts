import { WorkspaceOperationError } from "../errors.js";
import type { WorkspaceModuleFactory, WorkspaceOperation } from "../module.js";
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
  if (typeof fields !== "object" || Array.isArray(fields)) throw invalid(operation, "Die Eingabe muss ein Objekt sein");
  return fields as Readonly<Record<string, unknown>>;
};

const optionalRoot = (operation: string, value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw invalid(operation, "root muss ein Text sein");
  return value;
};

const solutionOperationsOf = (server: LanguageServerHost): Array<readonly [string, WorkspaceOperation]> => {
  const change = languageServerSwitchOperation(server.adapter.id);
  return [
    [languageServerSolutionsOperation(server.adapter.id), ({ runId }) => server.solutions(runId)],
    [change, ({ runId, input }) => {
      const { root } = fieldsOf(change, input);
      if (root !== null && typeof root !== "string") throw invalid(change, "root muss ein Text oder null sein");
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
      if (checked === undefined) throw invalid(open, "root fehlt");
      if (ifNoneOpen !== undefined && typeof ifNoneOpen !== "boolean") throw invalid(open, "ifNoneOpen muss true oder false sein");
      return server.open(runId, checked, ifNoneOpen ?? false);
    }],
    [close, ({ runId, input }) => server.close(runId, optionalRoot(close, fieldsOf(close, input).root))],
    [diagnostics, ({ runId, input }) => {
      const { paths, warnings, root } = fieldsOf(diagnostics, input);
      if (paths !== undefined && (!Array.isArray(paths) || !paths.every((entry) => typeof entry === "string"))) throw invalid(diagnostics, "paths muss eine Liste von Texten sein");
      if (warnings !== undefined && typeof warnings !== "boolean") throw invalid(diagnostics, "warnings muss true oder false sein");
      return server.diagnostics(runId, paths as readonly string[] | undefined, warnings ?? false, optionalRoot(diagnostics, root));
    }],
    [languageServerSnapshotOperation(id), ({ runId }) => server.snapshot(runId)],
    ...server.adapter.solutionExtensions ? solutionOperationsOf(server) : [],
  ];
};

/** Öffnen und Schließen sprechen die Wurzel ihrer Instanz an, die Diagnostik dazu die ihrer Dateien; ohne Wurzel und Dateien keine bestimmte. */
const footprintsOf = (server: LanguageServerHost): Array<readonly [string, (input: unknown) => OperationFootprint]> => {
  const { id } = server.adapter;
  return [
    [languageServerOpenOperation(id), (input) => ({ roots: rootsOfFields(input, "root") })],
    [languageServerCloseOperation(id), (input) => ({ roots: rootsOfFields(input, "root") })],
    [languageServerDiagnosticsOperation(id), (input) => ({ roots: rootsOfFields(input, "root", "paths") })],
  ];
};

/** Die Sprachserver dieser Maschine: je Adapter Öffnen, Diagnostik, Schließen und Stand, mit Solutions auch Suche und Umschalten, dazu die Diagnostik geschriebener Dateien. */
export const languageServerModule = (
  adapters: readonly LanguageServerAdapter[],
  options: LanguageServerHostOptions = {},
): WorkspaceModuleFactory => (host) => {
  const servers = adapters.map((adapter) => new LanguageServerHost(adapter, host.contextFor, options));
  return {
    operations: Object.fromEntries(servers.flatMap(operationsOf)),
    footprints: Object.fromEntries(servers.flatMap(footprintsOf)),
    annotate: async (runId, absolutePath) => {
      const notes = await Promise.all(servers.map((server) =>
        server.annotate(runId, absolutePath).catch((error: unknown) =>
          `Diagnostik (${server.adapter.label}) fehlgeschlagen: ${messageOf(error)}`)));
      const text = notes.filter((note): note is string => Boolean(note)).join("\n");
      return text || undefined;
    },
    stopRun: (runId) => settledAll(servers.map((server) => server.stopSession(runId))),
    shutdown: () => settledAll(servers.map((server) => server.shutdown())),
  };
};
