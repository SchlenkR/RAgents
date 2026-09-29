import { realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  EXECUTOR_CONTRIBUTION_FILE,
  WORKSPACE_EXECUTOR_VERSION,
  containsWorkspacePath,
  hostDataDirectory,
  loadExecutorContribution,
  pluginToolsDirectory,
  prepareExecutorContribution,
  ripgrepAvailable,
  WorkspaceOperationError,
  WorkspaceOperationExecutor,
  workspaceDataDirectory,
  workspaceExecutorModules,
  workspaceProcessContext,
  type ExecutorContributionStand,
  type PreparedExecutorContribution,
  type WorkspaceProcessContext,
} from "@ragents/workspace-executor";
import type { RpcClient } from "../../../apps/web/src/rpc/client";
import type { OperationInput } from "../../../packages/ragents/src/rpc/contract";
import type { RpcHandlerContext } from "../../../packages/ragents/src/rpc/peer";
import { RPC_ERROR_CODES, RpcError } from "../../../packages/ragents/src/rpc/protocol";
import { DomainError } from "../../../packages/ragents/src/runtime/domain-error";
import {
  PLUGIN_ID_PATTERN,
  WORKSPACE_CLIENT_STOP_OPERATION,
  workspaceClientContracts,
  workspaceContracts,
  type WorkspaceBinding,
  type WorkspaceClientDescription,
} from "../contract";

/** mismatch: workstation and server carry a different version of executor or bundles; only an update of one side fixes it. */
export type WorkspaceClientStatus =
  | { kind: "idle" }
  | { kind: "registered" }
  | { kind: "failed"; message: string; mismatch: boolean };

/** What the workstation says about itself; whether its bash finds rg, it determines itself at every sign-in. */
export interface WorkspaceClientIdentity extends Omit<WorkspaceClientDescription, "ripgrep"> {
  id: string;
}

/** A completed tool call of the model; the caller decides where the line goes. */
export interface WorkspaceClientExecution {
  runId: string;
  operation: string;
  durationMs: number;
  error: string | undefined;
}

export interface WorkspaceClientOptions {
  /** The host root of this machine with the bundles from which the executor loads its contributions; it may only come into existence later. */
  hostRoot: () => string | undefined;
  /** The bash of this machine for the bash tool; on Windows the bundled one and required, otherwise without a value the system's. */
  bash?: string | undefined;
  /** The bundled rg, whose folder the bash has at the front of its PATH; without a value, one in the PATH of this machine applies. */
  rg?: string | undefined;
  onExecuted?: (execution: WorkspaceClientExecution) => void;
}

/** What the workstation needs for the server: the message layer. */
export interface WorkspaceClientTransport {
  readonly rpc: RpcClient;
}

type ExecuteInput = OperationInput<typeof workspaceClientContracts.execute>;

/** This is how long a sign-in waits for the server's answer. */
const REGISTER_TIMEOUT_MS = 10_000;

/** This is how long a sign-out waits for the server; the executor ends independently of it. */
const SIGN_OFF_TIMEOUT_MS = 3_000;

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** A version of this workstation that does not match the server's. */
class VersionMismatch extends Error {}

const VERSION_REFUSALS = ["workspace-executor-version", "workspace-executor-contributions"];

/** By the domain code instead of the class: RpcError can be loaded twice in one process. */
const isVersionMismatch = (cause: unknown): boolean => {
  if (cause instanceof VersionMismatch) return true;
  const code = typeof cause === "object" && cause !== null ? (cause as { domainCode?: unknown }).domainCode : undefined;
  return typeof code === "string" && VERSION_REFUSALS.includes(code);
};

/** The real path of the nearest existing parent folder, extended by the names still missing. */
const realPathOf = async (target: string): Promise<string> => {
  try {
    return await realpath(target);
  } catch {
    const parent = dirname(target);
    return parent === target ? target : join(await realPathOf(parent), basename(target));
  }
};

/** Where a workstation without its own value creates the new folders per run: in the workstation's data folder, never in an offered project. */
export const workstationRunsDirectory = (): string => join(workspaceDataDirectory(), "runs");

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The new folder of a run on this machine; an ID with path characters would escape the folder for runs. */
const runFolderOf = (runsDirectory: string, runId: string): string => {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error(`The run ID ${runId} is not usable as a folder name`);
  return join(runsDirectory, runId);
};

const sameFolders = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((folder, index) => folder === right[index]);

const contextOf = (runs: ReadonlyMap<string, WorkspaceProcessContext>, runId: string): Promise<WorkspaceProcessContext> => {
  const context = runs.get(runId);
  if (!context) throw new Error(`There is no task for run ${runId} on this workstation`);
  return Promise.resolve(context);
};

const sameContributions = (left: readonly ExecutorContributionStand[], right: readonly ExecutorContributionStand[]): boolean =>
  left.length === right.length && left.every((entry) => right.some((other) => other.plugin === entry.plugin && other.stand === entry.stand));

/** The bundles of a workstation are the built-in ones of its host; it cannot run a plugin that is missing there. */
const contributionFileOf = (hostRoot: string, plugin: string): string => join(hostRoot, "bundles", plugin, EXECUTOR_CONTRIBUTION_FILE);

/** Loads the contributions the server requires from the bundles of this machine's host; a missing bundle or a different version is an error with a cause. */
const loadedContributions = async (
  hostRoot: string | undefined,
  wanted: readonly ExecutorContributionStand[],
): Promise<readonly PreparedExecutorContribution[]> => {
  if (wanted.length === 0) return [];
  if (!hostRoot) {
    throw new Error(`The server requires the executor contributions of ${wanted.map(({ plugin }) => plugin).join(", ")}; this workstation `
      + "knows no host from whose bundles it could load them. It gets one with the first connection to a distributing "
      + "server or through the setting ragents.hostPath");
  }
  return Promise.all(wanted.map(async ({ plugin, stand }) => {
    if (!PLUGIN_ID_PATTERN.test(plugin)) throw new Error(`The server names ${plugin} as a plugin; that is not a plugin ID`);
    const loaded = await loadExecutorContribution(plugin, contributionFileOf(hostRoot, plugin), stand).catch((cause: unknown) => {
      throw new VersionMismatch(`${messageOf(cause)}. The host of this workstation (${hostRoot}) must carry the same bundles as the server: `
        + "the RAgents extension or the package @schlenkr/ragents in the server's version, in a checkout pnpm build:plugins");
    });
    return prepareExecutorContribution(loaded, pluginToolsDirectory(hostDataDirectory(), plugin));
  }));
};

/** An executor from the contributions the server required at sign-in. */
interface BuiltExecutor {
  readonly executor: WorkspaceOperationExecutor;
  readonly contributions: readonly ExecutorContributionStand[];
}

/** What a sign-in on this machine holds: its own executor, the tasks of its runs, and its handlers on the message layer. */
interface Attachment {
  /** Comes into existence with the server's answer about which contributions it requires; if it requires others after a reconnect, a new one replaces it. */
  built: BuiltExecutor | undefined;
  readonly runsDirectory: string;
  readonly runs: Map<string, WorkspaceProcessContext>;
  readonly release: () => void;
}

/** The workstation: signs in its folders and runs the server's tasks with the executor of this machine. */
export class WorkspaceClient {
  #identity: WorkspaceClientIdentity;
  #status: WorkspaceClientStatus = { kind: "idle" };
  #attachment: Attachment | undefined;
  #announcing: Promise<void> | undefined;
  /** The sign-outs at the server, in order; a later sign-in waits for them so that none overtakes them. */
  #signingOff: Promise<void> = Promise.resolve();
  readonly #listeners = new Set<() => void>();

  constructor(
    private readonly transport: WorkspaceClientTransport,
    identity: WorkspaceClientIdentity,
    private readonly options: WorkspaceClientOptions,
  ) {
    this.#identity = { ...identity, folders: [...identity.folders] };
  }

  get id(): string {
    return this.#identity.id;
  }

  get label(): string {
    return this.#identity.label;
  }

  get folders(): readonly string[] {
    return this.#identity.folders;
  }

  get status(): WorkspaceClientStatus {
    return this.#status;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** First offer the operation - that opens the stream -, then sign in as soon as it is established; a sign-out that came in the meantime applies. */
  async register(): Promise<void> {
    const signingOff = this.#signingOff;
    await signingOff;
    if (signingOff !== this.#signingOff) return;
    const attachment = this.#attach();
    try {
      await this.#connected();
    } catch (cause) {
      if (attachment === this.#attachment) this.#set({ kind: "failed", message: messageOf(cause), mismatch: false });
      return;
    }
    if (attachment === this.#attachment) await this.#announce();
  }

  /** Changed folders are signed in again; without folders the workstation signs out. */
  async update(folders: readonly string[]): Promise<void> {
    if (sameFolders(this.#identity.folders, folders)) return;
    this.#identity = { ...this.#identity, folders: [...folders] };
    if (this.#status.kind === "idle") return;
    if (folders.length === 0) await this.unregister();
    else await this.register();
  }

  /** The sign-out reaches the server after a running sign-in and before any later one; the executor ends immediately, even if the server does not respond. */
  async unregister(): Promise<void> {
    const attachment = this.#attachment;
    this.#attachment = undefined;
    attachment?.release();
    attachment?.runs.clear();
    this.#set({ kind: "idle" });
    const signingOff = Promise.allSettled([this.#signingOff, this.#announcing]).then(() => this.#signOff());
    this.#signingOff = signingOff;
    await Promise.all([signingOff, attachment?.built?.executor.shutdown()]);
  }

  /** The workstation always binds itself; where the server runs does not change that. */
  binding(folder: string): WorkspaceBinding {
    return { machine: { client: this.id, label: this.label }, folder: { path: folder } };
  }

  /** Every sign-in builds its own executor; one that a sign-out has ended is never used again. */
  #attach(): Attachment {
    if (this.#attachment) return this.#attachment;
    const rpc = this.transport.rpc;
    const releases: Array<() => void> = [];
    const attachment: Attachment = {
      built: undefined,
      runsDirectory: this.#identity.runsDirectory,
      runs: new Map(),
      release: () => { for (const release of releases) release(); },
    };
    releases.push(
      rpc.handle(workspaceClientContracts.execute, (input, context) => this.#execute(attachment, input, context)),
      rpc.onConnected(() => void this.#announce()),
    );
    this.#attachment = attachment;
    return attachment;
  }

  /** Keeps the executor as long as the server requires the same contributions; otherwise it builds a new one from the bundles of this machine and ends the old one. */
  async #built(attachment: Attachment, wanted: readonly ExecutorContributionStand[]): Promise<BuiltExecutor> {
    const current = attachment.built;
    if (current && sameContributions(current.contributions, wanted)) return current;
    const contributions = await loadedContributions(this.options.hostRoot(), wanted);
    const built: BuiltExecutor = {
      executor: new WorkspaceOperationExecutor({
        contextFor: (runId) => contextOf(attachment.runs, runId),
        modules: workspaceExecutorModules({
          runFolder: (runId) => runFolderOf(attachment.runsDirectory, runId),
          contributions: contributions.map((contribution) => contribution.parts),
        }),
      }),
      contributions: contributions.map(({ plugin, stand }) => ({ plugin, stand })),
    };
    if (attachment !== this.#attachment) {
      await built.executor.shutdown();
      throw new Error("The workstation has signed out in the meantime");
    }
    attachment.built = built;
    await current?.executor.shutdown();
    return built;
  }

  /** Waits for the event stream; without it the server does not accept the sign-in. */
  #connected(): Promise<void> {
    const rpc = this.transport.rpc;
    if (rpc.status.kind === "connected") return Promise.resolve();
    return new Promise((settle, fail) => {
      const release = rpc.onStatus((status) => {
        if (status.kind === "connecting") return;
        release();
        if (status.kind === "connected") settle();
        else if (status.kind === "retrying") fail(new Error(status.message));
        else if (status.kind === "unauthorized") fail(new Error("The server requires a sign-in."));
        else fail(new Error("The server's event stream is closed."));
      });
    });
  }

  #announce(): Promise<void> {
    this.#announcing ??= this.#send().finally(() => { this.#announcing = undefined; });
    return this.#announcing;
  }

  /** First the contributions the server requires, then the sign-in with the executor built from them; an answer after a sign-out no longer changes the state. */
  async #send(): Promise<void> {
    const attachment = this.#attachment;
    if (!attachment) return;
    try {
      const wanted = await this.transport.rpc.call(workspaceContracts.clients.contributions, {
        label: this.#identity.label,
        executor: WORKSPACE_EXECUTOR_VERSION,
      }, { timeoutMs: REGISTER_TIMEOUT_MS }).catch((cause: unknown) => {
        if (!(cause instanceof RpcError) || cause.code !== RPC_ERROR_CODES.methodNotFound) throw cause;
        throw new VersionMismatch(`The server does not know ${workspaceContracts.clients.contributions.id}; it is older than this workstation `
          + `with executor ${WORKSPACE_EXECUTOR_VERSION}. Update the server to the workstation's version.`);
      });
      const { contributions } = await this.#built(attachment, wanted);
      await this.transport.rpc.call(workspaceContracts.clients.register, {
        id: this.#identity.id,
        label: this.#identity.label,
        hostname: this.#identity.hostname,
        platform: this.#identity.platform,
        folders: [...this.#identity.folders],
        runsDirectory: this.#identity.runsDirectory,
        ripgrep: ripgrepAvailable(this.options.rg, process.env),
        executor: WORKSPACE_EXECUTOR_VERSION,
        contributions: contributions.map((contribution) => ({ ...contribution })),
      }, { timeoutMs: REGISTER_TIMEOUT_MS });
      if (attachment === this.#attachment) this.#set({ kind: "registered" });
    } catch (cause) {
      if (attachment === this.#attachment) this.#set({ kind: "failed", message: messageOf(cause), mismatch: isVersionMismatch(cause) });
    }
  }

  async #signOff(): Promise<void> {
    try {
      await this.transport.rpc.call(workspaceContracts.clients.unregister, { id: this.id }, { timeoutMs: SIGN_OFF_TIMEOUT_MS });
    } catch (cause) {
      this.#set({ kind: "failed", message: messageOf(cause), mismatch: false });
    }
  }

  /** The developer works on their workstation with their own credentials and their whole environment; HOME stays their home. */
  async #execute(attachment: Attachment, input: ExecuteInput, context: RpcHandlerContext): Promise<{ value: unknown }> {
    if (input.operation === WORKSPACE_CLIENT_STOP_OPERATION) return this.#stop(attachment, input.runId);
    const cwd = await this.#inside(input.cwd, input.runId);
    const root = await realPathOf(cwd);
    if (attachment !== this.#attachment) throw new Error("The workstation has signed out in the meantime");
    const executor = attachment.built?.executor;
    if (!executor) throw new Error("The workstation is not signed in at the server yet");
    attachment.runs.set(input.runId, workspaceProcessContext({
      runId: input.runId,
      cwd,
      root,
      home: { home: homedir() },
      logDirectory: join(tmpdir(), "ragents-workspace-logs", input.runId),
      hostRoot: this.options.hostRoot(),
      additions: input.env,
      baseEnvironment: "inherited",
      ...(this.options.bash === undefined ? {} : { bash: this.options.bash }),
      ...(this.options.rg === undefined ? {} : { rg: this.options.rg }),
    }));
    const startedAt = Date.now();
    let failure: string | undefined;
    try {
      const value = await executor.execute(input.runId, input.operation, input.input, {
        ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
        signal: context.signal,
        onProgress: context.progress,
      });
      return { value };
    } catch (cause) {
      failure = messageOf(cause);
      throw cause instanceof WorkspaceOperationError ? new DomainError(cause.code, cause.message, cause.status) : cause;
    } finally {
      if (input.toolCallId) {
        this.options.onExecuted?.({
          runId: input.runId,
          operation: input.operation,
          durationMs: Date.now() - startedAt,
          error: failure,
        });
      }
    }
  }

  /** The stop needs no folder: it releases what the run holds, even if its folder is no longer offered. */
  async #stop(attachment: Attachment, runId: string): Promise<{ value: null }> {
    try {
      await attachment.built?.executor.stopRun(runId);
    } finally {
      attachment.runs.delete(runId);
    }
    return { value: null };
  }

  /** Every task must be in one of the offered folders or in the new folder of its run; missing paths count through their existing parent folder. */
  async #inside(candidate: string, runId: string): Promise<string> {
    const target = resolve(candidate);
    const real = await realPathOf(target);
    const allowed = [...this.#identity.folders, runFolderOf(this.#identity.runsDirectory, runId)];
    const roots = await Promise.all(allowed.map((folder) => realPathOf(resolve(folder))));
    if (!roots.some((root) => containsWorkspacePath(root, real))) {
      throw new Error(`Path outside the offered folder: ${candidate}`);
    }
    return target;
  }

  #set(status: WorkspaceClientStatus): void {
    this.#status = status;
    for (const listener of [...this.#listeners]) listener();
  }
}
