import { mkdir, realpath } from "node:fs/promises";
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
  type AddressedRoots,
  type ResolvedWorkspaceRoot,
  type SandboxHomeEnvironment,
  type SessionIdent,
  type WorkspaceExecuteOptions,
  type WorkspaceExecutor,
  type WorkspaceProcessContext,
} from "@ragents/workspace-executor";
import { hostRoot } from "../host-version.js";
import type { SandboxFolder, SessionWorkspace } from "../ragents/workspace-runtime.js";
import { agentToolFrom, toolDescriptorFrom, type AgentToolDefinition } from "./agent-tool.js";
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

/** Eine Wurzel des Servers, wie ein Prompt sie nennt: ihr Alias, ob Werkzeuge darin schreiben dürfen, und die Variable, die sie in einer Bash auf dem Server nennt. */
export interface ServerRootDescription {
  readonly alias: string;
  readonly writable: boolean;
  readonly environmentVariable?: string;
}

/** Der einzige Zugang der Plugins zum Arbeitsbereich eines Runs: eine Operation läuft beim Executor der Maschine, der die angesprochene Wurzel gehört. */
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
  /** Die Prozess-Sandbox, in der jeder Prozess des Executors dieses Servers startet; ohne sie laufen Prozesse ohne. */
  processSandbox?: RunProcessSandboxes;
}

const sandboxDescriptions: Readonly<Record<string, string>> = {
  read: "Read file contents or images within the run's allowed workspace roots.",
  edit: "Apply exact text replacements to existing files within the run's writable workspace roots.",
  write: "Create or overwrite files within the run's writable workspace roots.",
  bash: "Execute shell commands in the run's workspace, or with cwd in one of its roots, with sandbox restrictions.",
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

interface StableRunParts {
  ident?: SessionIdent;
  home: SandboxHomeEnvironment;
  readOnlyRoots: readonly ResolvedWorkspaceRoot[];
  /** Der eigene Temp-Ordner des Runs in der Sandbox. */
  temporary?: string;
}

const mixedRoots = (aliases: readonly string[]): DomainError => new DomainError(
  "workspace-roots-mixed",
  `Der Aufruf nennt ${aliases.join(", ")} auf dem Server und zugleich einen Pfad im Arbeitsbereich auf dem Arbeitsplatz; `
    + "ein Aufruf erreicht nur einen Rechner. Teile ihn in einen Aufruf je Rechner.",
  400,
);

/** Die Ordner, die ein Arbeitsbereich der Prozess-Sandbox zusätzlich öffnet, getrennt nach Zugriff; ein relativer Pfad hätte auf dem Server keinen Ort. */
const sandboxFoldersWith = (folders: readonly SandboxFolder[], access: SandboxFolder["access"]): string[] =>
  folders.filter((folder) => folder.access === access).map((folder) => {
    if (!path.isAbsolute(folder.directory)) throw new Error(`Der Ordner ${folder.directory} für die Prozess-Sandbox muss absolut sein`);
    return folder.directory;
  });

/** Ein nur lesbarer Pfad, den es nicht gibt, ist keine Wurzel; ein fehlender Skill-Ordner darf keinen Run verhindern. */
const existingRoots = async (roots: readonly ResolvedWorkspaceRoot[]): Promise<ResolvedWorkspaceRoot[]> => {
  const resolved = await Promise.all(roots.map((root) =>
    realpath(root.directory).then((directory) => ({ ...root, directory }), () => undefined)));
  return resolved.filter((root) => root !== undefined);
};

/** Der Executor des Servers mit den Wurzeln des Servers; eine Operation mit Alias läuft dort, jede andere beim Executor der Bindung des Runs. */
export class WorkspaceSandboxHost implements SandboxServices {
  readonly #options: WorkspaceSandboxHostOptions;
  readonly #workspaceRoots: RegisteredWorkspaceRoot[] = [];
  readonly #local: WorkspaceOperationExecutor;
  readonly #stable = new Map<string, Promise<StableRunParts>>();

  constructor(options: WorkspaceSandboxHostOptions) {
    this.#options = options;
    this.#local = new WorkspaceOperationExecutor({
      contextFor: (runId) => this.serverProcessContextFor(runId),
      modules: workspaceExecutorModules(),
    });
  }

  registerWorkspaceRoot(root: RegisteredWorkspaceRoot): void {
    if (!root.id.trim() || this.#workspaceRoots.some((entry) => entry.id === root.id)) {
      throw new Error(`Arbeitsverzeichnis ${root.id} ist leer oder bereits registriert`);
    }
    if (root.alias && (!/^@[a-z][a-z0-9-]*$/.test(root.alias) || root.alias === SKILLS_ALIAS
      || this.#workspaceRoots.some((entry) => entry.alias === root.alias))) {
      throw new Error(`Arbeitsverzeichnis-Alias ${root.alias} ist ungültig, dem Host vorbehalten oder bereits registriert`);
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

  /** Die Wurzeln des Servers mit Alias, die ein Run neben seinem Arbeitsbereich erreicht: die registrierten und die Skill-Ordner. */
  async serverRoots(): Promise<readonly ServerRootDescription[]> {
    const registered = this.#workspaceRoots.flatMap(({ alias, environmentVariable }) => alias === undefined ? [] : [{
      alias, writable: true, ...(environmentVariable === undefined ? {} : { environmentVariable }),
    }]);
    const skills = (await this.#options.skillPaths()).length > 0 ? [{ alias: SKILLS_ALIAS, writable: false }] : [];
    return [...registered, ...skills];
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
    });
  }

  /** Der Temp-Ordner eines Runs liegt in seiner Ablage, damit er mit dem Run verschwindet und kein anderer Run ihn sieht. */
  async #temporaryFor(runId: string, ident: SessionIdent | undefined): Promise<string | undefined> {
    if (!this.#options.processSandbox) return undefined;
    const storageRoot = this.#options.storageRootFor?.(runId);
    if (!storageRoot) throw new Error(`Die Prozess-Sandbox braucht die Ablage des Runs ${runId} für seinen Temp-Ordner`);
    const directory = path.join(storageRoot, "tmp");
    await mkdir(directory, { recursive: true });
    if (ident) await syncWorkspaceOwnership(directory, { ...ident, storageRoot });
    return realpath(directory);
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
      descriptors: sandboxDescriptors,
      tools: (context) => this.#workspaceToolsFor(context),
    };
  }

  /** Die Laufzeit, die eine Eingabe selbst verlangt, gilt, wenn der Aufrufer keine nennt; sie verlängert nur das Warten auf einen entfernten Executor. */
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

  /** Aliasse nennen Wurzeln des Servers, jeder andere Pfad die Wurzel des Runs auf der Maschine seiner Bindung; ohne Alias entscheidet die Bindung. */
  async #executorFor(runId: string, { aliases, runRoot }: AddressedRoots): Promise<WorkspaceExecutor> {
    const bound = await this.#options.executorFor?.(runId);
    if (!bound || aliases.length === 0) return bound ?? this.#local;
    if (runRoot) throw mixedRoots(aliases);
    return this.#local;
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
          }),
      } as AgentToolDefinition;
      return agentToolFrom(proxy, alwaysAvailable, described.name === "bash" ? "sequential" : "parallel");
    }));
  }
}
