import {
  serviceToken,
  type RunFunction,
  type PluginContext,
  type ToolContributor,
  type ToolAvailability,
} from "@aicontainer/ragents";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@aicontainer/agent";
import type { SessionWorkspace } from "../ragents/workspace-runtime.js";
import {
  sanitizedEnv,
  createSandboxTools,
  type SandboxHomeEnvironment,
  type SandboxTools,
} from "./sandbox-tools.js";
import type { SessionIdent } from "./session-ident.js";
import { agentToolFrom, toolDescriptorFrom, type AgentToolDefinition } from "./agent-tool.js";
import { alwaysAvailable } from "./tool-availability.js";
import path from "node:path";
import { resolvedWorkspacePath, type ResolvedWorkspaceRoot } from "./workspace-paths.js";
import { syncWorkspaceOwnership } from "./workspace-ownership.js";

export interface SandboxProcessContext {
  runId: string;
  cwd: string;
  root: string;
  storageRoot?: string;
  additionalRoots?: readonly string[];
  workspaceAliases?: Readonly<Record<string, string>>;
  home: string;
  env: NodeJS.ProcessEnv;
  uid?: number;
  gid?: number;
  remote?: string;
}

export interface EditAnnotator {
  id: string;
  annotate: (runId: string, absolutePath: string) => Promise<string | undefined>;
}

export interface RegisteredWorkspaceRoot {
  id: string;
  alias?: string;
  environmentVariable?: string;
  directoryFor: (runId: string) => string | undefined | Promise<string | undefined>;
  ownershipDirectoryFor?: (runId: string) => string | Promise<string>;
}

export interface SandboxServices {
  processContextFor: (runId: string) => Promise<SandboxProcessContext>;
  registerEditAnnotator: (annotator: EditAnnotator) => void;
  registerWorkspaceRoot: (root: RegisteredWorkspaceRoot) => void;
  shutdown: (runId: string) => Promise<void>;
}

export const sandboxServicesToken = serviceToken<SandboxServices>("ragents.workspace.sandbox-services");

export interface WorkspaceSandboxHostOptions {
  contributorName: string;
  workspaceFor: (runId: string) => Promise<SessionWorkspace>;
  identFor: (runId: string) => Promise<SessionIdent | undefined>;
  skillPaths: () => Promise<readonly string[]>;
  homeFor: (runId: string) => Promise<SandboxHomeEnvironment>;
  filesFor: (runId: string) => Promise<string | undefined>;
  storageRootFor?: (runId: string) => string;
}

const sandboxAvailability: Record<string, ToolAvailability> = {
  read: alwaysAvailable,
  edit: alwaysAvailable,
  write: alwaysAvailable,
  bash: alwaysAvailable,
};

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

export class WorkspaceSandboxHost implements SandboxServices {
  readonly #options: WorkspaceSandboxHostOptions;
  readonly #sandboxes = new Map<string, Promise<SandboxTools>>();
  readonly #annotators: EditAnnotator[] = [];
  readonly #workspaceRoots: RegisteredWorkspaceRoot[] = [];

  constructor(options: WorkspaceSandboxHostOptions) {
    this.#options = options;
  }

  registerEditAnnotator(annotator: EditAnnotator): void {
    if (this.#annotators.some((entry) => entry.id === annotator.id)) {
      throw new Error(`Edit-Annotator ${annotator.id} ist bereits registriert`);
    }
    this.#annotators.push(annotator);
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

  async processContextFor(runId: string): Promise<SandboxProcessContext> {
    const workspace = await this.#options.workspaceFor(runId);
    const [ident, home, files] = workspace.hostSandbox
      ? [undefined, { home: workspace.hostSandbox.home }, workspace.hostSandbox.filesDirectory]
      : await Promise.all([
        this.#options.identFor(runId),
        this.#options.homeFor(runId),
        this.#options.filesFor(runId),
      ]);
    const roots = await this.#additionalRoots(runId, ident);
    return {
      runId,
      cwd: workspace.cwd,
      root: await workspace.currentRoot(),
      storageRoot: this.#options.storageRootFor?.(runId),
      additionalRoots: roots.map((root) => root.directory),
      workspaceAliases: Object.fromEntries(roots.filter((root) => root.alias).map((root) => [root.alias!, root.directory])),
      home: home.home,
      env: { ...sanitizedEnv(process.env, { runId, workspace, ident, home, filesDirectory: files }),
        ...Object.fromEntries(roots.filter((root) => root.environmentVariable).map((root) => [root.environmentVariable!, root.directory])) },
      uid: ident?.uid,
      gid: ident?.gid,
      ...(workspace.remote ? { remote: workspace.remote.label } : {}),
    };
  }

  workspaceTools(): ToolContributor {
    return {
      name: this.#options.contributorName,
      descriptors: sandboxDescriptors,
      tools: (context) => this.#workspaceToolsFor(context),
    };
  }

  async shutdown(runId: string): Promise<void> {
    const sandbox = this.#sandboxes.get(runId);
    if (!sandbox) return;
    this.#sandboxes.delete(runId);
    await (await sandbox).shutdown();
  }

  async shutdownAll(): Promise<void> {
    const running = [...this.#sandboxes.keys()];
    const results = await Promise.allSettled(running.map((runId) => this.shutdown(runId)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  async #workspaceToolsFor(context: PluginContext): Promise<RunFunction[]> {
    const sandbox = await this.#sandbox(context.runId);
    return sandbox.map((entry) => {
      const definition = entry as AgentToolDefinition;
      const available = sandboxAvailability[definition.name];
      if (!available) throw new Error(`Das Sandbox-Werkzeug ${definition.name} hat keine Rechtezuordnung`);
      return agentToolFrom(describeSandboxTool(definition), available,
        definition.name === "bash" ? "sequential" : "parallel");
    });
  }

  async #annotate(runId: string, absolutePath: string): Promise<string | undefined> {
    const notes = await Promise.all(this.#annotators.map((annotator) =>
      annotator.annotate(runId, absolutePath).catch((error: unknown) =>
        `Diagnostik (${annotator.id}) fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`)));
    const text = notes.filter((note): note is string => Boolean(note)).join("\n");
    return text || undefined;
  }

  #sandbox(runId: string): Promise<SandboxTools> {
    const running = this.#sandboxes.get(runId);
    if (running) return running;
    const created = (async () => {
      const workspace = await this.#options.workspaceFor(runId);
      const [ident, skillPaths, home, files] = workspace.hostSandbox
        ? [undefined, workspace.hostSandbox.readOnlyDirectories, { home: workspace.hostSandbox.home }, workspace.hostSandbox.filesDirectory] as const
        : await Promise.all([
          this.#options.identFor(runId),
          this.#options.skillPaths(),
          this.#options.homeFor(runId),
          this.#options.filesFor(runId),
        ]);
      return createSandboxTools(
        runId,
        workspace,
        [...skillPaths],
        ident,
        home,
        files,
        (absolutePath) => this.#annotate(runId, absolutePath),
        () => this.#additionalRoots(runId, ident),
      );
    })().catch((error: unknown) => {
      this.#sandboxes.delete(runId);
      throw error;
    });
    this.#sandboxes.set(runId, created);
    return created;
  }
}
