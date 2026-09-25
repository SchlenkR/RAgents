import { realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  WORKSPACE_EXECUTOR_VERSION,
  containsWorkspacePath,
  WorkspaceOperationError,
  WorkspaceOperationExecutor,
  workspaceDataDirectory,
  workspaceExecutorModules,
  workspaceProcessContext,
  type WorkspaceProcessContext,
} from "@ragents/workspace-executor";
import type { RpcClient } from "../../../apps/web/src/rpc/client";
import type { OperationInput } from "../../../packages/ragents/src/rpc/contract";
import type { RpcHandlerContext } from "../../../packages/ragents/src/rpc/peer";
import { DomainError } from "../../../packages/ragents/src/runtime/domain-error";
import {
  WORKSPACE_CLIENT_STOP_OPERATION,
  workspaceClientContracts,
  workspaceContracts,
  type WorkspaceBinding,
  type WorkspaceClientDescription,
} from "../contract";

export type WorkspaceClientStatus =
  | { kind: "idle" }
  | { kind: "registered" }
  | { kind: "failed"; message: string };

export interface WorkspaceClientIdentity extends WorkspaceClientDescription {
  id: string;
}

/** Ein abgeschlossener Werkzeugaufruf des Modells; der Aufrufer entscheidet, wohin die Zeile geht. */
export interface WorkspaceClientExecution {
  runId: string;
  operation: string;
  durationMs: number;
  error: string | undefined;
}

export interface WorkspaceClientOptions {
  /** Die Host-Wurzel dieses Rechners, aus der die Sprachserver aufgelöst werden; sie kann erst später entstehen. */
  hostRoot: () => string | undefined;
  /** Die Bash dieses Rechners für das Werkzeug bash; unter Windows die mitgebrachte und Pflicht, sonst ohne Angabe die des Systems. */
  bash?: string | undefined;
  onExecuted?: (execution: WorkspaceClientExecution) => void;
}

/** Was der Arbeitsplatz zum Server braucht: die Nachrichtenschicht. */
export interface WorkspaceClientTransport {
  readonly rpc: RpcClient;
}

type ExecuteInput = OperationInput<typeof workspaceClientContracts.execute>;

/** So lange wartet eine Anmeldung auf die Antwort des Servers. */
const REGISTER_TIMEOUT_MS = 10_000;

/** So lange wartet eine Abmeldung auf den Server; der Executor endet unabhängig davon. */
const SIGN_OFF_TIMEOUT_MS = 3_000;

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** Der echte Pfad des nächsten vorhandenen Elternordners, um die noch fehlenden Namen ergänzt. */
const realPathOf = async (target: string): Promise<string> => {
  try {
    return await realpath(target);
  } catch {
    const parent = dirname(target);
    return parent === target ? target : join(await realPathOf(parent), basename(target));
  }
};

/** Wo ein Arbeitsplatz ohne eigene Angabe die neuen Ordner je Run anlegt: im Datenordner des Arbeitsplatzes, nie in einem angebotenen Projekt. */
export const workstationRunsDirectory = (): string => join(workspaceDataDirectory(), "runs");

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Der neue Ordner eines Runs auf diesem Rechner; eine Kennung mit Pfadzeichen käme aus dem Ordner für Runs heraus. */
const runFolderOf = (runsDirectory: string, runId: string): string => {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error(`Die Run-Kennung ${runId} taugt nicht als Ordnername`);
  return join(runsDirectory, runId);
};

const sameFolders = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((folder, index) => folder === right[index]);

const contextOf = (runs: ReadonlyMap<string, WorkspaceProcessContext>, runId: string): Promise<WorkspaceProcessContext> => {
  const context = runs.get(runId);
  if (!context) throw new Error(`Für den Run ${runId} liegt auf diesem Arbeitsplatz kein Auftrag vor`);
  return Promise.resolve(context);
};

/** Was eine Anmeldung auf diesem Rechner hält: ihren eigenen Executor, die Aufträge ihrer Runs und ihre Handler an der Nachrichtenschicht. */
interface Attachment {
  readonly executor: WorkspaceOperationExecutor;
  readonly runs: Map<string, WorkspaceProcessContext>;
  readonly release: () => void;
}

/** Der Arbeitsplatz: meldet seine Ordner an und führt die Aufträge des Servers mit dem Executor dieser Maschine aus. */
export class WorkspaceClient {
  #identity: WorkspaceClientIdentity;
  #status: WorkspaceClientStatus = { kind: "idle" };
  #attachment: Attachment | undefined;
  #announcing: Promise<void> | undefined;
  /** Die Abmeldungen beim Server, der Reihe nach; eine spätere Anmeldung wartet auf sie, damit keine sie überholt. */
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

  /** Erst die Operation anbieten - das öffnet den Strom -, dann anmelden, sobald er steht; eine Abmeldung, die inzwischen kam, gilt. */
  async register(): Promise<void> {
    const signingOff = this.#signingOff;
    await signingOff;
    if (signingOff !== this.#signingOff) return;
    const attachment = this.#attach();
    try {
      await this.#connected();
    } catch (cause) {
      if (attachment === this.#attachment) this.#set({ kind: "failed", message: messageOf(cause) });
      return;
    }
    if (attachment === this.#attachment) await this.#announce();
  }

  /** Geänderte Ordner werden erneut angemeldet; ohne Ordner meldet sich der Arbeitsplatz ab. */
  async update(folders: readonly string[]): Promise<void> {
    if (sameFolders(this.#identity.folders, folders)) return;
    this.#identity = { ...this.#identity, folders: [...folders] };
    if (this.#status.kind === "idle") return;
    if (folders.length === 0) await this.unregister();
    else await this.register();
  }

  /** Die Abmeldung erreicht den Server nach einer laufenden Anmeldung und vor jeder späteren; der Executor endet sofort, auch wenn der Server nicht antwortet. */
  async unregister(): Promise<void> {
    const attachment = this.#attachment;
    this.#attachment = undefined;
    attachment?.release();
    attachment?.runs.clear();
    this.#set({ kind: "idle" });
    const signingOff = Promise.allSettled([this.#signingOff, this.#announcing]).then(() => this.#signOff());
    this.#signingOff = signingOff;
    await Promise.all([signingOff, attachment?.executor.shutdown()]);
  }

  /** Der Arbeitsplatz bindet immer sich selbst; wo der Server läuft, ändert daran nichts. */
  binding(folder: string): WorkspaceBinding {
    return { machine: { client: this.id, label: this.label }, folder: { path: folder } };
  }

  /** Jede Anmeldung baut ihren eigenen Executor; einer, den eine Abmeldung beendet hat, wird nie wieder benutzt. */
  #attach(): Attachment {
    if (this.#attachment) return this.#attachment;
    const runs = new Map<string, WorkspaceProcessContext>();
    const runsDirectory = this.#identity.runsDirectory;
    const executor = new WorkspaceOperationExecutor({
      contextFor: (runId) => contextOf(runs, runId),
      modules: workspaceExecutorModules({ runFolder: (runId) => runFolderOf(runsDirectory, runId) }),
    });
    const rpc = this.transport.rpc;
    const releases = [
      rpc.handle(workspaceClientContracts.execute, (input, context) => this.#execute(executor, runs, input, context)),
      rpc.onConnected(() => void this.#announce()),
    ];
    this.#attachment = { executor, runs, release: () => { for (const release of releases) release(); } };
    return this.#attachment;
  }

  /** Wartet auf den Ereignisstrom; ohne ihn nimmt der Server die Anmeldung nicht an. */
  #connected(): Promise<void> {
    const rpc = this.transport.rpc;
    if (rpc.status.kind === "connected") return Promise.resolve();
    return new Promise((settle, fail) => {
      const release = rpc.onStatus((status) => {
        if (status.kind === "connecting") return;
        release();
        if (status.kind === "connected") settle();
        else if (status.kind === "retrying") fail(new Error(status.message));
        else if (status.kind === "unauthorized") fail(new Error("Der Server verlangt eine Anmeldung."));
        else fail(new Error("Der Ereignisstrom des Servers ist geschlossen."));
      });
    });
  }

  #announce(): Promise<void> {
    this.#announcing ??= this.#send().finally(() => { this.#announcing = undefined; });
    return this.#announcing;
  }

  /** Eine Antwort, die erst nach einer Abmeldung ankommt, ändert den Zustand nicht mehr. */
  async #send(): Promise<void> {
    const attachment = this.#attachment;
    try {
      await this.transport.rpc.call(workspaceContracts.clients.register, {
        id: this.#identity.id,
        label: this.#identity.label,
        hostname: this.#identity.hostname,
        platform: this.#identity.platform,
        folders: [...this.#identity.folders],
        runsDirectory: this.#identity.runsDirectory,
        executor: WORKSPACE_EXECUTOR_VERSION,
      }, { timeoutMs: REGISTER_TIMEOUT_MS });
      if (attachment === this.#attachment) this.#set({ kind: "registered" });
    } catch (cause) {
      if (attachment === this.#attachment) this.#set({ kind: "failed", message: messageOf(cause) });
    }
  }

  async #signOff(): Promise<void> {
    try {
      await this.transport.rpc.call(workspaceContracts.clients.unregister, { id: this.id }, { timeoutMs: SIGN_OFF_TIMEOUT_MS });
    } catch (cause) {
      this.#set({ kind: "failed", message: messageOf(cause) });
    }
  }

  /** Der Entwickler arbeitet auf seinem Arbeitsplatz mit seinen eigenen Zugangsdaten und seiner ganzen Umgebung; HOME bleibt sein Home. */
  async #execute(
    executor: WorkspaceOperationExecutor,
    runs: Map<string, WorkspaceProcessContext>,
    input: ExecuteInput,
    context: RpcHandlerContext,
  ): Promise<{ value: unknown }> {
    if (input.operation === WORKSPACE_CLIENT_STOP_OPERATION) return this.#stop(executor, runs, input.runId);
    const cwd = await this.#inside(input.cwd, input.runId);
    const root = await realPathOf(cwd);
    if (executor !== this.#attachment?.executor) throw new Error("Der Arbeitsplatz hat sich inzwischen abgemeldet");
    runs.set(input.runId, workspaceProcessContext({
      runId: input.runId,
      cwd,
      root,
      home: { home: homedir() },
      logDirectory: join(tmpdir(), "ragents-workspace-logs", input.runId),
      hostRoot: this.options.hostRoot(),
      additions: input.env,
      baseEnvironment: "inherited",
      ...(this.options.bash === undefined ? {} : { bash: this.options.bash }),
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

  /** Der Stopp braucht keinen Ordner: er gibt frei, was der Run hält, auch wenn sein Ordner nicht mehr angeboten wird. */
  async #stop(executor: WorkspaceOperationExecutor, runs: Map<string, WorkspaceProcessContext>, runId: string): Promise<{ value: null }> {
    try {
      await executor.stopRun(runId);
    } finally {
      runs.delete(runId);
    }
    return { value: null };
  }

  /** Jeder Auftrag muss in einem der angebotenen Ordner liegen oder im neuen Ordner seines Runs; fehlende Pfade zählen über ihren vorhandenen Elternordner. */
  async #inside(candidate: string, runId: string): Promise<string> {
    const target = resolve(candidate);
    const real = await realPathOf(target);
    const allowed = [...this.#identity.folders, runFolderOf(this.#identity.runsDirectory, runId)];
    const roots = await Promise.all(allowed.map((folder) => realPathOf(resolve(folder))));
    if (!roots.some((root) => containsWorkspacePath(root, real))) {
      throw new Error(`Pfad außerhalb des angebotenen Ordners: ${candidate}`);
    }
    return target;
  }

  #set(status: WorkspaceClientStatus): void {
    this.#status = status;
    for (const listener of [...this.#listeners]) listener();
  }
}
