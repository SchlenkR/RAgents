import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { JsonValue, RunState, WorkspaceToolNaming } from "@aicontainer/ragents";
import { DomainError } from "@aicontainer/ragents";
import type {
  SessionWorkspace,
  WorkspaceResolver,
  WorkspaceRuntime,
  WorkspaceRuntimeDescription,
} from "@aicontainer/server/ragents/workspace-runtime.js";
import { storedStartOption } from "@aicontainer/server/ragents/start-option-state.js";
import { sandboxToolNaming } from "@aicontainer/server/plugin-support/workspace-tool-naming.js";
import { WorkspaceSandboxHost } from "@aicontainer/server/plugin-support/workspace-sandbox-host.js";
import type { SandboxHomeEnvironment } from "@aicontainer/server/plugin-support/sandbox-tools.js";

export interface RunWorkspaceRuntimeOptions {
  globalDirectory: string;
  sessionDirectory: (runId: string, ...segments: string[]) => string;
  sessionsDirectoryPattern: string;
  sessionWorkspaceFor: (runId: string) => Promise<SessionWorkspace>;
  skillPaths: () => Promise<readonly string[]>;
  resolver: () => WorkspaceResolver | undefined;
  runState: (runId: string) => RunState | null;
  documentsFor: (runId: string) => Promise<string | undefined>;
}

export class RunWorkspaceRuntime implements WorkspaceRuntime {
  readonly sandbox: WorkspaceSandboxHost;
  readonly toolNaming: WorkspaceToolNaming = sandboxToolNaming;
  readonly #options: RunWorkspaceRuntimeOptions;
  readonly #nugetCacheDirectory: string;

  constructor(options: RunWorkspaceRuntimeOptions) {
    this.#options = options;
    this.#nugetCacheDirectory = path.join(options.globalDirectory, "nuget-cache");
    this.sandbox = new WorkspaceSandboxHost({
      contributorName: "ragents.workspace.sandbox",
      workspaceFor: options.sessionWorkspaceFor,
      identFor: () => Promise.resolve(undefined),
      skillPaths: options.skillPaths,
      homeFor: (runId) => this.#homeFor(runId),
      filesFor: options.documentsFor,
    });
  }

  async #homeFor(runId: string): Promise<SandboxHomeEnvironment> {
    const home = this.#options.sessionDirectory(runId, "home");
    await mkdir(home, { recursive: true });
    await mkdir(this.#nugetCacheDirectory, { recursive: true });
    return { home, nugetPackages: this.#nugetCacheDirectory };
  }

  async resolve(runId: string, emitSystem: (text: string) => void): Promise<SessionWorkspace> {
    const directory = this.#options.sessionDirectory(runId, "workspace");
    await mkdir(directory, { recursive: true });
    const resolver = this.#options.resolver();
    const resolution = resolver
      ? await resolver.resolve({ runId, directory, choice: this.#choiceFor(runId, resolver), emitSystem })
      : { cwd: directory };
    const cwd = path.resolve(resolution.cwd);
    return {
      cwd,
      ...(resolution.extraEnv ? { extraEnv: resolution.extraEnv } : {}),
      currentRoot: () => realpath(cwd),
      ensureWritable: () => realpath(cwd),
      runOperation: (operation) => operation(),
    };
  }

  #choiceFor(runId: string, resolver: WorkspaceResolver): JsonValue | null {
    if (resolver.optionId === undefined) return null;
    const state = this.#options.runState(runId);
    if (!state) {
      throw new DomainError(
        "run-not-started",
        "Die Unterhaltung ist noch nicht gestartet; das Arbeitsverzeichnis entsteht mit der ersten Nachricht.",
        409,
      );
    }
    const choice = storedStartOption(state, resolver.optionId);
    if (choice === undefined) {
      throw new Error(`Die Startoption ${resolver.optionId} des Workspace-Resolvers ist in der Unterhaltung ${runId} nicht gespeichert`);
    }
    return choice;
  }

  describe(): WorkspaceRuntimeDescription {
    return {
      mode: "per-run",
      directoryPattern: path.join(this.#options.sessionsDirectoryPattern, "workspace"),
    };
  }

  deleteSession(runId: string): Promise<void> {
    return this.stopSession(runId);
  }

  stopSession(runId: string): Promise<void> {
    return this.sandbox.shutdown(runId);
  }

  shutdown(): Promise<void> {
    return this.sandbox.shutdownAll();
  }
}
