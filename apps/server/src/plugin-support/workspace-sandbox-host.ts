import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { Value } from "typebox/value";
import type { ImageContent, TextContent } from "@ragents/ai";
import {
  DomainError,
  serviceToken,
  type Orchestration,
  type RunFunction,
  type PluginContext,
  type ToolContributor,
  type ToolScope,
  type AgentContribution,
} from "@ragents/engine";
import {
  BASH_MAX_TIMEOUT_MS,
  backgroundStatusText,
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createTaskOutputToolDefinition,
  createTaskStopToolDefinition,
  createWriteToolDefinition,
  type BackgroundTaskStatus,
} from "@ragents/agent";
import {
  BACKGROUND_TASK_OPERATIONS,
  WorkspaceOperationError,
  WorkspaceOperationExecutor,
  containsWorkspacePath,
  resolvedWorkspacePath,
  sandboxRunEnvironment,
  workspaceExecutorModules,
  workspaceProcessContext,
  type AddressedRoots,
  type ResolvedWorkspaceRoot,
  type SandboxHomeEnvironment,
  type SeenFile,
  type SessionIdent,
  type WorkspaceExecuteOptions,
  type WorkspaceExecutor,
  type WorkspaceExecutorParts,
  type WorkspaceProcessContext,
} from "@ragents/workspace-executor";
import { hostRoot } from "../host-version.js";
import type { SandboxFolder, SessionWorkspace } from "../ragents/workspace-runtime.js";
import { agentToolFrom, textOf, toolDescriptorFrom, type AgentToolDefinition, type ToolOutput } from "./agent-tool.js";
import type { RunProcessSandboxes } from "./process-sandbox.js";
import { SKILLS_ALIAS, skillRootAlias } from "./skills.js";
import { alwaysAvailable } from "./tool-availability.js";
import { syncWorkspaceOwnership } from "./workspace-ownership.js";

export interface RegisteredWorkspaceRoot {
  id: string;
  alias?: string;
  environmentVariable?: string;
  directoryFor: (runId: string) => string | undefined | Promise<string | undefined>;
  ownershipDirectoryFor?: (runId: string) => string | Promise<string>;
}

/** A root of the server as a prompt names it: its alias, whether tools may write in it, and the variable that names it in a bash on the server. */
export interface ServerRootDescription {
  readonly alias: string;
  readonly writable: boolean;
  readonly environmentVariable?: string;
}

/** The plugins' only access to a run's workspace: an operation runs at the executor of the machine that owns the addressed root. */
export interface SandboxServices {
  execute: (runId: string, operation: string, input: unknown, options?: WorkspaceExecuteOptions) => Promise<unknown>;
  /** The context for work that runs on the server (TypeScript platform, actor programs); never the folder of a workstation. */
  serverProcessContextFor: (runId: string) => Promise<WorkspaceProcessContext>;
  registerWorkspaceRoot: (root: RegisteredWorkspaceRoot) => void;
  shutdown: (runId: string) => Promise<void>;
}

/** A domain error of the executor looks to the caller like any other error of the server. */
export const withDomainCause = (error: unknown): unknown =>
  error instanceof WorkspaceOperationError ? new DomainError(error.code, error.message, error.status) : error;

export const sandboxServicesToken = serviceToken<SandboxServices>("ragents.workspace.sandbox-services");

export interface WorkspaceSandboxHostOptions {
  contributorName: string;
  /** What the profile's plugins contribute to this server's executor; every workstation of the runs carries the same contributions. */
  contributions: readonly WorkspaceExecutorParts[];
  workspaceFor: (runId: string) => Promise<SessionWorkspace>;
  identFor: (runId: string) => Promise<SessionIdent | undefined>;
  skillPaths: () => Promise<readonly string[]>;
  homeFor: (runId: string) => Promise<SandboxHomeEnvironment>;
  storageRootFor?: (runId: string) => string;
  /** The executor of a run that does not work on the server; without an answer the server's executor executes. */
  executorFor?: (runId: string) => Promise<WorkspaceExecutor | undefined>;
  /** The own folder of a run on the server, for work that runs there while its root is on a workstation or gone. */
  serverDirectoryFor?: (runId: string) => Promise<string>;
  /** The process sandbox in which every process of this server's executor starts; without it processes run without one. */
  processSandbox?: RunProcessSandboxes;
  /** The bash of this server's executor; required on Windows, otherwise the system's when not set. */
  bash?: string;
  /** The rg of this server's executor; when not set, one on the PATH applies. */
  rg?: string;
  /** The bash time limit in seconds for calls without their own, on every machine of the runs; when not set, the tool's. */
  bashTimeoutSeconds?: number;
  /** The server's own address for this server's executor; the dial-back of a service of a run on the server opens its leg there. */
  serverAddress?: () => string | undefined;
}

const sandboxDescriptions: Readonly<Record<string, string>> = {
  read: "Read a file with line numbers, or an image, within the run's allowed workspace roots.",
  edit: "Replace an exact string in a file within the run's writable workspace roots.",
  write: "Create or overwrite a file within the run's writable workspace roots.",
  bash: "Execute a shell command in the run's workspace, or with cwd in one of its roots, with sandbox restrictions; run_in_background keeps a service running.",
  task_output: "Read the new output and the status of a background command of bash.",
  task_stop: "Stop a background command of bash.",
};

const describeSandboxTool = (definition: AgentToolDefinition): AgentToolDefinition => {
  const description = sandboxDescriptions[definition.name];
  if (!description) throw new Error(`The sandbox tool ${definition.name} has no short description`);
  return { ...definition, description, longDescription: definition.description };
};

/** The operator names the bash default in seconds, the tool takes milliseconds. */
const bashDefaultTimeoutMs = (seconds: number): number => {
  if (!(seconds > 0) || seconds * 1000 > BASH_MAX_TIMEOUT_MS) {
    throw new Error(`The bash default timeout of ${seconds} seconds is invalid: allowed are more than 0 up to ${BASH_MAX_TIMEOUT_MS / 1000} seconds`);
  }
  return seconds * 1000;
};

const sandboxDefinitions = (bashTimeoutSeconds: number | undefined): readonly AgentToolDefinition[] => [
  createReadToolDefinition("."),
  createEditToolDefinition("."),
  createWriteToolDefinition("."),
  createBashToolDefinition(".", bashTimeoutSeconds === undefined ? {} : { defaultTimeoutMs: bashDefaultTimeoutMs(bashTimeoutSeconds) }),
  createTaskOutputToolDefinition(),
  createTaskStopToolDefinition(),
] as readonly AgentToolDefinition[];

const fileToolNames = new Set(["read", "edit", "write"]);

/** The tools that read and stop a background command; bash starts one only for an actor that has both. */
const taskToolNames: readonly string[] = [BACKGROUND_TASK_OPERATIONS.output, BACKGROUND_TASK_OPERATIONS.stop];

const sequentialTools = new Set(["bash", BACKGROUND_TASK_OPERATIONS.stop]);

/** After a lost connection to a workstation, the server opens the observation of a background command there again after this long. */
const TASK_WAIT_RETRY_MS = 15_000;

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** The workstation was not there or did not answer; its executor and the command may still be running. */
const lostConnection = (error: unknown): boolean =>
  error instanceof DomainError && (error.code === "workspace-client-disconnected" || error.code === "workspace-client-timeout");

const pause = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise((resolve) => {
  const timer = setTimeout(resolve, milliseconds);
  timer.unref();
  signal.addEventListener("abort", () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
});

const taskEndNotice = (id: string, status: BackgroundTaskStatus): string =>
  `Background command ${id} ${backgroundStatusText(status)}. task_output reads what it wrote last.`;

const backgroundToolsMissing = (missing: readonly string[]): DomainError => new DomainError(
  "background-tools-missing",
  `run_in_background needs ${missing.join(" and ")} to read and stop the command, and this actor does not have ${missing.length === 1 ? "it" : "them"}. `
    + "Run the command in the foreground, or ask for an actor with these tools.",
  400,
);

interface StableRunParts {
  ident?: SessionIdent;
  home: SandboxHomeEnvironment;
  readOnlyRoots: readonly ResolvedWorkspaceRoot[];
  /** The run's own temp folder in the sandbox. */
  temporary?: string;
}

const mixedRoots = (aliases: readonly string[]): DomainError => new DomainError(
  "workspace-roots-mixed",
  `The call names ${aliases.join(", ")} on the server and at the same time a path in the workspace on the workstation; `
    + "a call reaches only one machine. Split it into one call per machine.",
  400,
);

/** The folders a workspace additionally opens to the process sandbox, separated by access; a relative path would have no location on the server. */
const sandboxFoldersWith = (folders: readonly SandboxFolder[], access: SandboxFolder["access"]): string[] =>
  folders.filter((folder) => folder.access === access).map((folder) => {
    if (!path.isAbsolute(folder.directory)) throw new Error(`The folder ${folder.directory} for the process sandbox must be absolute`);
    return folder.directory;
  });

const rootOutsideStorage = (name: string): DomainError => new DomainError(
  "workspace-root-outside-storage",
  `The run works under its own account, and the server hands files to that account only inside the run storage; the root ${name} lies outside it. `
    + "Place that root inside the run storage or run without an account switch.",
  409,
);

/** A read-only path that does not exist is not a root; a missing skill folder must not prevent a run. */
const existingRoots = async (roots: readonly ResolvedWorkspaceRoot[]): Promise<ResolvedWorkspaceRoot[]> => {
  const resolved = await Promise.all(roots.map((root) =>
    realpath(root.directory).then((directory) => ({ ...root, directory }), () => undefined)));
  return resolved.filter((root) => root !== undefined);
};

/** The server's executor with the server's roots; an operation with an alias runs there, every other one at the executor of the run's binding. */
export class WorkspaceSandboxHost implements SandboxServices {
  readonly #options: WorkspaceSandboxHostOptions;
  readonly #definitions: readonly AgentToolDefinition[];
  readonly #workspaceRoots: RegisteredWorkspaceRoot[] = [];
  readonly #local: WorkspaceOperationExecutor;
  /** The server's executor for the server's roots of a run on the server whose own root is gone. */
  readonly #serverRoots: WorkspaceOperationExecutor;
  /** The runs that used it; only they have something to stop there. */
  readonly #withoutRoot = new Set<string>();
  readonly #stable = new Map<string, Promise<StableRunParts>>();
  /** Per run the file state a model saw last, by actor, model context and path; only in memory, a loss requires at most a new read. */
  readonly #seen = new Map<string, Map<string, SeenFile>>();
  readonly #readImages = new Map<string, Map<string, { content: (TextContent | ImageContent)[]; seenKey: string; seen: SeenFile }>>();
  /** Per run the executor that started each background command; without an entry the executor of the binding holds it. */
  readonly #tasks = new Map<string, Map<string, WorkspaceExecutor>>();
  /** Per run the observations of the ends of its background commands; the stop of the run ends them before any process ends. */
  readonly #taskWatches = new Map<string, AbortController>();
  /** Per run the IDs whose end an observation is waiting for; a workstation that signs in again names them once more. */
  readonly #observed = new Map<string, Set<string>>();

  constructor(options: WorkspaceSandboxHostOptions) {
    this.#options = options;
    this.#definitions = sandboxDefinitions(options.bashTimeoutSeconds);
    this.#local = new WorkspaceOperationExecutor({
      contextFor: (runId) => this.serverProcessContextFor(runId),
      modules: workspaceExecutorModules({
        contributions: options.contributions,
        ...(options.serverAddress ? { serverAddress: options.serverAddress } : {}),
      }),
    });
    this.#serverRoots = new WorkspaceOperationExecutor({
      contextFor: (runId) => this.#serverRootsContextFor(runId),
      modules: workspaceExecutorModules({ contributions: options.contributions }),
    });
  }

  registerWorkspaceRoot(root: RegisteredWorkspaceRoot): void {
    if (!root.id.trim() || this.#workspaceRoots.some((entry) => entry.id === root.id)) {
      throw new Error(`Working directory ${root.id} is empty or already registered`);
    }
    if (root.alias && (!/^@[a-z][a-z0-9-]*$/.test(root.alias) || root.alias === SKILLS_ALIAS
      || this.#workspaceRoots.some((entry) => entry.alias === root.alias))) {
      throw new Error(`Working directory alias ${root.alias} is invalid, reserved for the host or already registered`);
    }
    if (root.environmentVariable && (!/^RAGENTS_[A-Z_]+_DIR$/.test(root.environmentVariable) || this.#workspaceRoots.some((entry) => entry.environmentVariable === root.environmentVariable))) {
      throw new Error(`Working directory variable ${root.environmentVariable} is invalid or already registered`);
    }
    this.#workspaceRoots.push(root);
  }

  async #additionalRoots(runId: string, ident?: SessionIdent): Promise<ResolvedWorkspaceRoot[]> {
    const roots = await Promise.all(this.#workspaceRoots.map(async (entry) => {
      const directory = await entry.directoryFor(runId);
      if (directory === undefined) return undefined;
      if (!path.isAbsolute(directory)) throw new Error(`Working directory ${entry.id} must be absolute`);
      if (ident) await syncWorkspaceOwnership(await this.#ownedDirectory(runId, entry, directory), {
        ...ident, storageRoot: this.#options.storageRootFor?.(runId),
      });
      return { directory: await resolvedWorkspacePath(directory), alias: entry.alias, environmentVariable: entry.environmentVariable };
    }));
    return roots.filter((root) => root !== undefined);
  }

  /** The folder an account switch hands to the run's account; outside the run storage it refuses, without a storage the sync names that. */
  async #ownedDirectory(runId: string, entry: RegisteredWorkspaceRoot, directory: string): Promise<string> {
    const owned = await entry.ownershipDirectoryFor?.(runId) ?? directory;
    const storageRoot = this.#options.storageRootFor?.(runId);
    if (storageRoot === undefined) return owned;
    const [boundary, target] = await Promise.all([resolvedWorkspacePath(storageRoot), resolvedWorkspacePath(owned)]);
    if (!containsWorkspacePath(boundary, target) || target === boundary) throw rootOutsideStorage(entry.alias ?? entry.id);
    return owned;
  }

  /** Checks at the start of a run with an account switch what every server context of it needs: each registered root inside its run storage. */
  async assertRootsForAccount(runId: string): Promise<void> {
    for (const entry of this.#workspaceRoots) {
      const directory = await entry.directoryFor(runId);
      if (directory !== undefined) await this.#ownedDirectory(runId, entry, directory);
    }
  }

  /** The server's roots with an alias that a run reaches besides its workspace: the registered ones and the skill folders. */
  async serverRoots(): Promise<readonly ServerRootDescription[]> {
    const registered = this.#workspaceRoots.flatMap(({ alias, environmentVariable }) => alias === undefined ? [] : [{
      alias, writable: true, ...(environmentVariable === undefined ? {} : { environmentVariable }),
    }]);
    const skills = (await this.#options.skillPaths()).length > 0 ? [{ alias: SKILLS_ALIAS, writable: false }] : [];
    return [...registered, ...skills];
  }

  /** For a run with its own executor a folder of the run on the server, otherwise the same context as for its tools. */
  async serverProcessContextFor(runId: string): Promise<WorkspaceProcessContext> {
    if (!await this.#options.executorFor?.(runId)) return this.#contextFor(runId);
    return this.#contextFor(runId, await this.#serverDirectory(runId, "does not work on the server"));
  }

  /** The server's roots of a run whose own root is gone, with the run's folder on the server in place of that root, as for a run on a workstation. */
  async #serverRootsContextFor(runId: string): Promise<WorkspaceProcessContext> {
    return this.#contextFor(runId, await this.#serverDirectory(runId, "has lost its root"));
  }

  #serverDirectory(runId: string, reason: string): Promise<string> {
    const serverDirectoryFor = this.#options.serverDirectoryFor;
    if (!serverDirectoryFor) throw new Error(`The run ${runId} ${reason}, and the sandbox host knows no server folder for it`);
    return serverDirectoryFor(runId);
  }

  /** The context of this server's executor; without its own folder the workspace itself, which must then lie on the server. */
  async #contextFor(runId: string, serverDirectory?: string): Promise<WorkspaceProcessContext> {
    const workspace = await this.#options.workspaceFor(runId);
    const { ident, home, readOnlyRoots, temporary } = await this.#stableParts(runId, workspace);
    const root = serverDirectory ?? await workspace.currentRoot();
    const additionalRoots = await this.#additionalRoots(runId, ident);
    const folders = workspace.sandboxFolders ?? [];
    const sandbox = this.#options.processSandbox && temporary !== undefined
      ? this.#options.processSandbox.forRun({
        writable: [
          root, ...additionalRoots.map((entry) => entry.directory), home.home, ...home.nugetPackages ? [home.nugetPackages] : [],
          ...sandboxFoldersWith(folders, "write"),
        ],
        readable: [
          ...readOnlyRoots.map((entry) => entry.directory), ...this.#options.storageRootFor ? [this.#options.storageRootFor(runId)] : [],
          ...sandboxFoldersWith(folders, "read"),
        ],
        temporary,
      })
      : undefined;
    return workspaceProcessContext({
      runId,
      cwd: serverDirectory ?? workspace.cwd,
      root,
      home,
      logDirectory: home.home,
      hostRoot: hostRoot(),
      ...(ident ? { ident } : {}),
      additionalRoots,
      readOnlyRoots,
      additions: sandboxRunEnvironment(runId, workspace),
      runOperation: workspace.runOperation,
      ...(sandbox ? { sandbox } : {}),
      ...(this.#options.bash === undefined ? {} : { bash: this.#options.bash }),
      ...(this.#options.rg === undefined ? {} : { rg: this.#options.rg }),
    });
  }

  /** A run's temp folder lies in its storage so that it vanishes with the run and no other run sees it. */
  async #temporaryFor(runId: string, ident: SessionIdent | undefined): Promise<string | undefined> {
    if (!this.#options.processSandbox) return undefined;
    const storageRoot = this.#options.storageRootFor?.(runId);
    if (!storageRoot) throw new Error(`The process sandbox needs the storage of the run ${runId} for its temp folder`);
    const directory = path.join(storageRoot, "tmp");
    await mkdir(directory, { recursive: true });
    if (ident) await syncWorkspaceOwnership(directory, { ...ident, storageRoot });
    return realpath(directory);
  }

  /** Identity, home folder and read-only roots are fixed per run; only they are remembered. */
  #stableParts(runId: string, workspace: SessionWorkspace): Promise<StableRunParts> {
    const known = this.#stable.get(runId);
    if (known) return known;
    const created = this.#resolveStableParts(runId, workspace).catch((error: unknown) => {
      this.#stable.delete(runId);
      throw error;
    });
    this.#stable.set(runId, created);
    return created;
  }

  async #resolveStableParts(runId: string, workspace: SessionWorkspace): Promise<StableRunParts> {
    if (workspace.hostSandbox) {
      const { home, ident } = workspace.hostSandbox;
      const temporary = await this.#temporaryFor(runId, ident);
      return {
        ...(ident ? { ident } : {}),
        home: { home },
        readOnlyRoots: await existingRoots(workspace.hostSandbox.readOnlyRoots),
        ...(temporary ? { temporary } : {}),
      };
    }
    const [ident, home, skills] = await Promise.all([
      this.#options.identFor(runId),
      this.#options.homeFor(runId),
      this.#options.skillPaths(),
    ]);
    const temporary = await this.#temporaryFor(runId, ident);
    return {
      ...(ident ? { ident } : {}),
      home,
      readOnlyRoots: await existingRoots(skills.map((directory) => ({ directory, alias: skillRootAlias(path.basename(directory)) }))),
      ...(temporary ? { temporary } : {}),
    };
  }

  workspaceTools(): ToolContributor {
    return {
      name: this.#options.contributorName,
      descriptors: this.#definitions.map((definition) => toolDescriptorFrom(describeSandboxTool(definition), alwaysAvailable)),
      tools: (context) => this.#workspaceToolsFor(context),
    };
  }

  readImageContribution(): AgentContribution {
    return {
      id: `${this.#options.contributorName}.read-image`,
      afterToolCall: ({ runId, agentId }, outcome, call) => {
        if (outcome.toolName !== "read" || !outcome.toolCallId) return undefined;
        const images = this.#readImages.get(runId);
        const key = `${agentId}\0${outcome.toolCallId}`;
        const image = images?.get(key);
        images?.delete(key);
        if (!image || outcome.isError) return undefined;
        if (call.modelReadsImages) {
          this.#seen.get(runId)?.set(image.seenKey, image.seen);
          return { content: image.content };
        }
        return {
          content: [{ type: "text", text: "This model cannot see images; ask the user or use a model with image input" }],
          isError: true,
        };
      },
    };
  }

  /** The duration an input asks for itself applies when the caller names none; it only extends the wait for a remote executor. */
  async execute(runId: string, operation: string, input: unknown, options: WorkspaceExecuteOptions = {}): Promise<unknown> {
    try {
      const { executor, timed } = await this.#placed(runId, operation, input, options);
      return await executor.execute(runId, operation, input, timed);
    } catch (error) {
      throw withDomainCause(error);
    }
  }

  /** The executor of the machine that owns the addressed root, and the options with the duration of the input. */
  async #placed(runId: string, operation: string, input: unknown, options: WorkspaceExecuteOptions): Promise<{
    executor: WorkspaceExecutor;
    timed: WorkspaceExecuteOptions;
  }> {
    const { roots, durationMs } = this.#local.footprintOf(operation, input);
    const executor = await this.#executorFor(runId, roots);
    return { executor, timed: options.durationMs === undefined && durationMs !== undefined ? { ...options, durationMs } : options };
  }

  /** A run with its own executor also has marked TypeScript platform processes on the server; every executor cleans up. */
  async shutdown(runId: string): Promise<void> {
    // The observations end first, so that no end of a command the stop causes reaches an actor.
    this.#taskWatches.get(runId)?.abort();
    this.#taskWatches.delete(runId);
    this.#observed.delete(runId);
    this.#tasks.delete(runId);
    this.#stable.delete(runId);
    this.#seen.delete(runId);
    this.#readImages.delete(runId);
    const remote = await this.#options.executorFor?.(runId);
    const withoutRoot = this.#withoutRoot.has(runId);
    this.#withoutRoot.delete(runId);
    const results = await Promise.allSettled([
      this.#local.stopRun(runId), ...(withoutRoot ? [this.#serverRoots.stopRun(runId)] : []), ...(remote ? [remote.stopRun(runId)] : []),
    ]);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  async shutdownAll(): Promise<void> {
    for (const watches of this.#taskWatches.values()) watches.abort();
    this.#taskWatches.clear();
    this.#observed.clear();
    this.#tasks.clear();
    this.#stable.clear();
    this.#seen.clear();
    this.#readImages.clear();
    this.#withoutRoot.clear();
    const results = await Promise.allSettled([this.#local.shutdown(), this.#serverRoots.shutdown()]);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  /** Aliases name roots of the server, every other path the run's root on the machine of its binding; without an alias the binding decides. */
  async #executorFor(runId: string, { aliases, runRoot }: AddressedRoots): Promise<WorkspaceExecutor> {
    const bound = await this.#options.executorFor?.(runId);
    if (!bound) return aliases.length > 0 && !runRoot && !await this.#hasRoot(runId) ? this.#withoutRootFor(runId) : this.#local;
    if (aliases.length === 0) return bound;
    if (runRoot) throw mixedRoots(aliases);
    return this.#local;
  }

  #withoutRootFor(runId: string): WorkspaceExecutor {
    this.#withoutRoot.add(runId);
    return this.#serverRoots;
  }

  /** Whether the run's own root is there; an operation that names only roots of the server does not need it, every other one reports why it is missing. */
  async #hasRoot(runId: string): Promise<boolean> {
    const workspace = await this.#options.workspaceFor(runId);
    return workspace.currentRoot().then(() => true, () => false);
  }

  #workspaceToolsFor(context: PluginContext): Promise<RunFunction[]> {
    return Promise.resolve(this.#definitions.map((definition) => {
      const described = describeSandboxTool(definition);
      const proxy = {
        ...described,
        // The server fills in the schema defaults, such as the bash time limit; so what the model sees in the schema applies on every machine.
        execute: (toolCallId: string, params: unknown, signal: AbortSignal | undefined) =>
          this.execute(context.runId, described.name, Value.Default(described.parameters, structuredClone(params)), {
            toolCallId,
            ...(signal ? { signal } : {}),
          }),
      } as AgentToolDefinition;
      const tool = agentToolFrom(proxy, alwaysAvailable, sequentialTools.has(described.name) ? "sequential" : "parallel");
      if (fileToolNames.has(described.name)) {
        return { ...tool, run: (scope: ToolScope, toolCallId: string, input: never) => this.#fileToolCall(context.runId, described.name, scope, toolCallId, input) };
      }
      if (described.name === "bash") {
        return { ...tool, run: (scope: ToolScope, toolCallId: string, input: never) => this.#bashCall(context.runId, described, scope, toolCallId, input) };
      }
      return taskToolNames.includes(described.name)
        ? { ...tool, run: (scope: ToolScope, toolCallId: string, input: never) => this.#taskCall(context.runId, described.name, scope, toolCallId, input) }
        : tool;
    }));
  }

  /** A background command stays with the executor that started it, which keeps the calling actor as its starter; the server remembers the executor and observes the end for that actor. */
  async #bashCall(runId: string, definition: AgentToolDefinition, scope: ToolScope, toolCallId: string, input: object): Promise<string> {
    const params = Value.Default(definition.parameters, structuredClone(input)) as { run_in_background?: boolean };
    const options = { toolCallId, ...(scope.signal ? { signal: scope.signal } : {}) };
    if (params.run_in_background !== true) return textOf(await this.execute(runId, "bash", params, options) as ToolOutput);
    const available = new Set(scope.availableFunctions().map((fn) => fn.name));
    const missing = taskToolNames.filter((name) => !available.has(name));
    if (missing.length > 0) throw backgroundToolsMissing(missing);
    try {
      const started = { ...params, startedBy: scope.caller.actorId };
      const { executor, timed } = await this.#placed(runId, "bash", started, options);
      const result = await executor.execute(runId, "bash", started, timed) as ToolOutput & { details?: { backgroundTaskId?: unknown } };
      const id = result.details?.backgroundTaskId;
      if (typeof id !== "string") throw new Error("The executor reports no ID for the background command; server and workstation need the same executor version");
      this.observeBackgroundTask(runId, id, executor, scope.runtime, scope.caller.actorId);
      return textOf(result);
    } catch (error) {
      throw withDomainCause(error);
    }
  }

  /** The executor that started the command answers; after a server restart only the binding's executor can still hold one. */
  async #taskCall(runId: string, name: string, scope: ToolScope, toolCallId: string, input: { task_id: string }): Promise<string> {
    const options = { toolCallId, ...(scope.signal ? { signal: scope.signal } : {}) };
    try {
      const executor = this.#tasks.get(runId)?.get(input.task_id) ?? (await this.#placed(runId, name, input, options)).executor;
      return textOf(await executor.execute(runId, name, input, options) as ToolOutput);
    } catch (error) {
      throw withDomainCause(error);
    }
  }

  /** Observes the end of a background command for the actor that started it; one the server already observes stays with that observation. */
  observeBackgroundTask(runId: string, id: string, executor: WorkspaceExecutor, runtime: Orchestration, startedBy: string): void {
    this.#tasksOf(runId).set(id, executor);
    const observed = this.#observed.get(runId) ?? new Set<string>();
    if (observed.has(id)) return;
    this.#observed.set(runId, observed.add(id));
    void this.#observeTask(runId, id, executor, runtime, startedBy).finally(() => this.#observed.get(runId)?.delete(id));
  }

  #tasksOf(runId: string): Map<string, WorkspaceExecutor> {
    const known = this.#tasks.get(runId) ?? new Map<string, WorkspaceExecutor>();
    this.#tasks.set(runId, known);
    return known;
  }

  #taskWatchOf(runId: string): AbortController {
    const known = this.#taskWatches.get(runId) ?? new AbortController();
    this.#taskWatches.set(runId, known);
    return known;
  }

  /** The executor reports the end as the result of an observation; a lost connection to a workstation opens it again, the stop of the run ends it. */
  async #observeTask(runId: string, id: string, executor: WorkspaceExecutor, runtime: Orchestration, actorId: string): Promise<void> {
    const { signal } = this.#taskWatchOf(runId);
    for (;;) {
      try {
        const status = await executor.execute(runId, BACKGROUND_TASK_OPERATIONS.wait, { task_id: id }, { signal, untilAborted: true }) as BackgroundTaskStatus;
        if (!signal.aborted && status.state === "exited" && !status.stopped) this.#notify(runtime, runId, actorId, id, taskEndNotice(id, status));
        return;
      } catch (error) {
        if (signal.aborted) return;
        if (!lostConnection(withDomainCause(error))) {
          this.#notify(runtime, runId, actorId, id, `Background command ${id} can no longer be observed: ${messageOf(error)}`);
          return;
        }
        await pause(TASK_WAIT_RETRY_MS, signal);
        if (signal.aborted) return;
      }
    }
  }

  /** The actor that started the command learns of its end as a background input in the owner's name. */
  #notify(runtime: Orchestration, runId: string, actorId: string, id: string, content: string): void {
    try {
      runtime.enqueueInput(
        { actorId: runtime.state(runId).ownerId, commandId: `${this.#options.contributorName}:task-end:${id}:${randomUUID()}` },
        runId,
        { actorId, presentation: "background", content },
      );
    } catch (error) {
      console.warn(`The end of background command ${id} in run ${runId} did not reach its actor: ${messageOf(error)}`);
    }
  }

  /** A direct call of the model passes the state it has seen of the file and remembers the new one; a call from TypeScript works without it. */
  async #fileToolCall(runId: string, name: string, scope: ToolScope, toolCallId: string, input: { file_path: string }): Promise<string> {
    const options = { toolCallId, ...(scope.signal ? { signal: scope.signal } : {}) };
    if (scope.modelContext === undefined) return textOf(await this.execute(runId, name, input, options) as ToolOutput);
    const known = this.#seen.get(runId) ?? new Map<string, SeenFile>();
    this.#seen.set(runId, known);
    const key = [scope.caller.actorId, scope.modelContext, path.posix.normalize(input.file_path)].join("\0");
    const result = await this.execute(runId, name, { ...input, seen: known.get(key) ?? null }, options) as {
      content: (TextContent | ImageContent)[];
      details?: { seen?: SeenFile; imageMimeType?: string };
    };
    const seen = result.details?.seen;
    if (!seen) throw new Error(`The executor reports no file state after ${name}; server and workstation need the same executor version`);
    if (name === "read" && (result.details?.imageMimeType || result.content.some((part) => part.type === "image"))) {
      const images = this.#readImages.get(runId) ?? new Map();
      this.#readImages.set(runId, images);
      images.set(`${scope.caller.actorId}\0${toolCallId}`, { content: result.content, seenKey: key, seen });
    } else {
      known.set(key, seen);
    }
    return textOf(result);
  }
}
