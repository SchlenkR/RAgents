import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  DomainError,
  serviceToken,
  type RunFunction,
  type PluginContext,
  type ToolContributor,
} from "@ragents/engine";
import {
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
  type ResolvedWorkspaceRoot,
  type SandboxHomeEnvironment,
  type SessionIdent,
  type WorkspaceExecuteOptions,
  type WorkspaceExecutor,
  type WorkspaceProcessContext,
} from "@ragents/workspace-executor";
import { hostRoot } from "../host-version.js";
import type { SessionWorkspace } from "../ragents/workspace-runtime.js";
import { agentToolFrom, toolDescriptorFrom, type AgentToolDefinition } from "./agent-tool.js";
import { alwaysAvailable } from "./tool-availability.js";
import { syncWorkspaceOwnership } from "./workspace-ownership.js";

export interface RegisteredWorkspaceRoot {
  id: string;
  alias?: string;
  environmentVariable?: string;
  directoryFor: (runId: string) => string | undefined | Promise<string | undefined>;
  ownershipDirectoryFor?: (runId: string) => string | Promise<string>;
}

/** Der einzige Zugang der Plugins zum Arbeitsbereich eines Runs: seine Operationen laufen beim Executor, den die Bindung bestimmt. */
export interface SandboxServices {
  execute: (runId: string, operation: string, input: unknown, options?: WorkspaceExecuteOptions) => Promise<unknown>;
  /** Der Kontext für Arbeit, die auf dem Server läuft (TypeScript-Plattform, Actor-Programme); nie der Ordner eines Arbeitsplatzes. */
  serverProcessContextFor: (runId: string) => Promise<WorkspaceProcessContext>;
  registerWorkspaceRoot: (root: RegisteredWorkspaceRoot) => void;
  shutdown: (runId: string) => Promise<void>;
}

/** Ein fachlicher Fehler des Executors sieht beim Aufrufer aus wie jeder andere Fehler des Servers. */
export const withDomainCause = (error: unknown): unknown =>
  error instanceof WorkspaceOperationError ? new DomainError(error.code, error.message, error.status) : error;

export const sandboxServicesToken = serviceToken<SandboxServices>("ragents.workspace.sandbox-services");

export interface WorkspaceSandboxHostOptions {
  contributorName: string;
  workspaceFor: (runId: string) => Promise<SessionWorkspace>;
  identFor: (runId: string) => Promise<SessionIdent | undefined>;
  skillPaths: () => Promise<readonly string[]>;
  homeFor: (runId: string) => Promise<SandboxHomeEnvironment>;
  storageRootFor?: (runId: string) => string;
  /** Der Executor eines Runs, der nicht auf dem Server arbeitet; ohne Antwort führt der Executor des Servers aus. */
  executorFor?: (runId: string) => Promise<WorkspaceExecutor | undefined>;
  /** Der eigene Ordner eines solchen Runs auf dem Server, für Arbeit, die dort läuft. */
  serverDirectoryFor?: (runId: string) => Promise<string>;
}

const sandboxDescriptions: Readonly<Record<string, string>> = {
  read: "Read file contents or images within the run's allowed workspace roots.",
  edit: "Apply exact text replacements to existing files within the run's writable workspace roots.",
  write: "Create or overwrite files within the run's writable workspace roots.",
  bash: "Execute shell commands in the run's workspace with sandbox restrictions.",
};

const describeSandboxTool = (definition: AgentToolDefinition): AgentToolDefinition => {
  const description = sandboxDescriptions[definition.name];
  if (!description) throw new Error(`Das Sandbox-Werkzeug ${definition.name} hat keine Kurzbeschreibung`);
  return { ...definition, description, longDescription: definition.description, nativeTool: true };
};

const sandboxDescriptorDefinitions = [
  createReadToolDefinition("."),
  createEditToolDefinition("."),
  createWriteToolDefinition("."),
  createBashToolDefinition("."),
] as readonly AgentToolDefinition[];

const sandboxDescriptors = sandboxDescriptorDefinitions.map((definition) =>
  toolDescriptorFrom(describeSandboxTool(definition), alwaysAvailable));

/** Eine ausdrücklich verlangte Bash-Zeitgrenze verlängert, wie lange ein entfernter Executor warten darf. */
const durationOf = (tool: string, params: unknown): { durationMs?: number } => {
  const seconds = tool === "bash" ? (params as { timeout?: unknown } | null)?.timeout : undefined;
  return typeof seconds === "number" && seconds > 0 ? { durationMs: seconds * 1000 } : {};
};

interface StableRunParts {
  ident?: SessionIdent;
  home: SandboxHomeEnvironment;
  readOnlyRoots: readonly ResolvedWorkspaceRoot[];
}

/** Ein nur lesbarer Pfad, den es nicht gibt, ist keine Wurzel; ein fehlender Skill-Ordner darf keinen Run verhindern. */
const existingRoots = async (roots: readonly ResolvedWorkspaceRoot[]): Promise<ResolvedWorkspaceRoot[]> => {
  const resolved = await Promise.all(roots.map((root) =>
    realpath(root.directory).then((directory) => ({ ...root, directory }), () => undefined)));
  return resolved.filter((root) => root !== undefined);
};

/** Der Executor des Servers, seine Wurzeln und die Weiterreichung der Arbeitsplatz-Werkzeuge an den Executor des Runs. */
export class WorkspaceSandboxHost implements SandboxServices {
  readonly #options: WorkspaceSandboxHostOptions;
  readonly #workspaceRoots: RegisteredWorkspaceRoot[] = [];
  readonly #local: WorkspaceOperationExecutor;
  readonly #stable = new Map<string, Promise<StableRunParts>>();

  constructor(options: WorkspaceSandboxHostOptions) {
    this.#options = options;
    this.#local = new WorkspaceOperationExecutor({
      contextFor: (runId) => this.#contextFor(runId),
      modules: workspaceExecutorModules(),
    });
  }

  registerWorkspaceRoot(root: RegisteredWorkspaceRoot): void {
    if (!root.id.trim() || this.#workspaceRoots.some((entry) => entry.id === root.id)) {
      throw new Error(`Arbeitsverzeichnis ${root.id} ist leer oder bereits registriert`);
    }
    if (root.alias && (!/^@[a-z][a-z0-9-]*$/.test(root.alias) || this.#workspaceRoots.some((entry) => entry.alias === root.alias))) {
      throw new Error(`Arbeitsverzeichnis-Alias ${root.alias} ist ungültig oder bereits registriert`);
    }
    if (root.environmentVariable && (!/^RAGENTS_[A-Z_]+_DIR$/.test(root.environmentVariable) || this.#workspaceRoots.some((entry) => entry.environmentVariable === root.environmentVariable))) {
      throw new Error(`Arbeitsverzeichnis-Variable ${root.environmentVariable} ist ungültig oder bereits registriert`);
    }
    this.#workspaceRoots.push(root);
  }

  async #additionalRoots(runId: string, ident?: SessionIdent): Promise<ResolvedWorkspaceRoot[]> {
    const roots = await Promise.all(this.#workspaceRoots.map(async (entry) => {
      const directory = await entry.directoryFor(runId);
      if (directory === undefined) return undefined;
      if (!path.isAbsolute(directory)) throw new Error(`Arbeitsverzeichnis ${entry.id} muss absolut sein`);
      if (ident) await syncWorkspaceOwnership(await entry.ownershipDirectoryFor?.(runId) ?? directory, {
        ...ident, storageRoot: this.#options.storageRootFor?.(runId),
      });
      return { directory: await resolvedWorkspacePath(directory), alias: entry.alias, environmentVariable: entry.environmentVariable };
    }));
    return roots.filter((root) => root !== undefined);
  }

  /** Bei einem Run mit eigenem Executor ein Ordner des Runs auf dem Server, sonst derselbe Kontext wie für seine Werkzeuge. */
  async serverProcessContextFor(runId: string): Promise<WorkspaceProcessContext> {
    if (!await this.#options.executorFor?.(runId)) return this.#contextFor(runId);
    const serverDirectoryFor = this.#options.serverDirectoryFor;
    if (!serverDirectoryFor) throw new Error(`Der Run ${runId} arbeitet nicht auf dem Server, und der Sandbox-Host kennt keinen Serverordner für ihn`);
    return this.#contextFor(runId, await serverDirectoryFor(runId));
  }

  /** Der Kontext des Executors dieses Servers; ohne eigenen Ordner der Arbeitsbereich selbst, der dafür auf dem Server liegen muss. */
  async #contextFor(runId: string, serverDirectory?: string): Promise<WorkspaceProcessContext> {
    const workspace = await this.#options.workspaceFor(runId);
    const { ident, home, readOnlyRoots } = await this.#stableParts(runId, workspace);
    return workspaceProcessContext({
      runId,
      cwd: serverDirectory ?? workspace.cwd,
      root: serverDirectory ?? await workspace.currentRoot(),
      home,
      logDirectory: home.home,
      hostRoot: hostRoot(),
      ...(ident ? { ident } : {}),
      additionalRoots: await this.#additionalRoots(runId, ident),
      readOnlyRoots,
      additions: sandboxRunEnvironment(runId, workspace),
      runOperation: workspace.runOperation,
    });
  }

  /** Kennung, Heimatordner und nur lesbare Wurzeln stehen je Run fest; nur sie werden gemerkt. */
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
      return {
        ...(ident ? { ident } : {}),
        home: { home },
        readOnlyRoots: await existingRoots(workspace.hostSandbox.readOnlyRoots),
      };
    }
    const [ident, home, skills] = await Promise.all([
      this.#options.identFor(runId),
      this.#options.homeFor(runId),
      this.#options.skillPaths(),
    ]);
    return { ...(ident ? { ident } : {}), home, readOnlyRoots: await existingRoots(skills.map((directory) => ({ directory }))) };
  }

  workspaceTools(): ToolContributor {
    return {
      name: this.#options.contributorName,
      descriptors: sandboxDescriptors,
      tools: (context) => this.#workspaceToolsFor(context),
    };
  }

  async execute(runId: string, operation: string, input: unknown, options: WorkspaceExecuteOptions = {}): Promise<unknown> {
    const executor = await this.#executorFor(runId);
    try {
      return await executor.execute(runId, operation, input, options);
    } catch (error) {
      throw withDomainCause(error);
    }
  }

  /** Auch ein Run mit eigenem Executor hat auf dem Server markierte Prozesse der TypeScript-Plattform; beide Executoren räumen ab. */
  async shutdown(runId: string): Promise<void> {
    this.#stable.delete(runId);
    const remote = await this.#options.executorFor?.(runId);
    const results = await Promise.allSettled([this.#local.stopRun(runId), ...(remote ? [remote.stopRun(runId)] : [])]);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  shutdownAll(): Promise<void> {
    this.#stable.clear();
    return this.#local.shutdown();
  }

  async #executorFor(runId: string): Promise<WorkspaceExecutor> {
    return await this.#options.executorFor?.(runId) ?? this.#local;
  }

  #workspaceToolsFor(context: PluginContext): Promise<RunFunction[]> {
    return Promise.resolve(sandboxDescriptorDefinitions.map((definition) => {
      const described = describeSandboxTool(definition);
      const proxy = {
        ...described,
        execute: (toolCallId: string, params: unknown, signal: AbortSignal | undefined) =>
          this.execute(context.runId, described.name, params, {
            toolCallId,
            ...(signal ? { signal } : {}),
            ...durationOf(described.name, params),
          }),
      } as AgentToolDefinition;
      return agentToolFrom(proxy, alwaysAvailable, described.name === "bash" ? "sequential" : "parallel");
    }));
  }
}
