import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { JsonValue, RunState, WorkspaceToolNaming } from "@ragents/engine";
import { DomainError } from "@ragents/engine";
import {
  RUN_FOLDER_OPERATIONS,
  type RunFolderCreated,
  type SandboxHomeEnvironment,
  type WorkspaceExecuteOptions,
  type WorkspaceExecutor,
} from "@ragents/workspace-executor";
import type {
  SessionWorkspace,
  WorkspaceFolderStep,
  WorkspacePlacement,
  WorkspaceResolver,
  WorkspaceRuntime,
  WorkspaceRuntimeDescription,
  WorkspaceTransfer,
  WorkstationFolderContext,
} from "@ragents/host/ragents/workspace-runtime.js";
import { storedStartOption } from "@ragents/host/ragents/start-option-state.js";
import { sandboxToolNaming } from "./workspace-tool-naming.js";
import { WorkspaceSandboxHost } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import type { RunProcessSandboxes } from "@ragents/host/plugin-support/process-sandbox.js";
import { FRESH_WORKSPACE_LABEL, isFreshFolder, type ExistingWorkspaceFolder, type WorkspaceBinding } from "../contract.js";
import {
  bindingOf,
  boundServerDirectory,
  isWorkstationBinding,
  serverDirectoryFolder,
  workspaceOwnerOf,
  type WorkstationBinding,
} from "./binding.js";
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
  /** Die Prozess-Sandbox des Servers; ohne sie laufen die Prozesse des Servers ohne. */
  processSandbox?: RunProcessSandboxes;
}

const runNotStarted = (): DomainError => new DomainError(
  "run-not-started",
  "Der Run ist noch nicht gestartet; das Arbeitsverzeichnis entsteht mit der ersten Nachricht.",
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
  `Your working directory is the project folder \`${projectPath}\` on the workstation "${label}", not on the server.`,
  "Every workspace tool runs there, and a relative path refers to that folder.",
  `It is a real project. Keep its structure, and never delete or reorganize files unless you are asked to. ${lookAround}`,
].join("\n");

const freshWorkstationDescription = (folderPath: string, label: string): string => [
  "# Working directory",
  "",
  `Your working directory is \`${folderPath}\` on the workstation "${label}", not on the server: a folder of this run alone.`,
  "Every workspace tool runs there, and a relative path refers to that folder.",
  "It starts empty unless the profile prepared content in it. Look around in it before you say anything about what is already there.",
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
  /** Die neuen Ordner auf Arbeitsplätzen, die in diesem Serverlauf schon angelegt oder in Arbeit sind. */
  readonly #preparations = new Map<string, Promise<void>>();

  constructor(options: RunWorkspaceRuntimeOptions) {
    this.#options = options;
    this.transfer = {
      boundDirectory: (runId) => boundServerDirectory(options.runState(runId)),
      assertDirectory: (directory) => void serverDirectoryFolder(directory),
      rebind: (runId, directory) => options.storeBinding(runId, { machine: "server", folder: serverDirectoryFolder(directory) }),
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
      ...(options.processSandbox ? { processSandbox: options.processSandbox } : {}),
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

  /** Auf einem Arbeitsplatz führt dessen Executor im Namen des Run-Eigentümers aus, sonst der des Servers. */
  #executorFor(runId: string): WorkspaceExecutor | undefined {
    const state = this.#options.runState(runId);
    const binding = bindingOf(state);
    if (!isWorkstationBinding(binding)) return undefined;
    const { machine, folder } = binding;
    const executor = this.#options.clients.executorFor(workspaceOwnerOf(state), machine.client, machine.label, folder.path);
    return "fresh" in folder ? this.#preparing(state, binding, executor) : executor;
  }

  /** Vor dem ersten Auftrag eines Runs legt der Arbeitsplatz dessen neuen Ordner an; Aufräumen legt nie einen an. */
  #preparing(state: RunState | null, binding: WorkstationBinding, executor: WorkspaceExecutor): WorkspaceExecutor {
    return {
      ...executor,
      execute: async (runId, operation, input, options = {}) => {
        if (!options.whenReachable) await this.#prepared(runId, state, binding, executor);
        return executor.execute(runId, operation, input, options);
      },
    };
  }

  #prepared(runId: string, state: RunState | null, binding: WorkstationBinding, executor: WorkspaceExecutor): Promise<void> {
    const known = this.#preparations.get(runId);
    if (known) return known;
    const preparation = this.#prepare(runId, state, binding, executor).catch((error: unknown) => {
      this.#preparations.delete(runId);
      throw error;
    });
    this.#preparations.set(runId, preparation);
    return preparation;
  }

  /** Nur ein eben angelegter Ordner bekommt die Schritte des Beitrags; scheitert einer, verschwindet er wieder, und der nächste Auftrag beginnt neu. */
  async #prepare(runId: string, state: RunState | null, binding: WorkstationBinding, executor: WorkspaceExecutor): Promise<void> {
    const { created } = await executor.execute(runId, RUN_FOLDER_OPERATIONS.create, null) as RunFolderCreated;
    const steps = created ? this.#contribution()?.workstation?.prepare(this.#workstationContext(runId, state, binding)) ?? [] : [];
    try {
      await this.#runSteps(runId, executor, steps);
    } catch (error) {
      await executor.execute(runId, RUN_FOLDER_OPERATIONS.remove, null, { whenReachable: true });
      throw error;
    }
  }

  async #runSteps(runId: string, executor: WorkspaceExecutor, steps: readonly WorkspaceFolderStep[], options: WorkspaceExecuteOptions = {}): Promise<void> {
    for (const step of steps) await executor.execute(runId, step.operation, step.input, options);
  }

  #workstationContext(runId: string, state: RunState | null, binding: WorkstationBinding): WorkstationFolderContext {
    const contribution = this.#contribution();
    return {
      runId,
      path: binding.folder.path,
      label: binding.machine.label,
      choice: contribution && state ? this.#choiceFor(state, contribution) : null,
    };
  }

  async resolve(runId: string, emitSystem: (text: string) => void): Promise<SessionWorkspace> {
    const state = this.#options.runState(runId);
    if (!state) throw runNotStarted();
    const binding = bindingOf(state);
    if (isWorkstationBinding(binding)) return this.#workstation(runId, state, binding, emitSystem);
    const { folder } = binding;
    return isFreshFolder(folder) ? this.#fresh(runId, state, emitSystem) : this.#bound(folder, emitSystem);
  }

  placementOf(runId: string): WorkspacePlacement {
    const { machine, folder } = bindingOf(this.#options.runState(runId));
    const placement: WorkspacePlacement = {
      machine: machine === "server" ? "server" : "client",
      folder: isFreshFolder(folder) ? "fresh" : "existing",
    };
    const contribution = this.#contribution();
    const contributed = placement.folder === "fresh" && (placement.machine === "server" || contribution?.workstation !== undefined);
    const kind = contributed ? contribution?.kind?.id : undefined;
    return kind === undefined ? placement : { ...placement, kind };
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

  #bound(folder: ExistingWorkspaceFolder, emitSystem: (text: string) => void): SessionWorkspace {
    const cwd = path.resolve(folder.path);
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
  #workstation(runId: string, state: RunState, binding: WorkstationBinding, emitSystem: (text: string) => void): SessionWorkspace {
    const { machine: { label }, folder } = binding;
    const fresh = "fresh" in folder;
    const workstation = this.#contribution()?.workstation;
    emitSystem(fresh
      ? `Arbeitsbereich: ${folder.path} (${workstation?.label ?? FRESH_WORKSPACE_LABEL} auf dem Arbeitsplatz ${label})`
      : `Arbeitsbereich: ${folder.path} (Projektordner auf dem Arbeitsplatz ${label})`);
    const remote = (): Promise<string> => Promise.reject(new Error(
      `Der Arbeitsbereich ${folder.path} liegt auf dem Arbeitsplatz ${label}, nicht auf dem Server; `
      + "er ist nur über den Executor des Runs (SandboxServices.execute) erreichbar.",
    ));
    const description = !fresh
      ? clientProjectDescription(folder.path, label)
      : workstation?.description?.(this.#workstationContext(runId, state, binding)) ?? freshWorkstationDescription(folder.path, label);
    return {
      cwd: folder.path,
      description,
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
      throw new Error(`Die Startoption ${resolver.optionId} des Workspace-Resolvers ist im Run nicht gespeichert`);
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

  /** Auf dem Server gehört ein neuer Ordner samt Stopp und Löschen dem Beitrag; auf einem Arbeitsplatz räumt ihn der Host weg. */
  #serverContributionFor(runId: string): WorkspaceResolver | undefined {
    const { machine, folder } = bindingOf(this.#options.runState(runId));
    return machine === "server" && isFreshFolder(folder) ? this.#contribution() : undefined;
  }

  /** Ist der Arbeitsplatz nicht erreichbar, bleibt der Ordner dort mit Hinweis liegen; der Run ist trotzdem gelöscht. */
  async #removeWorkstationFolder(runId: string): Promise<void> {
    this.#preparations.delete(runId);
    const state = this.#options.runState(runId);
    const binding = bindingOf(state);
    if (!isWorkstationBinding(binding) || !("fresh" in binding.folder)) return;
    const { machine, folder } = binding;
    const executor = this.#options.clients.executorFor(workspaceOwnerOf(state), machine.client, machine.label, folder.path);
    const steps = this.#contribution()?.workstation?.release?.(this.#workstationContext(runId, state, binding)) ?? [];
    await this.#runSteps(runId, executor, steps, { whenReachable: true });
    if (await executor.execute(runId, RUN_FOLDER_OPERATIONS.remove, null, { whenReachable: true }) !== null) return;
    console.warn(`Der Ordner ${folder.path} des Runs ${runId} bleibt auf dem Arbeitsplatz ${machine.label}, weil er nicht erreichbar war.`);
  }

  async deleteSession(runId: string): Promise<void> {
    const contribution = this.#serverContributionFor(runId);
    await this.stopSession(runId);
    await this.#removeWorkstationFolder(runId);
    await contribution?.deleteSession?.(runId);
  }

  stopSession(runId: string): Promise<void> {
    const contribution = this.#serverContributionFor(runId);
    const sandbox = (): Promise<void> => this.sandbox.shutdown(runId);
    return contribution?.stopSession ? contribution.stopSession(runId, sandbox) : sandbox();
  }

  async shutdown(): Promise<void> {
    await this.sandbox.shutdownAll();
    this.#options.clients.shutdown();
  }
}
