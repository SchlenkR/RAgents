import { Value } from "typebox/value";
import {
  DomainError,
  RPC_ERROR_CODES,
  RpcError,
  implement,
  schemaComplaints,
  type AccessContext,
  type MethodConnection,
  type MethodContribution,
} from "@ragents/engine";
import {
  WORKSPACE_EXECUTOR_VERSION,
  sandboxRunEnvironment,
  type ExecutorContributionStand,
  type WorkspaceExecuteOptions,
  type WorkspaceExecutor,
} from "@ragents/workspace-executor";
import {
  WORKSPACE_CLIENT_STOP_OPERATION,
  clientRegistrationSchema,
  workspaceClientContracts,
  workspaceContracts,
  type WorkspaceClientDescription,
  type WorkspaceClientInfo,
} from "../contract.js";

interface ClientEntry {
  readonly info: WorkspaceClientInfo;
  readonly owner: string | null;
  readonly connection: MethodConnection;
  readonly release: () => void;
  /** The open calls through this sign-in; if a new connection replaces it, they fail immediately. */
  readonly calls: Set<AbortController>;
  /** The stops currently being delivered through this sign-in, per run. */
  readonly stops: Map<string, Promise<void>>;
}

/** The only limit against a hanging workstation; the executor has its own timeouts. */
const CLIENT_TIMEOUT_MS = 15 * 60 * 1000;

/** This is how long cleanup (stop, `whenReachable`) waits for the workstation; it stays below the plugins' stop limit. */
const CLEANUP_TIMEOUT_MS = 10_000;

/** After this long, the server retries a pending stop as long as the workstation is signed in. */
const STOP_RETRY_MS = 30_000;

export const ownerOf = (access: AccessContext): string | null => access.user?.id ?? null;

/** A watch runs until aborted, cleanup briefly; everything else waits for the safety limit plus the duration the call itself requests. */
const timeoutFor = (options: WorkspaceExecuteOptions): { timeoutMs?: number } => {
  if (options.untilAborted) return {};
  if (options.whenReachable) return { timeoutMs: CLEANUP_TIMEOUT_MS };
  return { timeoutMs: CLIENT_TIMEOUT_MS + (options.durationMs ?? 0) };
};

const disconnected = (label: string, detail: string): DomainError =>
  new DomainError("workspace-client-disconnected", `The workstation ${label} lost the connection: ${detail}`, 409);

/** If the connection breaks in the middle of a call, the cause must name the workstation, not the server; a domain error stays one. */
const withClientCause = (cause: unknown, label: string): unknown => {
  if (!(cause instanceof RpcError)) return cause;
  if (cause.code === RPC_ERROR_CODES.connectionClosed) return disconnected(label, cause.message);
  if (cause.code === RPC_ERROR_CODES.timeout) {
    return new DomainError("workspace-client-timeout", `The workstation ${label} did not respond: ${cause.message}`, 504);
  }
  if (cause.code === RPC_ERROR_CODES.application && cause.domainCode !== undefined && cause.status !== undefined) {
    return new DomainError(cause.domainCode, cause.message, cause.status);
  }
  return cause;
};

/** The workstation was not there or did not respond in time; a domain error does not count. */
const unreached = (cause: unknown): boolean =>
  cause instanceof DomainError && (cause.code === "workspace-client-disconnected" || cause.code === "workspace-client-timeout");

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** A workstation is identified only by owner and ID; two users with the same ID share nothing. */
const keyOf = (owner: string | null, id: string): string => JSON.stringify([owner, id]);

/** Server and workstation need the same executor; the message says which of the two is too old. */
const assertExecutor = (label: string, executor: string): void => {
  if (executor === WORKSPACE_EXECUTOR_VERSION) return;
  const action = Number(executor) > Number(WORKSPACE_EXECUTOR_VERSION)
    ? "Update the server to the workstation's version."
    : "Update the RAgents extension in VS Code or the package @schlenkr/ragents on the workstation.";
  throw new DomainError(
    "workspace-executor-version",
    `The workstation ${label} brings executor ${executor}, the server requires ${WORKSPACE_EXECUTOR_VERSION}. ${action}`,
    409,
  );
};

const described = (contributions: readonly ExecutorContributionStand[]): string =>
  contributions.map(({ plugin, stand }) => `${plugin} (${stand.slice(0, 12)})`).join(", ") || "none";

/** A workstation runs what the server's plugins contribute; with other contributions the same tools would behave differently there than on the server. */
const assertContributions = (label: string, expected: readonly ExecutorContributionStand[], given: readonly ExecutorContributionStand[]): void => {
  const key = (entry: ExecutorContributionStand): string => `${entry.plugin}\0${entry.stand}`;
  const same = expected.length === given.length && expected.every((entry) => given.some((other) => key(other) === key(entry)));
  if (same) return;
  throw new DomainError(
    "workspace-executor-contributions",
    `The workstation ${label} brings the executor contributions ${described(given)}, the server requires ${described(expected)}. `
      + "The workstation queries them with ragents.workspace.clients.contributions and then signs in again.",
    409,
  );
};

/** Over the network, the server accepts workstations only from signed-in users; without users there would be only one owner for all access. */
export const assertMayRegister = (access: AccessContext, local: boolean): void => {
  if (local || (access.enabled && access.user !== null)) return;
  throw new DomainError(
    "workspace-client-login-required",
    "This server has no user sign-in; it therefore accepts a workstation only over a loopback connection "
      + "(such as http://127.0.0.1 on its own machine). Over the network, a workstation needs a profile with users.",
    403,
  );
};

/** Knows the signed-in workstations per owner, holds per client the connection through which the server calls it back, and the stops that have not reached it. */
export class WorkspaceClientRegistry {
  /** What the server's plugins contribute to the executor; every workstation must carry exactly these contributions. */
  readonly contributions: readonly ExecutorContributionStand[];
  readonly #clients = new Map<string, ClientEntry>();
  /** Stops that have not reached the workstation yet, per workstation and run with the folder of the binding. */
  readonly #pendingStops = new Map<string, Map<string, string>>();
  readonly #stopRetries = new Map<string, NodeJS.Timeout>();

  constructor(contributions: readonly ExecutorContributionStand[]) {
    this.contributions = contributions.map(({ plugin, stand }) => ({ plugin, stand }));
  }

  async register(
    id: string,
    description: WorkspaceClientDescription,
    executor: string,
    contributions: readonly ExecutorContributionStand[],
    connection: MethodConnection,
  ): Promise<WorkspaceClientInfo> {
    if (connection.streamless) {
      throw new DomainError("stream-required", "The sign-in of a workstation needs an event stream.", 409);
    }
    assertExecutor(description.label, executor);
    assertContributions(description.label, this.contributions, contributions);
    const owner = connection.userId;
    const key = keyOf(owner, id);
    const previous = this.#clients.get(key);
    previous?.release();
    const info: WorkspaceClientInfo = { ...description, id };
    const renewed = previous?.connection === connection;
    const entry: ClientEntry = {
      info,
      owner,
      connection,
      release: connection.onClose(() => this.#disconnected(key, connection)),
      calls: renewed ? previous.calls : new Set(),
      stops: renewed ? previous.stops : new Map(),
    };
    this.#clients.set(key, entry);
    if (previous && !renewed) this.#abandon(previous);
    this.#deliverPendingStops(key);
    return info;
  }

  /** Only the connection that holds the entry signs it out; a sign-out without an entry is not an error after a disconnect. */
  unregister(owner: string | null, id: string, connection: MethodConnection): void {
    const key = keyOf(owner, id);
    const entry = this.#clients.get(key);
    if (entry?.connection !== connection) return;
    this.#remove(key, entry);
  }

  list(owner: string | null): WorkspaceClientInfo[] {
    return [...this.#clients.values()].filter((entry) => entry.owner === owner).map((entry) => entry.info);
  }

  info(owner: string | null, id: string): WorkspaceClientInfo | undefined {
    return this.#clients.get(keyOf(owner, id))?.info;
  }

  /** The runs whose stop has not reached this workstation yet. */
  pendingStops(owner: string | null, id: string): readonly string[] {
    return this.#pendingRuns(keyOf(owner, id));
  }

  /** The executor of a bound run: the same interface as in the server, only through the connection of its owner's workstation. */
  executorFor(owner: string | null, id: string, label: string, cwd: string): WorkspaceExecutor {
    const key = keyOf(owner, id);
    const call = async (runId: string, operation: string, input: unknown, options: WorkspaceExecuteOptions): Promise<unknown> => {
      if (options.untilAborted && !options.signal) throw new Error(`The operation ${operation} runs until aborted and needs an abort signal for that`);
      if (this.#pendingStops.get(key)?.has(runId)) {
        // Cleanup alongside a pending stop is done by that stop; everything else waits until it is delivered.
        if (options.whenReachable) return null;
        if (this.#clients.has(key)) await this.#deliverStop(key, runId);
      }
      const entry = this.#clients.get(key);
      if (!entry) {
        if (options.whenReachable) return null;
        throw new DomainError("workspace-client-disconnected", `The workstation ${label} is not connected.`, 409);
      }
      try {
        return await this.#send(entry, runId, operation, input, cwd, options);
      } catch (cause) {
        if (options.whenReachable && unreached(cause)) return null;
        throw cause;
      }
    };
    return {
      version: WORKSPACE_EXECUTOR_VERSION,
      execute: (runId, operation, input, options = {}) => call(runId, operation, input, options),
      stopRun: async (runId) => {
        this.#pendingStopsOf(key).set(runId, cwd);
        await this.#deliverStop(key, runId);
      },
      shutdown: async () => undefined,
    };
  }

  shutdown(): void {
    for (const entry of this.#clients.values()) {
      entry.release();
      this.#abandon(entry);
    }
    this.#clients.clear();
    for (const timer of this.#stopRetries.values()) clearTimeout(timer);
    this.#stopRetries.clear();
    this.#pendingStops.clear();
  }

  /** A disconnected workstation leaves the registry; a later sign-in over a new connection stays. */
  #disconnected(key: string, connection: MethodConnection): void {
    const entry = this.#clients.get(key);
    if (entry?.connection !== connection) return;
    this.#remove(key, entry);
  }

  #remove(key: string, entry: ClientEntry): void {
    entry.release();
    this.#clients.delete(key);
    this.#abandon(entry);
  }

  /** A connection that nobody holds anymore gets no more answers delivered; its open calls fail immediately. */
  #abandon(entry: ClientEntry): void {
    for (const controller of entry.calls) controller.abort();
    entry.calls.clear();
  }

  async #send(
    entry: ClientEntry,
    runId: string,
    operation: string,
    input: unknown,
    cwd: string,
    options: WorkspaceExecuteOptions,
  ): Promise<unknown> {
    const label = entry.info.label;
    const abandoned = new AbortController();
    entry.calls.add(abandoned);
    const signal = options.signal ? AbortSignal.any([options.signal, abandoned.signal]) : abandoned.signal;
    try {
      const { value } = await Promise.race([
        entry.connection.call(
          workspaceClientContracts.execute,
          {
            runId,
            operation,
            ...(options.toolCallId ? { toolCallId: options.toolCallId } : {}),
            cwd,
            env: sandboxRunEnvironment(runId),
            input,
          },
          {
            signal,
            ...timeoutFor(options),
            ...(options.onProgress ? { onProgress: options.onProgress } : {}),
          },
        ),
        new Promise<never>((_settle, fail) => abandoned.signal.addEventListener("abort", () =>
          fail(disconnected(label, "a new connection replaced the sign-in")), { once: true })),
      ]);
      return value;
    } catch (cause) {
      throw withClientCause(cause, label);
    } finally {
      entry.calls.delete(abandoned);
    }
  }

  #pendingStopsOf(key: string): Map<string, string> {
    const known = this.#pendingStops.get(key);
    if (known) return known;
    const created = new Map<string, string>();
    this.#pendingStops.set(key, created);
    return created;
  }

  /** Delivers a pending stop; if it does not reach the workstation, it stays pending and the next sign-in catches up on it. */
  #deliverStop(key: string, runId: string): Promise<void> {
    const entry = this.#clients.get(key);
    const cwd = this.#pendingStops.get(key)?.get(runId);
    if (cwd === undefined) return Promise.resolve();
    if (!entry) {
      console.warn(`The stop of run ${runId} reaches its workstation only at its next sign-in.`);
      return Promise.resolve();
    }
    const running = entry.stops.get(runId);
    if (running) return running;
    const delivery = this.#send(entry, runId, WORKSPACE_CLIENT_STOP_OPERATION, null, cwd, { whenReachable: true })
      .then(() => this.#stopDelivered(key, runId, cwd), (cause: unknown) => {
        if (!unreached(cause)) {
          this.#stopDelivered(key, runId, cwd);
          throw cause;
        }
        console.warn(`The stop of run ${runId} did not reach the workstation ${entry.info.label} and stays pending: ${messageOf(cause)}`);
        this.#retryStops(key);
      })
      .finally(() => entry.stops.delete(runId));
    entry.stops.set(runId, delivery);
    return delivery;
  }

  #stopDelivered(key: string, runId: string, cwd: string): void {
    const pending = this.#pendingStops.get(key);
    if (pending?.get(runId) === cwd) pending.delete(runId);
    if (pending?.size === 0) this.#pendingStops.delete(key);
  }

  #deliverPendingStops(key: string): void {
    for (const runId of this.#pendingRuns(key)) {
      void this.#deliverStop(key, runId).catch((cause: unknown) =>
        console.warn(`The delayed stop of run ${runId} failed: ${messageOf(cause)}`));
    }
  }

  #pendingRuns(key: string): readonly string[] {
    return [...this.#pendingStops.get(key)?.keys() ?? []];
  }

  /** A workstation that stays signed in but does not respond gets its pending stops again later. */
  #retryStops(key: string): void {
    if (this.#stopRetries.has(key)) return;
    const timer = setTimeout(() => {
      this.#stopRetries.delete(key);
      if (this.#clients.has(key)) this.#deliverPendingStops(key);
    }, STOP_RETRY_MS);
    timer.unref();
    this.#stopRetries.set(key, timer);
  }
}

export const clientMethods = (registry: WorkspaceClientRegistry): MethodContribution[] => [
  implement(workspaceContracts.clients.list, (_input, { access }) => registry.list(ownerOf(access))),
  implement(workspaceContracts.clients.contributions, ({ label, executor }, { access, local }) => {
    assertMayRegister(access, local);
    assertExecutor(label, executor);
    return registry.contributions.map((entry) => ({ ...entry }));
  }),
  implement(workspaceContracts.clients.register, (input, { access, connection, local }) => {
    assertMayRegister(access, local);
    // Version first: a workstation with a different one does not know the shape of this version; with this one, the shape applies fully.
    assertExecutor(input.label, input.executor);
    if (!Value.Check(clientRegistrationSchema, input)) {
      throw new RpcError(RPC_ERROR_CODES.invalidParams,
        `Invalid input for ${workspaceContracts.clients.register.id}: ${schemaComplaints(clientRegistrationSchema, input, "params")}`);
    }
    const { id, executor, contributions, ...description } = input;
    return registry.register(id, description, executor, contributions, connection);
  }),
  implement(workspaceContracts.clients.unregister, ({ id }, { access, connection }) => {
    registry.unregister(ownerOf(access), id, connection);
    return null;
  }),
];
