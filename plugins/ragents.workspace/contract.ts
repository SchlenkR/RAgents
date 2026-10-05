import { Type } from "typebox";
import { openJson } from "@ragents/engine/src/http/contracts";
import { defineChannel, defineOperation } from "@ragents/engine/src/rpc/contract";

export const WORKSPACE_PLUGIN_ID = "ragents.workspace";

export const WORKSPACE_SANDBOX_OPTION_ID = "ragents.workspace.sandbox";

export const BROWSE_ROOTS = ["workspace", "files"] as const;
export type BrowseRoot = typeof BROWSE_ROOTS[number];

export interface BrowseEntry {
  name: string;
  kind: "directory" | "file";
  size: number;
  modifiedAt: string;
}

export interface BrowseListing {
  root: BrowseRoot;
  /** Where the root is; on a workstation with its label. */
  location: string;
  path: string;
  entries: BrowseEntry[];
  truncated: boolean;
}

export type BrowsePreview =
  | { root: BrowseRoot; path: string; size: number; previewable: true; content: string }
  | { root: BrowseRoot; path: string; size: number; previewable: false; reason: string };

export const WORKSPACE_BINDING_OPTION_ID = "ragents.workspace.binding";

export const WORKSPACE_METADATA_ID = "ragents.workspace";

/** On which machine the workspace of a run is: the server or a workstation whose label the binding records. */
export type WorkspaceMachine = "server" | { client: string; label: string };

/** An existing folder that the run neither creates nor deletes. */
export type ExistingWorkspaceFolder = {
  path: string;
};

/** The new folder per run on a workstation; the binding records its path there from the moment it is chosen. */
export type FreshWorkstationFolder = {
  path: string;
  fresh: true;
};

/** Which folder: a new one per run or an existing one; for `fresh` on the server, the host creates one per run in its storage. */
export type WorkspaceFolder = "fresh" | ExistingWorkspaceFolder | FreshWorkstationFolder;

/** Where and in which folder a run works; frozen into the journal as a start option at the start. */
export type WorkspaceBinding = {
  machine: WorkspaceMachine;
  folder: WorkspaceFolder;
};

export const freshServerBinding = (): WorkspaceBinding => ({ machine: "server", folder: "fresh" });

export const WORKSPACE_CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** What a workstation says about itself at sign-in. */
export interface WorkspaceClientDescription {
  label: string;
  hostname: string;
  platform: string;
  folders: string[];
  /** Where the workstation creates the new folders per run, one subfolder per run named with its ID. */
  runsDirectory: string;
  /** Whether the workstation's bash finds rg; the prompt adjusts the search accordingly. */
  ripgrep: boolean;
}

export interface WorkspaceClientInfo extends WorkspaceClientDescription {
  id: string;
}

/** A background command a workstation names at sign-in because no server has learned of its end yet. */
export interface WorkstationBackgroundTask {
  runId: string;
  taskId: string;
  /** The actor the server named when it started the command; it learns of the end. */
  startedBy: string;
}

/** What the new folder per run is called on each machine: the empty folder or a plugin's contribution; null where there is none. */
export interface FreshWorkspaceLabels {
  server: string;
  client: string | null;
}

export interface WorkspaceBindingPresentation {
  kind: "workspace-binding";
  clients: WorkspaceClientInfo[];
  fresh: FreshWorkspaceLabels;
  /** Whether an existing folder of the server machine may be bound. */
  serverFolders: boolean;
}

export interface WorkspaceSessionMetadata {
  binding: WorkspaceBinding;
  summary: string;
}

const clientId = Type.String({ pattern: "^[A-Za-z0-9_-]{8,64}$", description: "Stable ID of the workstation" });

const executorVersion = Type.String({ minLength: 1, maxLength: 64, description: "Version of the executor that the workstation brings" });

/** The ID of a plugin; a workstation looks for its bundle under exactly this name, so it cannot contain a path. */
export const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

const executorContributions = Type.Array(Type.Object({
  plugin: Type.String({ pattern: PLUGIN_ID_PATTERN.source, maxLength: 128, description: "ID of the plugin" }),
  revision: Type.String({ pattern: "^[0-9a-f]{64}$", description: "SHA-256 of the contribution file" }),
}, { additionalProperties: false }), { maxItems: 64, description: "The plugins' contributions to the executor, in the order of the server's plugin list" });

const clientDescription = {
  label: Type.String({ minLength: 1, maxLength: 120 }),
  hostname: Type.String({ minLength: 1 }),
  platform: Type.String({ minLength: 1 }),
  folders: Type.Array(Type.String({ minLength: 1 }), { maxItems: 32 }),
  runsDirectory: Type.String({ minLength: 1, description: "Absolute folder under which the workstation creates the new folders per run" }),
  ripgrep: Type.Boolean({ description: "Whether the workstation's bash finds rg" }),
};

const backgroundTasks = Type.Array(Type.Object({
  runId: Type.String({ minLength: 1, maxLength: 64, description: "ID of the run" }),
  taskId: Type.String({ pattern: "^b[0-9a-f]{6}$", description: "ID of the background command, as bash returned it" }),
  startedBy: Type.String({ minLength: 1, maxLength: 200, description: "The actor the server named when it started the command" }),
}, { additionalProperties: false }), {
  maxItems: 1024,
  description: "The background commands of bash whose end no server has learned yet; the server observes those of runs bound to the workstation again, such as after its restart, and stops those of runs it does not have",
});

export const clientInfoSchema = Type.Object({
  id: Type.String(),
  ...clientDescription,
}, { additionalProperties: false });

/** The sign-in as a workstation with the server's executor sends it. */
export const clientRegistrationSchema = Type.Object({
  id: clientId,
  ...clientDescription,
  executor: executorVersion,
  contributions: executorContributions,
  backgroundTasks,
}, { additionalProperties: false });

/** A workstation with a different executor does not know the shape of this version; the server rejects it by its version, not by its shape. */
const otherExecutorRegistration = Type.Object({ label: clientDescription.label, executor: executorVersion }, {
  description: "Sign-in with a different executor version in any shape; the server rejects it with workspace-executor-version",
});

const absolutePath = Type.String({ minLength: 1, description: "Absolute path in the bound folder" });

/** Not an operation of a module: releases what the workstation's executor holds for the run. */
export const WORKSPACE_CLIENT_STOP_OPERATION = "stop";

/** The one operation the server calls on the workstation; progress is the JSON value of the operation, for bash { text }. */
export const workspaceClientContracts = {
  execute: defineOperation({
    id: "ragents.workspace.client.execute",
    description: "Run an operation of the executor on the workstation, such as a tool, a file query, or the process display; the result is its value, progress its JSON value. stop releases what the workstation holds for the run.",
    implementedBy: "client",
    input: Type.Object({
      runId: Type.String({ minLength: 1, maxLength: 64, description: "ID of the run" }),
      operation: Type.String({ minLength: 1, maxLength: 64, description: "Name of the operation, such as read, bash, roslyn_open, files.list, or stop" }),
      toolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: "Only for a tool call of the model" })),
      cwd: absolutePath,
      env: Type.Record(Type.String(), Type.String(), { description: "What the server contributes: run marker and git rules of the sandbox" }),
      browserNetwork: Type.Optional(Type.Object({
        allowedOrigins: Type.Array(Type.String()),
      }, { additionalProperties: false })),
      input: Type.Unknown({ description: "The input of the operation" }),
    }, { additionalProperties: false }),
    result: Type.Object({ value: Type.Unknown() }, { additionalProperties: false }),
  }),
} as const;

const browseTarget = {
  runId: Type.String({ minLength: 1, maxLength: 64, description: "ID of the run" }),
  root: Type.Union([Type.Literal("workspace"), Type.Literal("files")]),
  path: Type.String({ description: "Path below the root; empty is the root itself" }),
};

/** The sign-in of a workstation binds the calling connection; the server calls back through it. */
export const workspaceContracts = {
  browse: {
    list: defineOperation({
      id: "ragents.workspace.browse.list",
      description: "List a directory in the workspace or in the file store of a run.",
      rights: ["runs.read", "runs.inspect"],
      input: Type.Object(browseTarget, { additionalProperties: false }),
      result: openJson<BrowseListing>("BrowseListing"),
    }),
    preview: defineOperation({
      id: "ragents.workspace.browse.preview",
      description: "Preview a file as text; files that are too large or binary state the reason instead.",
      rights: ["runs.read", "runs.inspect"],
      input: Type.Object(browseTarget, { additionalProperties: false }),
      result: openJson<BrowsePreview>("BrowsePreview"),
    }),
  },
  channels: {
    browse: defineChannel({
      id: "ragents.workspace.browse",
      description: "Reports every change below the observed root of a run.",
      rights: ["runs.read", "runs.inspect"],
      params: Type.Object({ runId: browseTarget.runId, root: browseTarget.root }, { additionalProperties: false }),
      message: Type.Object({ changed: Type.Literal(true) }, { additionalProperties: false }),
    }),
  },
  clients: {
    list: defineOperation({
      id: "ragents.workspace.clients.list",
      description: "The caller's signed-in workstations; other users' workstations do not appear even with runs.read.all.",
      rights: ["runs.read"],
      input: Type.Object({}, { additionalProperties: false }),
      result: Type.Array(clientInfoSchema),
    }),
    contributions: defineOperation({
      id: "ragents.workspace.clients.contributions",
      description: "The plugins' contributions to the executor that a workstation loads before sign-in and reports back with it. A workstation with a different executor version fails on its version; other fields do not matter.",
      rights: ["runs.write"],
      input: Type.Object({ label: clientDescription.label, executor: executorVersion }),
      result: executorContributions,
    }),
    register: defineOperation({
      id: "ragents.workspace.clients.register",
      description: "Sign in a workstation or renew its folders; the connection of this request becomes its return path and needs an event stream. The server observes the named background commands of its runs on this workstation again. A workstation with a different executor version fails on its version before the rest of the shape matters.",
      rights: ["runs.write"],
      input: Type.Union([clientRegistrationSchema, otherExecutorRegistration]),
      result: clientInfoSchema,
    }),
    unregister: defineOperation({
      id: "ragents.workspace.clients.unregister",
      description: "Sign out one of your own workstations; open tasks fail.",
      rights: ["runs.write"],
      input: Type.Object({ id: clientId }, { additionalProperties: false }),
      result: Type.Null(),
    }),
  },
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const hasExactly = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

const isMachine = (value: unknown): value is WorkspaceMachine =>
  value === "server" || (isRecord(value) && hasExactly(value, ["client", "label"])
    && typeof value.client === "string" && WORKSPACE_CLIENT_ID_PATTERN.test(value.client) && typeof value.label === "string");

const isFolder = (value: unknown): value is WorkspaceFolder => {
  if (value === "fresh") return true;
  if (!isRecord(value) || typeof value.path !== "string" || value.path.length === 0) return false;
  return hasExactly(value, ["path"]) || (hasExactly(value, ["path", "fresh"]) && value.fresh === true);
};

/** A new folder with a path exists only on a workstation; on the server the host creates it itself. */
export const isWorkspaceBinding = (value: unknown): value is WorkspaceBinding =>
  isRecord(value) && hasExactly(value, ["machine", "folder"]) && isMachine(value.machine) && isFolder(value.folder)
  && !(value.machine === "server" && typeof value.folder === "object" && "fresh" in value.folder);

export const isFreshFolder = (folder: WorkspaceFolder): folder is "fresh" | FreshWorkstationFolder =>
  folder === "fresh" || "fresh" in folder;

/** The shape before machine and folder were separated, `{ kind: "fresh" | "path" | "client" }`, mapped unambiguously to the current one. */
const fromKind = (value: Record<string, unknown>): unknown => {
  switch (value.kind) {
    case "fresh": return hasExactly(value, ["kind"]) ? freshServerBinding() : undefined;
    case "path": return hasExactly(value, ["kind", "path"]) ? { machine: "server", folder: { path: value.path } } : undefined;
    case "client": return hasExactly(value, ["kind", "client", "label", "path"])
      ? { machine: { client: value.client, label: value.label }, folder: { path: value.path } }
      : undefined;
    default: return undefined;
  }
};

/** The stored binding; older, immutable journals carry the shape with `kind`, and only here is it mapped. */
export const storedWorkspaceBinding = (value: unknown): WorkspaceBinding | undefined => {
  if (isWorkspaceBinding(value)) return value;
  const mapped = isRecord(value) && Object.hasOwn(value, "kind") ? fromKind(value) : undefined;
  return isWorkspaceBinding(mapped) ? mapped : undefined;
};

export const FRESH_WORKSPACE_LABEL = "Empty folder per run";

/** What the new folder per run is called on the binding's machine; without a contribution there, the empty folder. */
const freshLabelOf = (binding: WorkspaceBinding, labels: FreshWorkspaceLabels): string =>
  (binding.machine === "server" ? labels.server : labels.client) ?? FRESH_WORKSPACE_LABEL;

/** A workstation is named by its current label; the stored one only stands in while it is not registered. */
export const withCurrentLabel = (binding: WorkspaceBinding, label: string | undefined): WorkspaceBinding =>
  binding.machine === "server" || label === undefined || label === binding.machine.label ? binding : { ...binding, machine: { ...binding.machine, label } };

export const workspaceBindingSummary = (binding: WorkspaceBinding, labels: FreshWorkspaceLabels): string => {
  const { machine, folder } = binding;
  const fresh = freshLabelOf(binding, labels);
  const where = folder === "fresh" ? fresh : "fresh" in folder ? `${folder.path} (${fresh})` : folder.path;
  return machine === "server" ? where : `${machine.label}: ${where}`;
};
