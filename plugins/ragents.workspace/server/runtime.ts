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
import type { WorkspaceBinding } from "../contract.js";
import { bindingOf } from "./binding.js";
import type { WorkspaceClientRegistry } from "./clients.js";

export interface RunWorkspaceRuntimeOptions {
  globalDirectory: string;
  sessionDirectory: (runId: string, ...segments: string[]) => string;
  sessionsDirectoryPattern: string;
  sessionWorkspaceFor: (runId: string) => Promise<SessionWorkspace>;
  skillPaths: () => Promise<readonly string[]>;
  resolver: () => WorkspaceResolver | undefined;
  runState: (runId: string) => RunState | null;
  documentsFor: (runId: string) => Promise<string | undefined>;
  clients: WorkspaceClientRegistry;
}

const runNotStarted = (): DomainError => new DomainError(
  "run-not-started",
  "Die Unterhaltung ist noch nicht gestartet; das Arbeitsverzeichnis entsteht mit der ersten Nachricht.",
  409,
);

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
    const state = this.#options.runState(runId);
    if (!state) throw runNotStarted();
    const binding = bindingOf(state);
    switch (binding.kind) {
      case "fresh": return this.#fresh(runId, state);
      case "path": return this.#bound(binding, emitSystem);
      case "client": return this.#remote(runId, binding, emitSystem);
    }
  }

  async #fresh(runId: string, state: RunState): Promise<SessionWorkspace> {
    const directory = this.#options.sessionDirectory(runId, "workspace");
    await mkdir(directory, { recursive: true });
    const resolver = this.#options.resolver();
    const resolution = resolver
      ? await resolver.resolve({ runId, directory, choice: this.#choiceFor(state, resolver), emitSystem: () => undefined })
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

  #bound(binding: Extract<WorkspaceBinding, { kind: "path" }>, emitSystem: (text: string) => void): SessionWorkspace {
    const cwd = path.resolve(binding.path);
    const existing = async (): Promise<string> => {
      try {
        return await realpath(cwd);
      } catch {
        throw new DomainError("workspace-path-missing", `Der gebundene Ordner ${cwd} existiert auf dem Server nicht mehr.`, 409);
      }
    };
    emitSystem(`Arbeitsbereich: ${cwd} (Projektordner auf dem Server)`);
    return {
      cwd,
      currentRoot: existing,
      ensureWritable: existing,
      runOperation: (operation) => operation(),
    };
  }

  #remote(runId: string, binding: Extract<WorkspaceBinding, { kind: "client" }>, emitSystem: (text: string) => void): SessionWorkspace {
    const cwd = binding.path;
    emitSystem(`Arbeitsbereich: ${cwd} (Projektordner auf dem Arbeitsplatz ${binding.label})`);
    return {
      cwd,
      remote: this.#options.clients.operationsFor(binding.client, binding.label),
      currentRoot: async () => cwd,
      ensureWritable: async () => cwd,
      runOperation: (operation) => operation(),
    };
  }

  #choiceFor(state: RunState, resolver: WorkspaceResolver): JsonValue | null {
    if (resolver.optionId === undefined) return null;
    const choice = storedStartOption(state, resolver.optionId);
    if (choice === undefined) {
      throw new Error(`Die Startoption ${resolver.optionId} des Workspace-Resolvers ist in der Unterhaltung nicht gespeichert`);
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

  async shutdown(): Promise<void> {
    await this.sandbox.shutdownAll();
    this.#options.clients.shutdown();
  }
}
