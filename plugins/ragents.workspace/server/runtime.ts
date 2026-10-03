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
  type WorkspaceExecutorParts,
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
import { WorkspaceSandboxHost, type ServerRootDescription } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import type { RunProcessSandboxes } from "@ragents/host/plugin-support/process-sandbox.js";
import { FRESH_WORKSPACE_LABEL, isFreshFolder, type ExistingWorkspaceFolder, type WorkspaceBinding } from "../contract.js";
import {
  bindingOf,
  boundServerDirectory,
  currentBindingOf,
  isWorkstationBinding,
  serverDirectoryFolder,
  workspaceOwnerOf,
  type WorkstationBinding,
} from "./binding.js";
import type { WorkspaceClientRegistry } from "./clients.js";

export interface RunWorkspaceRuntimeOptions {
  globalDirectory: string;
  sessionDirectory: (runId: string, ...segments: string[]) => string;
  /** The storage boundary of a run; within it, private work files belong to its account. */
  storageRootFor: (runId: string) => string;
  sessionsDirectoryPattern: string;
  sessionWorkspaceFor: (runId: string) => Promise<SessionWorkspace>;
  skillPaths: () => Promise<readonly string[]>;
  resolver: () => WorkspaceResolver | undefined;
  runState: (runId: string) => RunState | null;
  storeBinding: (runId: string, binding: WorkspaceBinding) => void;
  clients: WorkspaceClientRegistry;
  /** What the profile's plugins contribute to the server's executor; the workstations load the same contributions themselves. */
  contributions: readonly WorkspaceExecutorParts[];
  /** The server's process sandbox; without it, the server's processes run without one. */
  processSandbox?: RunProcessSandboxes;
  /** The server's bash from RAGENTS_BASH; required on Windows for the bash tool. */
  bash?: string;
  /** The server's rg from RAGENTS_RG; without a value, one in the PATH applies. */
  rg?: string;
  /** The bash timeout from RAGENTS_BASH_TIMEOUT_SECONDS; without a value, that of the tool. */
  bashTimeoutSeconds?: number;
}

const runNotStarted = (): DomainError => new DomainError(
  "run-not-started",
  "The run has not started yet; the working directory is created with the first message.",
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

const listed = (entries: readonly string[]): string =>
  entries.length === 1 ? entries[0]! : `${entries.slice(0, -1).join(", ")} and ${entries.at(-1)!}`;

const rootList = (roots: readonly ServerRootDescription[]): string =>
  listed(roots.map((root) => `\`${root.alias}\` (${root.writable ? "read and write" : "read only"})`));

const variableList = (roots: readonly ServerRootDescription[]): string => listed(roots
  .flatMap((root) => root.environmentVariable === undefined ? [] : [`\`$${root.environmentVariable}\` for \`${root.alias}\``]));

const hasVariables = (roots: readonly ServerRootDescription[]): boolean => roots.some((root) => root.environmentVariable !== undefined);

/** On the server, workspace and roots are on one machine; every bash sees both. */
const serverRootsDescription = (roots: readonly ServerRootDescription[]): string => [
  "## Roots besides the working directory",
  "",
  `This run also reaches ${rootList(roots)}. File tools and language servers take a path that starts with the alias, `
    + `such as \`${roots[0]!.alias}/<path>\`; \`bash\` runs in such a root with that path as \`cwd\`.`
    + (hasVariables(roots) ? ` \`bash\` also has ${variableList(roots)}.` : ""),
].join("\n");

/** The roots are on the server, the workspace on the workstation; a bash always sees only one of the two machines. */
const workstationRootsDescription = (roots: readonly ServerRootDescription[]): string => [
  "## Roots on the server",
  "",
  `This run also reaches roots on the server: ${rootList(roots)}. File tools and language servers reach them from the `
    + `workstation as well: pass a path that starts with the alias, such as \`${roots[0]!.alias}/<path>\`. \`bash\` runs on `
    + "the workstation; with a `cwd` that starts with an alias it runs on the server instead and sees only the server"
    + (hasVariables(roots) ? `, and only that bash has ${variableList(roots)}` : "")
    + ". One call reaches one machine: never combine a path with an alias and a path in the working directory in one call.",
].join("\n");

export class RunWorkspaceRuntime implements WorkspaceRuntime {
  readonly sandbox: WorkspaceSandboxHost;
  readonly toolNaming: WorkspaceToolNaming = sandboxToolNaming;
  readonly transfer: WorkspaceTransfer;
  readonly #options: RunWorkspaceRuntimeOptions;
  readonly #nugetCacheDirectory: string;
  /** The new folders on workstations that have already been created or are in progress during this server run. */
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
      contributions: options.contributions,
      workspaceFor: options.sessionWorkspaceFor,
      identFor: () => Promise.resolve(undefined),
      skillPaths: options.skillPaths,
      storageRootFor: options.storageRootFor,
      homeFor: (runId) => this.#homeFor(runId),
      executorFor: (runId) => Promise.resolve(this.#executorFor(runId)),
      serverDirectoryFor: (runId) => this.#serverDirectoryFor(runId),
      ...(options.processSandbox ? { processSandbox: options.processSandbox } : {}),
      ...(options.bash === undefined ? {} : { bash: options.bash }),
      ...(options.rg === undefined ? {} : { rg: options.rg }),
      ...(options.bashTimeoutSeconds === undefined ? {} : { bashTimeoutSeconds: options.bashTimeoutSeconds }),
    });
  }

  /** Work of a run that runs on the server while its workspace is on a workstation. */
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

  /** On a workstation, its executor runs on behalf of the run owner, otherwise the server's executor. */
  #executorFor(runId: string): WorkspaceExecutor | undefined {
    const state = this.#options.runState(runId);
    const binding = bindingOf(state);
    if (!isWorkstationBinding(binding)) return undefined;
    const { machine, folder } = binding;
    const executor = this.#options.clients.executorFor(workspaceOwnerOf(state), machine.client, machine.label, folder.path);
    return "fresh" in folder ? this.#preparing(state, binding, executor) : executor;
  }

  /** Before the first task of a run, the workstation creates its new folder; cleanup never creates one. */
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

  /** Only a freshly created folder gets the contribution's steps; if one fails, the folder disappears again and the next task starts over. */
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
    const { folder } = binding;
    const onWorkstation = isWorkstationBinding(binding);
    const workspace = onWorkstation ? this.#workstation(runId, state, binding, emitSystem)
      : isFreshFolder(folder) ? await this.#fresh(runId, state, emitSystem) : this.#bound(folder, emitSystem);
    if (workspace.hostSandbox?.ident) await this.sandbox.assertRootsForAccount(runId);
    return this.#withRoots(workspace, onWorkstation);
  }

  /** What the prompt says about roots depends on the run's machine: only a bash on the server knows their variables. */
  async #withRoots(workspace: SessionWorkspace, onWorkstation: boolean): Promise<SessionWorkspace> {
    const roots = await this.sandbox.serverRoots();
    if (roots.length === 0) return workspace;
    const described = onWorkstation ? workstationRootsDescription(roots) : serverRootsDescription(roots);
    return { ...workspace, description: [workspace.description, described].filter(Boolean).join("\n\n") };
  }

  placementOf(runId: string): WorkspacePlacement {
    const { machine, folder } = currentBindingOf(this.#options.clients, this.#options.runState(runId));
    const where = isFreshFolder(folder) ? "fresh" : "existing";
    const placement: WorkspacePlacement = machine === "server"
      ? { machine: "server", folder: where }
      : { machine: "client", workstation: { client: machine.client, label: machine.label }, folder: where };
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
        throw new DomainError("workspace-path-missing", `The bound folder ${cwd} no longer exists on the server.`, 409);
      }
    };
    emitSystem(`Workspace: ${cwd} (project folder on the server)`);
    return {
      cwd,
      description: serverProjectDescription(cwd),
      currentRoot: existing,
      runOperation: (operation) => operation(),
    };
  }

  /** The workspace is on the workstation; the server knows only its path, and every local access to it fails loudly. */
  #workstation(runId: string, state: RunState, binding: WorkstationBinding, emitSystem: (text: string) => void): SessionWorkspace {
    const { machine: { label }, folder } = binding;
    const fresh = "fresh" in folder;
    const workstation = this.#contribution()?.workstation;
    emitSystem(fresh
      ? `Workspace: ${folder.path} (${workstation?.label ?? FRESH_WORKSPACE_LABEL} on the workstation ${label})`
      : `Workspace: ${folder.path} (project folder on the workstation ${label})`);
    const remote = (): Promise<string> => Promise.reject(new Error(
      `The workspace ${folder.path} is on the workstation ${label}, not on the server; `
      + "it is reachable only through the run's executor (SandboxServices.execute).",
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
      throw new Error(`The start option ${resolver.optionId} of the workspace resolver is not stored in the run`);
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

  /** On the server, a new folder including stop and deletion belongs to the contribution; on a workstation, the host cleans it up. */
  #serverContributionFor(runId: string): WorkspaceResolver | undefined {
    const { machine, folder } = bindingOf(this.#options.runState(runId));
    return machine === "server" && isFreshFolder(folder) ? this.#contribution() : undefined;
  }

  /** If the workstation is unreachable, the folder stays there with a notice; the run is deleted anyway. */
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
    console.warn(`The folder ${folder.path} of run ${runId} stays on the workstation ${machine.label} because it was unreachable.`);
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
