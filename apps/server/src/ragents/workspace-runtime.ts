import { serviceToken, type JsonValue, type WorkspaceToolNaming } from "@aicontainer/ragents";

export interface SessionWorkspace {
  cwd: string;
  hostSandbox?: { home: string; readOnlyDirectories: readonly string[]; filesDirectory?: string };
  gitEnv?: NodeJS.ProcessEnv;
  gitConfig?: ReadonlyArray<readonly [string, string]>;
  extraEnv?: NodeJS.ProcessEnv;
  currentRoot: () => Promise<string>;
  ensureWritable: () => Promise<string>;
  runOperation: <T>(operation: () => Promise<T>) => Promise<T>;
}

export interface WorkspaceRuntimeDescription {
  mode: string;
  directoryPattern: string;
}

export interface WorkspaceRuntime {
  resolve: (runId: string, emitSystem: (text: string) => void) => Promise<SessionWorkspace>;
  describe: () => WorkspaceRuntimeDescription;
  toolNaming?: WorkspaceToolNaming;
}

export const workspaceRuntimeToken = serviceToken<WorkspaceRuntime>("ragents.workspace-runtime");

export interface WorkspaceResolverContext {
  runId: string;
  directory: string;
  choice: JsonValue | null;
  emitSystem: (text: string) => void;
}

export interface WorkspaceResolution {
  cwd: string;
  extraEnv?: NodeJS.ProcessEnv;
}

export interface WorkspaceResolver {
  optionId?: string;
  resolve: (context: WorkspaceResolverContext) => Promise<WorkspaceResolution>;
}

export const workspaceResolverToken = serviceToken<WorkspaceResolver>("ragents.workspace-resolver");

export interface GitWorkspaceView {
  branch: (runId: string) => Promise<string | undefined>;
  changes: (runId: string) => Promise<unknown>;
  file: (runId: string, filePath: string, view: "diff" | "current") => Promise<unknown>;
}

export const gitWorkspaceViewToken = serviceToken<GitWorkspaceView>("ragents.git-workspace-view");
