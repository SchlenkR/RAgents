import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { JsonValue, RunState, WorkspaceToolNaming } from "@ragents/engine";
import { DomainError } from "@ragents/engine";
import type { SandboxHomeEnvironment, WorkspaceExecutor } from "@ragents/workspace-executor";
import type {
  SessionWorkspace,
  WorkspaceResolver,
  WorkspaceRuntime,
  WorkspaceRuntimeDescription,
  WorkspaceTransfer,
} from "@ragents/host/ragents/workspace-runtime.js";
import { storedStartOption } from "@ragents/host/ragents/start-option-state.js";
import { sandboxToolNaming } from "./workspace-tool-naming.js";
import { WorkspaceSandboxHost } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import type { WorkspaceBinding } from "../contract.js";
import { bindingOf, boundServerDirectory, serverDirectoryBinding, workspaceOwnerOf } from "./binding.js";
import type { WorkspaceClientRegistry } from "./clients.js";

export interface RunWorkspaceRuntimeOptions {
  globalDirectory: string;
  sessionDirectory: (runId: string, ...segments: string[]) => string;
  /** Die Speichergrenze eines Runs; innerhalb davon gehören private Arbeitsdateien seinem Konto. */
  storageRootFor: (runId: string) => string;
  sessionsDirectoryPattern: string;
  sessionWorkspaceFor: (runId: string) => Promise<SessionWorkspace>;
  skillPaths: () => Promise<readonly string[]>;
  resolver: () => WorkspaceResolver | undefined;
  runState: (runId: string) => RunState | null;
  storeBinding: (runId: string, binding: WorkspaceBinding) => void;
  clients: WorkspaceClientRegistry;
}

const runNotStarted = (): DomainError => new DomainError(
  "run-not-started",
  "Die Unterhaltung ist noch nicht gestartet; das Arbeitsverzeichnis entsteht mit der ersten Nachricht.",
  409,
);

const lookAround = "Look around in it before you say anything about the project.";

const serverProjectDescription = (cwd: string): string => [
  "# Working directory",
  "",
  `Your working directory is \`${cwd}\` on the server: the project folder the user picked.`,
  `It is a real project. Work inside it, keep its structure, and never delete or reorganize files unless you are asked to. ${lookAround}`,
].join("\n");

const clientProjectDescription = (projectPath: string, label: string): string => [
  "# Working directory",
  "",
  `Your working directory is the project folder \`${projectPath}\` on the workplace "${label}", not on the server.`,
  "Every workspace tool runs there, and a relative path refers to that folder.",
  `It is a real project. Keep its structure, and never delete or reorganize files unless you are asked to. ${lookAround}`,
].join("\n");

const freshDescription = (cwd: string): string => [
  "# Working directory",
  "",
  `Your working directory is \`${cwd}\`, a private folder of this conversation on the server.`,
  "No other conversation sees it, and it starts empty unless the profile prepared content in it.",
  "Look around in it before you say anything about what is already there.",
].join("\n");

export class RunWorkspaceRuntime implements WorkspaceRuntime {
  readonly sandbox: WorkspaceSandboxHost;
  readonly toolNaming: WorkspaceToolNaming = sandboxToolNaming;
  readonly transfer: WorkspaceTransfer;
  readonly #options: RunWorkspaceRuntimeOptions;
  readonly #nugetCacheDirectory: string;

  constructor(options: RunWorkspaceRuntimeOptions) {
    this.#options = options;
    this.transfer = {
      boundDirectory: (runId) => boundServerDirectory(options.runState(runId)),
      assertDirectory: (directory) => void serverDirectoryBinding(directory),
      rebind: (runId, directory) => options.storeBinding(runId, serverDirectoryBinding(directory)),
    };
    this.#nugetCacheDirectory = path.join(options.globalDirectory, "nuget-cache");
    this.sandbox = new WorkspaceSandboxHost({
      contributorName: "ragents.workspace.sandbox",
      workspaceFor: options.sessionWorkspaceFor,
      identFor: () => Promise.resolve(undefined),
      skillPaths: options.skillPaths,
      storageRootFor: options.storageRootFor,
      homeFor: (runId) => this.#homeFor(runId),
      executorFor: (runId) => Promise.resolve(this.#executorFor(runId)),
      serverDirectoryFor: (runId) => this.#serverDirectoryFor(runId),
    });
  }

  /** Arbeit eines Runs, die auf dem Server läuft, während sein Arbeitsbereich auf einem Arbeitsplatz liegt. */
  async #serverDirectoryFor(runId: string): Promise<string> {
    const directory = this.#options.sessionDirectory(runId, "server");
    await mkdir(directory, { recursive: true });
    return realpath(directory);
  }

  async #homeFor(runId: string): Promise<SandboxHomeEnvironment> {
    const home = this.#options.sessionDirectory(runId, "home");
    await mkdir(home, { recursive: true });
    await mkdir(this.#nugetCacheDirectory, { recursive: true });
    return { home, nugetPackages: this.#nugetCacheDirectory };
  }

  /** Bei Bindung `client` führt der Arbeitsplatz des Run-Eigentümers aus, sonst der Executor des Servers. */
  #executorFor(runId: string): WorkspaceExecutor | undefined {
    const state = this.#options.runState(runId);
    const binding = bindingOf(state);
    return binding.kind === "client"
      ? this.#options.clients.executorFor(workspaceOwnerOf(state), binding.client, binding.label, binding.path)
      : undefined;
  }

  async resolve(runId: string, emitSystem: (text: string) => void): Promise<SessionWorkspace> {
    const state = this.#options.runState(runId);
    if (!state) throw runNotStarted();
    const binding = bindingOf(state);
    switch (binding.kind) {
      case "fresh": return this.#fresh(runId, state, emitSystem);
      case "path": return this.#bound(binding, emitSystem);
      case "client": return this.#clientSide(binding, emitSystem);
    }
  }

  /** Die Art des Arbeitsbereichs: der Beitrag benennt den Ordner je Run, die übrigen Bindungen sich selbst. */
  kindOf(runId: string): string {
    const binding = bindingOf(this.#options.runState(runId));
    return binding.kind === "fresh" ? this.#contribution()?.kind?.id ?? "fresh" : binding.kind;
  }

  async #fresh(runId: string, state: RunState, emitSystem: (text: string) => void): Promise<SessionWorkspace> {
    const resolver = this.#options.resolver();
    const directory = resolver?.kind
      ? this.#options.sessionDirectory(runId, "workspace")
      : await this.#sessionWorkspace(runId);
    if (!resolver) return this.#directory(directory, freshDescription(directory));
    const { cwd, description, currentRoot, runOperation, ...rest } = await resolver.resolve({
      runId,
      directory,
      choice: this.#choiceFor(state, resolver),
      emitSystem,
    });
    const resolved = path.resolve(cwd);
    return {
      ...this.#directory(resolved, description ?? freshDescription(resolved)),
      ...rest,
      ...(currentRoot ? { currentRoot } : {}),
      ...(runOperation ? { runOperation } : {}),
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
      description: serverProjectDescription(cwd),
      currentRoot: existing,
      runOperation: (operation) => operation(),
    };
  }

  /** Der Arbeitsbereich liegt auf dem Arbeitsplatz; der Server kennt nur seinen Pfad, und jeder lokale Griff darauf scheitert laut. */
  #clientSide(
    binding: Extract<WorkspaceBinding, { kind: "client" }>,
    emitSystem: (text: string) => void,
  ): SessionWorkspace {
    emitSystem(`Arbeitsbereich: ${binding.path} (Projektordner auf dem Arbeitsplatz ${binding.label})`);
    const remote = (): Promise<string> => Promise.reject(new Error(
      `Der Arbeitsbereich ${binding.path} liegt auf dem Arbeitsplatz ${binding.label}, nicht auf dem Server; `
      + "er ist nur über den Executor des Runs (SandboxServices.execute) erreichbar.",
    ));
    return {
      cwd: binding.path,
      description: clientProjectDescription(binding.path, binding.label),
      currentRoot: remote,
      runOperation: (operation) => operation(),
    };
  }

  async #sessionWorkspace(runId: string): Promise<string> {
    const directory = this.#options.sessionDirectory(runId, "workspace");
    await mkdir(directory, { recursive: true });
    return directory;
  }

  #directory(cwd: string, description: string, extraEnv?: NodeJS.ProcessEnv): SessionWorkspace {
    return {
      cwd,
      description,
      ...(extraEnv ? { extraEnv } : {}),
      currentRoot: () => realpath(cwd),
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
      directoryPattern: this.#contribution()?.kind?.directoryPattern
        ?? path.join(this.#options.sessionsDirectoryPattern, "workspace"),
    };
  }

  #contribution(): WorkspaceResolver | undefined {
    return this.#options.resolver();
  }

  /** Der Beitrag räumt nur hinter den Runs auf, deren Arbeitsbereich er gestellt hat. */
  #contributionFor(runId: string): WorkspaceResolver | undefined {
    return bindingOf(this.#options.runState(runId)).kind === "fresh" ? this.#contribution() : undefined;
  }

  async deleteSession(runId: string): Promise<void> {
    const contribution = this.#contributionFor(runId);
    await this.stopSession(runId);
    await contribution?.deleteSession?.(runId);
  }

  stopSession(runId: string): Promise<void> {
    const contribution = this.#contributionFor(runId);
    const sandbox = (): Promise<void> => this.sandbox.shutdown(runId);
    return contribution?.stopSession ? contribution.stopSession(runId, sandbox) : sandbox();
  }

  async shutdown(): Promise<void> {
    await this.sandbox.shutdownAll();
    this.#options.clients.shutdown();
  }
}
