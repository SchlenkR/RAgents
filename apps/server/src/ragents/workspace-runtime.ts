import { serviceToken, type JsonValue, type WorkspaceToolNaming } from "@ragents/engine";
import type { ResolvedWorkspaceRoot, SessionIdent } from "@ragents/workspace-executor";

/** A folder outside the workspace that a run's process sandbox permits; absolute, for reading or for reading and writing. */
export interface SandboxFolder {
  directory: string;
  access: "read" | "write";
}

export interface SessionWorkspace {
  cwd: string;
  /** Describes the resolved workspace in words; becomes a chapter in the system prompt of every actor with workspace tools. */
  description?: string;
  /** Home folder, read-only roots and account of the sandbox, if the workspace determines them itself. */
  hostSandbox?: { home: string; readOnlyRoots: readonly ResolvedWorkspaceRoot[]; ident?: SessionIdent };
  /** What the run's processes on the server need outside the workspace, e.g. the shared repository of a Git worktree. */
  sandboxFolders?: readonly SandboxFolder[];
  gitEnv?: NodeJS.ProcessEnv;
  gitConfig?: ReadonlyArray<readonly [string, string]>;
  extraEnv?: NodeJS.ProcessEnv;
  currentRoot: () => Promise<string>;
  runOperation: <T>(operation: () => Promise<T>) => Promise<T>;
}

export interface WorkspaceRuntimeDescription {
  mode: string;
  directoryPattern: string;
}

/** Moving a run to another server: what its binding means there and how the target replaces it. */
export interface WorkspaceTransfer {
  /** The existing folder on this server machine to which the run is bound; null for a new folder per run or a workstation. */
  boundDirectory: (runId: string) => string | null;
  /** Checks a replacement folder before the import creates anything. */
  assertDirectory: (directory: string) => void;
  /** Binds the run on the target to an existing replacement folder. */
  rebind: (runId: string, directory: string) => void;
}

/** Where and in which folder a run works, answered separately; a flow asks for both, never for a mixed value. */
export interface WorkspacePlacement {
  machine: "server" | "client";
  folder: "fresh" | "existing";
  /** The id of the kind (`WorkspaceKind.id`), if a contribution provided the new folder. */
  kind?: string;
}

export interface WorkspaceRuntime {
  resolve: (runId: string, emitSystem: (text: string) => void) => Promise<SessionWorkspace>;
  describe: () => WorkspaceRuntimeDescription;
  /** The one central place where a flow asks where and in which folder a run works. */
  placementOf: (runId: string) => WorkspacePlacement;
  toolNaming?: WorkspaceToolNaming;
  transfer?: WorkspaceTransfer;
}

export const workspaceRuntimeToken = serviceToken<WorkspaceRuntime>("ragents.workspace-runtime");

export interface WorkspaceResolverContext {
  runId: string;
  directory: string;
  choice: JsonValue | null;
  emitSystem: (text: string) => void;
}

/** What a contribution delivers for a run's workspace; what it leaves out, the workspace plugin fills in. */
export interface WorkspaceResolution extends Partial<Omit<SessionWorkspace, "cwd">> {
  cwd: string;
}

/** The kind of workspace that a plugin contributes per run on the server in place of the empty folder. */
export interface WorkspaceKind {
  /** Id by which a flow recognizes a run's workspace. */
  id: string;
  /** Short form for the start option and session data, e.g. "Worktree per run". */
  label: string;
  /** Whether a folder of the server machine may be bound alongside it; a workspace with its own rights excludes it. */
  serverFolders: boolean;
  /** Where the folders per run lie, if not in the workspace plugin's storage; for display only. */
  directoryPattern?: string;
}

/** A step when creating or removing the new folder on a workstation: an operation of the executor there, in the run's folder. */
export interface WorkspaceFolderStep {
  operation: string;
  input: JsonValue;
}

export interface WorkstationFolderContext {
  runId: string;
  /** The run's folder on the workstation. */
  path: string;
  label: string;
  choice: JsonValue | null;
}

/** How a contribution provides the new folder per run on a workstation; the executor there creates it empty, the steps fill it. */
export interface WorkstationFolder {
  /** Short form for the start option and session data, e.g. "Git worktree per run". */
  label: string;
  /** Run in order, once after creation; if one fails, the host removes the folder again. */
  prepare: (context: WorkstationFolderContext) => readonly WorkspaceFolderStep[];
  /** Run before the folder is removed, e.g. to unregister a worktree from its repository. */
  release?: (context: WorkstationFolderContext) => readonly WorkspaceFolderStep[];
  /** Describes the folder in the system prompt; if omitted, the new, initially empty folder. */
  description?: (context: WorkstationFolderContext) => string;
}

export interface WorkspaceResolver {
  optionId?: string;
  kind?: WorkspaceKind;
  /** With a contribution, the new folder per run exists on a workstation only if the contribution provides it there. */
  workstation?: WorkstationFolder;
  resolve: (context: WorkspaceResolverContext) => Promise<WorkspaceResolution>;
  /** Stopping a run in the contributed workspace on the server; `sandbox` stops the host's tools in the process. */
  stopSession?: (runId: string, sandbox: () => Promise<void>) => Promise<void>;
  /** Deleting a run in the contributed workspace on the server, after stopping. */
  deleteSession?: (runId: string) => Promise<void>;
}

export const workspaceResolverToken = serviceToken<WorkspaceResolver>("ragents.workspace-resolver");

export interface GitWorkspaceView {
  branch: (runId: string) => Promise<string | undefined>;
  changes: (runId: string) => Promise<unknown>;
  /** previousPath names the source of a rename from the change list; only this way does Git pair them without the whole list. */
  file: (runId: string, filePath: string, view: "diff" | "current", previousPath?: string) => Promise<unknown>;
}

export const gitWorkspaceViewToken = serviceToken<GitWorkspaceView>("ragents.git-workspace-view");
