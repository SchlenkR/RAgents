import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { Value } from "typebox/value";
import {
  DomainError,
  serviceToken,
  type RunFunction,
  type PluginContext,
  type ToolContributor,
  type ToolScope,
} from "@ragents/engine";
import {
  BASH_MAX_TIMEOUT_MS,
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@ragents/agent";
import {
  WorkspaceOperationError,
  WorkspaceOperationExecutor,
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
  /** The own folder of such a run on the server, for work that runs there. */
  serverDirectoryFor?: (runId: string) => Promise<string>;
  /** The process sandbox in which every process of this server's executor starts; without it processes run without one. */
  processSandbox?: RunProcessSandboxes;
  /** The bash of this server's executor; required on Windows, otherwise the system's when not set. */
  bash?: string;
  /** The rg of this server's executor; when not set, one on the PATH applies. */
  rg?: string;
  /** The bash time limit in seconds for calls without their own, on every machine of the runs; when not set, the tool's. */
  bashTimeoutSeconds?: number;
}

const sandboxDescriptions: Readonly<Record<string, string>> = {
  read: "Read a file with line numbers, or an image, within the run's allowed workspace roots.",
  edit: "Replace an exact string in a file within the run's writable workspace roots.",
  write: "Create or overwrite a file within the run's writable workspace roots.",
  bash: "Execute a shell command in the run's workspace, or with cwd in one of its roots, with sandbox restrictions.",
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
] as readonly AgentToolDefinition[];

const fileToolNames = new Set(["read", "edit", "write"]);

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
  readonly #stable = new Map<string, Promise<StableRunParts>>();
  /** Per run the file state a model saw last, by actor, model context and path; only in memory, a loss requires at most a new read. */
  readonly #seen = new Map<string, Map<string, SeenFile>>();

  constructor(options: WorkspaceSandboxHostOptions) {
    this.#options = options;
    this.#definitions = sandboxDefinitions(options.bashTimeoutSeconds);
    this.#local = new WorkspaceOperationExecutor({
      contextFor: (runId) => this.serverProcessContextFor(runId),
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
      if (ident) await syncWorkspaceOwnership(await entry.ownershipDirectoryFor?.(runId) ?? directory, {
        ...ident, storageRoot: this.#options.storageRootFor?.(runId),
      });
      return { directory: await resolvedWorkspacePath(directory), alias: entry.alias, environmentVariable: entry.environmentVariable };
    }));
    return roots.filter((root) => root !== undefined);
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
    const serverDirectoryFor = this.#options.serverDirectoryFor;
    if (!serverDirectoryFor) throw new Error(`The run ${runId} does not work on the server, and the sandbox host knows no server folder for it`);
    return this.#contextFor(runId, await serverDirectoryFor(runId));
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

  /** The duration an input asks for itself applies when the caller names none; it only extends the wait for a remote executor. */
  async execute(runId: string, operation: string, input: unknown, options: WorkspaceExecuteOptions = {}): Promise<unknown> {
    try {
      const { roots, durationMs } = this.#local.footprintOf(operation, input);
      const executor = await this.#executorFor(runId, roots);
      const timed = options.durationMs === undefined && durationMs !== undefined ? { ...options, durationMs } : options;
      return await executor.execute(runId, operation, input, timed);
    } catch (error) {
      throw withDomainCause(error);
    }
  }

  /** A run with its own executor also has marked TypeScript platform processes on the server; both executors clean up. */
  async shutdown(runId: string): Promise<void> {
    this.#stable.delete(runId);
    this.#seen.delete(runId);
    const remote = await this.#options.executorFor?.(runId);
    const results = await Promise.allSettled([this.#local.stopRun(runId), ...(remote ? [remote.stopRun(runId)] : [])]);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  shutdownAll(): Promise<void> {
    this.#stable.clear();
    this.#seen.clear();
    return this.#local.shutdown();
  }

  /** Aliases name roots of the server, every other path the run's root on the machine of its binding; without an alias the binding decides. */
  async #executorFor(runId: string, { aliases, runRoot }: AddressedRoots): Promise<WorkspaceExecutor> {
    const bound = await this.#options.executorFor?.(runId);
    if (!bound || aliases.length === 0) return bound ?? this.#local;
    if (runRoot) throw mixedRoots(aliases);
    return this.#local;
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
      const tool = agentToolFrom(proxy, alwaysAvailable, described.name === "bash" ? "sequential" : "parallel");
      return fileToolNames.has(described.name)
        ? { ...tool, run: (scope: ToolScope, toolCallId: string, input: never) => this.#fileToolCall(context.runId, described.name, scope, toolCallId, input) }
        : tool;
    }));
  }

  /** A direct call of the model passes the state it has seen of the file and remembers the new one; a call from TypeScript works without it. */
  async #fileToolCall(runId: string, name: string, scope: ToolScope, toolCallId: string, input: { file_path: string }): Promise<string> {
    const options = { toolCallId, ...(scope.signal ? { signal: scope.signal } : {}) };
    if (scope.modelContext === undefined) return textOf(await this.execute(runId, name, input, options) as ToolOutput);
    const known = this.#seen.get(runId) ?? new Map<string, SeenFile>();
    const key = [scope.caller.actorId, scope.modelContext, path.posix.normalize(input.file_path)].join("\0");
    const result = await this.execute(runId, name, { ...input, seen: known.get(key) ?? null }, options) as ToolOutput & { details?: { seen?: SeenFile } };
    const seen = result.details?.seen;
    if (!seen) throw new Error(`The executor reports no file state after ${name}; server and workstation need the same executor version`);
    this.#seen.set(runId, known.set(key, seen));
    return textOf(result);
  }
}
