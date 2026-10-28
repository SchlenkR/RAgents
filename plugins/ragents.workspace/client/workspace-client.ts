import { execFile } from "node:child_process";
import { realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  EXECUTOR_CONTRIBUTION_FILE,
  WORKSPACE_EXECUTOR_VERSION,
  containsWorkspacePath,
  hostDataDirectory,
  loadExecutorContribution,
  pluginToolsDirectory,
  prepareExecutorContribution,
  ripgrepAvailable,
  isolatedWorkstationEnvironment,
  withoutProcessStartupHooks,
  WorkspaceOperationError,
  WorkspaceOperationExecutor,
  workspaceDataDirectory,
  workspaceExecutorModules,
  workspaceProcessContext,
  sandboxEnvironment,
  createUnrestrictedNetworkSandbox,
  prepareGrantedWritePaths,
  prepareWorkstationFolders,
  workstationAccessRule,
  workstationCacheEnvironment,
  validateWorkspaceGrants,
  ragentsDataRoot,
  type WorkspaceGrantPolicy,
  type ExecutorContributionRevision,
  type PreparedExecutorContribution,
  type WorkspaceProcessContext,
} from "@ragents/workspace-executor";
import type { RpcClient } from "../../../apps/web/src/rpc/client";
import type { OperationInput } from "../../../packages/ragents/src/rpc/contract";
import type { RpcHandlerContext } from "../../../packages/ragents/src/rpc/peer";
import { RPC_ERROR_CODES, RpcError } from "../../../packages/ragents/src/rpc/protocol";
import { DomainError } from "../../../packages/ragents/src/runtime/domain-error";
import { FullAccessConfirmations, type FullAccessOptions } from "./full-access";
import { coreContracts } from "../../../apps/server/src/api/contracts";
import {
  PLUGIN_ID_PATTERN,
  WORKSPACE_CLIENT_STOP_OPERATION,
  WORKSPACE_CLIENT_DELETE_OPERATION,
  workspaceClientContracts,
  workspaceContracts,
  type WorkspaceBinding,
  type WorkspaceClientDescription,
} from "../contract";

/** mismatch: workstation and server carry a different version of executor or bundles; only an update of one side fixes it. */
export type WorkspaceClientStatus =
  | { kind: "idle" }
  | { kind: "preparing"; detail: string }
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

export interface WorkspaceClientOptions extends FullAccessOptions {
  /** The host root of this machine with the bundles from which the executor loads its contributions; it may only come into existence later. */
  hostRoot: () => string | undefined;
  /** Resolves the host for this server before loading its requested contributions. */
  prepareHost?: (report: (detail: string) => void) => Promise<string>;
  /** The headless client's package version, included in mismatch errors. */
  version?: string;
  /** The bash of this machine for the bash tool; on Windows the bundled one and required, otherwise without a value the system's. */
  bash?: string | undefined;
  /** The bundled rg, whose folder the bash has at the front of its PATH; without a value, one in the PATH of this machine applies. */
  rg?: string | undefined;
  readonly platform?: NodeJS.Platform;
  readonly protectedPaths?: () => readonly string[];
  onExecuted?: (execution: WorkspaceClientExecution) => void;
}

/** What the workstation needs for the server: its address, where a dial-back opens its leg, and the message layer. */
export interface WorkspaceClientTransport {
  readonly origin: string;
  readonly rpc: RpcClient;
  readonly signInFailure?: () => string | undefined;
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
  const error = typeof cause === "object" && cause !== null ? cause as { domainCode?: unknown; code?: unknown } : undefined;
  const code = error?.domainCode ?? error?.code;
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

/** Commits of the model carry the developer's Git identity of this folder; the environment outranks any user.name the model passes itself. */
const gitIdentityEnvironment = async (folder: string): Promise<Record<string, string>> => {
  const value = async (key: string): Promise<string | undefined> =>
    (await promisify(execFile)("git", ["-C", folder, "config", "--get", key]).catch(() => ({ stdout: "" }))).stdout.trim() || undefined;
  const [name, email] = await Promise.all([value("user.name"), value("user.email")]);
  return {
    ...(name ? { GIT_AUTHOR_NAME: name, GIT_COMMITTER_NAME: name } : {}),
    ...(email ? { GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_EMAIL: email } : {}),
  };
};

/** Where a workstation without its own value creates the new folders per run: in the workstation's data folder, never in an offered project. */
export const workstationRunsDirectory = (): string => join(workspaceDataDirectory(), "runs");

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The new folder of a run on this machine; an ID with path characters would escape the folder for runs. */
const runFolderOf = (runsDirectory: string, runId: string): string => {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error(`The run ID ${runId} is not usable as a folder name`);
  return join(runsDirectory, runId);
};

const storageFolderOf = (runsDirectory: string, runId: string): string => join(dirname(runsDirectory), "run-storage", runId);

const sameFolders = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((folder, index) => folder === right[index]);

const contextOf = (runs: ReadonlyMap<string, WorkspaceProcessContext>, runId: string): Promise<WorkspaceProcessContext> => {
  const context = runs.get(runId);
  if (!context) throw new Error(`There is no task for run ${runId} on this workstation`);
  return Promise.resolve(context);
};

const sameContributions = (left: readonly ExecutorContributionRevision[], right: readonly ExecutorContributionRevision[]): boolean =>
  left.length === right.length && left.every((entry) => right.some((other) => other.plugin === entry.plugin && other.revision === entry.revision));

/** The bundles of a workstation are the built-in ones of its host; it cannot run a plugin that is missing there. */
const contributionFileOf = (hostRoot: string, plugin: string): string => join(hostRoot, "bundles", plugin, EXECUTOR_CONTRIBUTION_FILE);

/** Loads the contributions the server requires from the bundles of this machine's host; a missing bundle or a different version is an error with a cause. */
const loadedContributions = async (
  hostRoot: string | undefined,
  wanted: readonly ExecutorContributionRevision[],
): Promise<readonly PreparedExecutorContribution[]> => {
  if (wanted.length === 0) return [];
  if (!hostRoot) {
    throw new Error(`The server requires the executor contributions of ${wanted.map(({ plugin }) => plugin).join(", ")}; this workstation `
      + "knows no host from whose bundles it could load them. Use the RAgents extension to fetch the server's host version "
      + "or install @schlenkr/ragents in the server's version.");
  }
  return Promise.all(wanted.map(async ({ plugin, revision }) => {
    if (!PLUGIN_ID_PATTERN.test(plugin)) throw new Error(`The server names ${plugin} as a plugin; that is not a plugin ID`);
    const loaded = await loadExecutorContribution(plugin, contributionFileOf(hostRoot, plugin), revision).catch((cause: unknown) => {
      throw new VersionMismatch(`${messageOf(cause)}. The host of this workstation (${hostRoot}) must carry the same bundles as the server: `
        + "the RAgents extension or the package @schlenkr/ragents in the server's version, in a checkout pnpm build:plugins");
    });
    return prepareExecutorContribution(loaded, pluginToolsDirectory(hostDataDirectory(), plugin));
  }));
};

/** An executor from the contributions the server required at sign-in. */
interface BuiltExecutor {
  readonly hostRoot: string | undefined;
  readonly executor: WorkspaceOperationExecutor;
  readonly contributions: readonly ExecutorContributionRevision[];
}

/** What a sign-in on this machine holds: its own executor, the tasks of its runs, and its handlers on the message layer. */
interface Attachment {
  /** Comes into existence with the server's answer about which contributions it requires; if it requires others after a reconnect, a new one replaces it. */
  built: BuiltExecutor | undefined;
  readonly runsDirectory: string;
  readonly runs: Map<string, WorkspaceProcessContext>;
  readonly access: Map<string, { level: "isolated" | "full"; revision: number; grants?: string }>;
  readonly stopping: Map<string, Promise<void>>;
  readonly needsStop: Set<string>;
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
  readonly #confirmations: FullAccessConfirmations;

  constructor(
    private readonly transport: WorkspaceClientTransport,
    identity: WorkspaceClientIdentity,
    private readonly options: WorkspaceClientOptions,
  ) {
    this.#identity = { ...identity, folders: [...identity.folders] };
    this.#confirmations = new FullAccessConfirmations(identity.runsDirectory, transport.origin, options);
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
      access: new Map(),
      stopping: new Map(),
      needsStop: new Set(),
      release: () => { for (const release of releases) release(); },
    };
    releases.push(
      rpc.handle(workspaceClientContracts.execute, (input, context) => this.#execute(attachment, input, context)),
      rpc.onConnected(() => void this.#announce()),
      rpc.onStatus((status) => {
        if (status.kind !== "connected" && attachment === this.#attachment) this.#disconnected(attachment);
        if (status.kind === "unauthorized" && attachment === this.#attachment) {
          this.#set({ kind: "failed", message: this.transport.signInFailure?.() ?? "The server requires a sign-in.", mismatch: false });
        }
      }),
    );
    this.#attachment = attachment;
    return attachment;
  }

  /** Keeps the executor as long as the server requires the same contributions; otherwise it builds a new one from the bundles of this machine and ends the old one. */
  async #built(attachment: Attachment, wanted: readonly ExecutorContributionRevision[]): Promise<BuiltExecutor> {
    const hostRoot = this.options.prepareHost ? await this.options.prepareHost((detail) => {
      if (attachment === this.#attachment) this.#set({ kind: "preparing", detail });
    }) : this.options.hostRoot();
    if (attachment !== this.#attachment) throw new Error("The workstation has signed out in the meantime");
    const current = attachment.built;
    if (current && current.hostRoot === hostRoot && sameContributions(current.contributions, wanted)) return current;
    const contributions = await loadedContributions(hostRoot, wanted);
    const built: BuiltExecutor = {
      hostRoot,
      executor: new WorkspaceOperationExecutor({
        contextFor: (runId) => contextOf(attachment.runs, runId),
        modules: workspaceExecutorModules({
          runFolder: (runId) => runFolderOf(attachment.runsDirectory, runId),
          contributions: contributions.map((contribution) => contribution.parts),
          serverAddress: () => this.transport.origin,
        }),
      }),
      contributions: contributions.map(({ plugin, revision }) => ({ plugin, revision })),
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
    if (rpc.status.kind === "unauthorized") return Promise.reject(new Error(this.transport.signInFailure?.() ?? "The server requires a sign-in."));
    return new Promise((settle, fail) => {
      const release = rpc.onStatus((status) => {
        if (status.kind === "connecting") return;
        release();
        if (status.kind === "connected") settle();
        else if (status.kind === "retrying") fail(new Error(status.message));
        else if (status.kind === "unauthorized") fail(new Error(this.transport.signInFailure?.() ?? "The server requires a sign-in."));
        else fail(new Error("The server's event stream is closed."));
      });
    });
  }

  #announce(): Promise<void> {
    this.#announcing ??= this.#send().finally(() => { this.#announcing = undefined; });
    return this.#announcing;
  }

  /** First the contributions the server requires, then the sign-in with the executor built from them and its background commands whose end no server has learned; an answer after a sign-out no longer changes the state. */
  async #send(): Promise<void> {
    const attachment = this.#attachment;
    if (!attachment) return;
    try {
      await Promise.all([...attachment.needsStop].map((runId) => this.#stopProcesses(attachment, runId)));
      const wanted = await this.transport.rpc.call(workspaceContracts.clients.contributions, {
        label: this.#identity.label,
        executor: WORKSPACE_EXECUTOR_VERSION,
      }, { timeoutMs: REGISTER_TIMEOUT_MS }).catch((cause: unknown) => {
        if (!(cause instanceof RpcError) || cause.code !== RPC_ERROR_CODES.methodNotFound) throw cause;
        throw new VersionMismatch(`The server does not know ${workspaceContracts.clients.contributions.id}; it is older than this workstation `
          + `with executor ${WORKSPACE_EXECUTOR_VERSION}. Update the server to the workstation's version.`);
      });
      const { executor, contributions } = await this.#built(attachment, wanted);
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
        backgroundTasks: executor.unreportedBackgroundTasks().map((task) => ({ ...task })),
        confirmedRuns: [...await this.#confirmations.confirmedRuns()],
      }, { timeoutMs: REGISTER_TIMEOUT_MS });
      if (attachment === this.#attachment) this.#set({ kind: "registered" });
    } catch (cause) {
      const mismatch = isVersionMismatch(cause);
      const message = mismatch && this.options.version !== undefined
        ? await this.#versionFailure(cause, this.options.version) : messageOf(cause);
      if (attachment === this.#attachment) this.#set({ kind: "failed", message, mismatch });
    }
  }

  async #versionFailure(cause: unknown, version: string): Promise<string> {
    try {
      const server = await this.transport.rpc.call(coreContracts.plugins.bootstrap, {}, { timeoutMs: REGISTER_TIMEOUT_MS });
      return `${messageOf(cause)} Workstation package version ${version}, server version ${server.version ?? "unreported"}. `
        + (server.version ? `Install the matching package version: npm install -g @schlenkr/ragents@${server.version}.`
          : "Update the server to a version that reports its RAgents version, then install the matching @schlenkr/ragents version.");
    } catch (failure) {
      return `${messageOf(cause)} Workstation package version ${version}; the server version could not be read: ${messageOf(failure)}. `
        + "Install @schlenkr/ragents in the server's version.";
    }
  }

  async #signOff(): Promise<void> {
    try {
      await this.transport.rpc.call(workspaceContracts.clients.unregister, { id: this.id }, { timeoutMs: SIGN_OFF_TIMEOUT_MS });
    } catch (cause) {
      this.#set({ kind: "failed", message: messageOf(cause), mismatch: false });
    }
  }

  /** The workstation checks access locally before lending its files and environment to a run. */
  async #execute(attachment: Attachment, input: ExecuteInput, context: RpcHandlerContext): Promise<{ value: unknown }> {
    if (!RUN_ID_PATTERN.test(input.runId)) throw new DomainError("workspace-run-id-invalid", "The run ID is not usable as a folder name.", 400);
    if (input.operation === WORKSPACE_CLIENT_STOP_OPERATION || input.operation === WORKSPACE_CLIENT_DELETE_OPERATION) {
      const result = await this.#stop(attachment, input.runId);
      if (input.operation === WORKSPACE_CLIENT_DELETE_OPERATION) {
        await this.#confirmations.forget(input.runId);
        await rm(storageFolderOf(attachment.runsDirectory, input.runId), { recursive: true, force: true });
      }
      return result;
    }
    const level = input.access?.level;
    if (level !== "isolated" && level !== "full") throw new DomainError("workspace-access-invalid", "The workstation needs an access level of isolated or full.", 400);
    const previous = attachment.access.get(input.runId);
    const signature = JSON.stringify(input.access.grants ?? []);
    const access = previous?.level === level && previous.grants === signature ? previous : { level, revision: (previous?.revision ?? 0) + 1, grants: signature };
    attachment.access.set(input.runId, access);
    if (previous && previous !== access) attachment.needsStop.add(input.runId);
    if (attachment.needsStop.has(input.runId)) await this.#stopProcesses(attachment, input.runId);
    await attachment.stopping.get(input.runId);
    if (level === "full") await this.#confirmations.accept({ runId: input.runId, name: input.runName ?? input.runId });
    const cwd = await this.#inside(input.cwd, input.runId);
    const root = await realPathOf(cwd);
    if (attachment !== this.#attachment) throw new Error("The workstation has signed out in the meantime");
    const executor = attachment.built?.executor;
    if (!executor) throw new Error("The workstation is not signed in at the server yet");
    const protectedPaths = this.options.protectedPaths?.() ?? [];
    const grantPolicy: WorkspaceGrantPolicy = {
      homeDirectories: [homedir()],
      dataDirectory: ragentsDataRoot(),
      protectedPaths: [hostDataDirectory(), attachment.runsDirectory, join(dirname(attachment.runsDirectory), "run-storage"), join(dirname(attachment.runsDirectory), "full-access"), join(tmpdir(), "ragents-workspace-logs"),
        ...protectedPaths,
        ...[...attachment.runs].flatMap(([runId, context]) => runId === input.runId ? [] : [context.root])],
    };
    const grants = level === "full" ? [] : await validateWorkspaceGrants(input.access.grants ?? [], grantPolicy);
    const gitEnvironment = await gitIdentityEnvironment(root);
    const platform = this.options.platform ?? process.platform;
    const storage = storageFolderOf(attachment.runsDirectory, input.runId);
    const folders = level === "isolated" ? await prepareWorkstationFolders(storage) : undefined;
    const inherited = level === "isolated" ? withoutProcessStartupHooks(isolatedWorkstationEnvironment(process.env)) : process.env;
    const source = this.options.rg ? { ...inherited, PATH: [dirname(this.options.rg), inherited.PATH].filter(Boolean).join(delimiter) } : inherited;
    const additions = { ...input.env, ...gitEnvironment };
    const accessRule = folders ? await workstationAccessRule({
      root,
      offered: this.#identity.folders,
      storage,
      runFolder: runFolderOf(attachment.runsDirectory, input.runId),
      data: [ragentsDataRoot(), hostDataDirectory(), attachment.runsDirectory, join(dirname(attachment.runsDirectory), "run-storage"),
        join(dirname(attachment.runsDirectory), "full-access"), join(tmpdir(), "ragents-workspace-logs"), ...protectedPaths],
      grants,
      environment: source,
      platform,
      readable: [
        ...attachment.built?.hostRoot ? [join(attachment.built.hostRoot, "node_modules"), join(attachment.built.hostRoot, "bundles")] : [],
        ...attachment.built?.contributions.map(({ plugin }) => pluginToolsDirectory(hostDataDirectory(), plugin)) ?? [],
        ...this.options.rg ? [dirname(this.options.rg)] : [],
      ],
    }) : undefined;
    const sandbox = folders && accessRule && platform !== "win32" ? createUnrestrictedNetworkSandbox({
      rule: accessRule,
      temporary: folders.temporary,
      environment: source,
      platform,
      validate: async () => {
        await validateWorkspaceGrants(grants, grantPolicy);
        if (platform === "linux") await prepareGrantedWritePaths(grants, grantPolicy);
      },
    }) : undefined;
    if (attachment.access.get(input.runId) !== access) throw new DomainError("workspace-access-changed", "The run's access changed before the operation started. Retry with its current access level.", 409);
    attachment.runs.set(input.runId, workspaceProcessContext({
      runId: input.runId,
      cwd,
      root,
      home: { home: folders?.home ?? homedir() },
      logDirectory: folders?.temporary ?? join(tmpdir(), "ragents-workspace-logs", input.runId),
      hostRoot: attachment.built?.hostRoot,
      additions: { ...additions, ...folders ? { ...workstationCacheEnvironment(folders.home, folders.temporary, source), GIT_CEILING_DIRECTORIES: root, PATH: source.PATH ?? "" } : {} },
      access: { level, grants },
      grantPolicy,
      source,
      ...(accessRule ? { accessRule } : {}),
      ...(sandbox ? { sandbox } : {}),
      externalAgentEnvironment: sandboxEnvironment(process.env, { base: "inherited", home: { home: homedir() }, additions }),
      ...(input.browserNetwork ? { browserNetwork: input.browserNetwork } : {}),
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
      if (input.operation === "runFolder.remove") {
        await this.#confirmations.forget(input.runId);
        await rm(storage, { recursive: true, force: true });
      }
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
    const previous = attachment.access.get(runId);
    attachment.access.set(runId, { level: "isolated", revision: (previous?.revision ?? 0) + 1 });
    attachment.needsStop.add(runId);
    await this.#stopProcesses(attachment, runId);
    return { value: null };
  }

  #disconnected(attachment: Attachment): void {
    for (const [runId, access] of attachment.access) {
      if (access.level !== "full") continue;
      attachment.access.set(runId, { level: "isolated", revision: access.revision + 1 });
      attachment.needsStop.add(runId);
      void this.#stopProcesses(attachment, runId).catch((cause: unknown) => {
        if (attachment === this.#attachment) this.#set({ kind: "failed", message: `Full access cleanup after disconnect failed: ${messageOf(cause)}`, mismatch: false });
      });
    }
  }

  #stopProcesses(attachment: Attachment, runId: string): Promise<void> {
    const pending = attachment.stopping.get(runId);
    if (pending) return pending;
    const stopping = (attachment.built?.executor.stopRun(runId) ?? Promise.resolve()).then(() => {
      attachment.runs.delete(runId);
      attachment.needsStop.delete(runId);
    }).finally(() => { attachment.stopping.delete(runId); });
    attachment.stopping.set(runId, stopping);
    return stopping;
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
