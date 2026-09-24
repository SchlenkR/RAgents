import {
  DomainError,
  RPC_ERROR_CODES,
  RpcError,
  implement,
  type AccessContext,
  type MethodConnection,
  type MethodContribution,
} from "@ragents/engine";
import {
  WORKSPACE_EXECUTOR_VERSION,
  sandboxRunEnvironment,
  type WorkspaceExecuteOptions,
  type WorkspaceExecutor,
} from "@ragents/workspace-executor";
import {
  WORKSPACE_CLIENT_STOP_OPERATION,
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
  /** Die offenen Aufrufe über diese Anmeldung; löst eine neue Verbindung sie ab, scheitern sie sofort. */
  readonly calls: Set<AbortController>;
  /** Die Stopps, die gerade über diese Anmeldung zugestellt werden, je Run. */
  readonly stops: Map<string, Promise<void>>;
}

/** Die einzige Grenze gegen einen hängenden Arbeitsplatz; seine eigenen Zeitgrenzen hat der Executor. */
const CLIENT_TIMEOUT_MS = 15 * 60 * 1000;

/** So lange wartet Aufräumen (Stopp, `whenReachable`) auf den Arbeitsplatz; es bleibt unter der Stoppgrenze der Plugins. */
const CLEANUP_TIMEOUT_MS = 10_000;

/** Nach so langer Zeit versucht der Server einen ausstehenden Stopp erneut, solange der Arbeitsplatz angemeldet ist. */
const STOP_RETRY_MS = 30_000;

export const ownerOf = (access: AccessContext): string | null => access.user?.id ?? null;

/** Eine Beobachtung läuft bis zum Abbruch, Aufräumen kurz; alles andere wartet die Sicherheitsgrenze plus der Dauer, die der Aufruf selbst verlangt. */
const timeoutFor = (options: WorkspaceExecuteOptions): { timeoutMs?: number } => {
  if (options.untilAborted) return {};
  if (options.whenReachable) return { timeoutMs: CLEANUP_TIMEOUT_MS };
  return { timeoutMs: CLIENT_TIMEOUT_MS + (options.durationMs ?? 0) };
};

const disconnected = (label: string, detail: string): DomainError =>
  new DomainError("workspace-client-disconnected", `Der Arbeitsplatz ${label} hat die Verbindung verloren: ${detail}`, 409);

/** Bricht die Verbindung mitten im Aufruf, muss die Ursache den Arbeitsplatz nennen, nicht den Server; ein fachlicher Fehler bleibt einer. */
const withClientCause = (cause: unknown, label: string): unknown => {
  if (!(cause instanceof RpcError)) return cause;
  if (cause.code === RPC_ERROR_CODES.connectionClosed) return disconnected(label, cause.message);
  if (cause.code === RPC_ERROR_CODES.timeout) {
    return new DomainError("workspace-client-timeout", `Der Arbeitsplatz ${label} hat nicht geantwortet: ${cause.message}`, 504);
  }
  if (cause.code === RPC_ERROR_CODES.application && cause.domainCode !== undefined && cause.status !== undefined) {
    return new DomainError(cause.domainCode, cause.message, cause.status);
  }
  return cause;
};

/** Der Arbeitsplatz war nicht da oder hat nicht rechtzeitig geantwortet; ein fachlicher Fehler zählt nicht dazu. */
const unreached = (cause: unknown): boolean =>
  cause instanceof DomainError && (cause.code === "workspace-client-disconnected" || cause.code === "workspace-client-timeout");

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** Ein Arbeitsplatz ist erst durch Besitzer und Kennung bestimmt; zwei Benutzer mit derselben Kennung teilen nichts. */
const keyOf = (owner: string | null, id: string): string => JSON.stringify([owner, id]);

/** Über das Netz nimmt der Server Arbeitsplätze nur von angemeldeten Benutzern an; ohne Benutzer gäbe es nur einen Besitzer für alle Zugänge. */
export const assertMayRegister = (access: AccessContext, local: boolean): void => {
  if (local || (access.enabled && access.user !== null)) return;
  throw new DomainError(
    "workspace-client-login-required",
    "Dieser Server kennt keine Benutzeranmeldung; einen Arbeitsplatz nimmt er deshalb nur über eine Loopback-Verbindung an "
      + "(etwa http://127.0.0.1 auf seinem eigenen Rechner). Über das Netz braucht ein Arbeitsplatz ein Profil mit Benutzern.",
    403,
  );
};

/** Kennt die angemeldeten Arbeitsplätze je Besitzer, hält je Client die Verbindung, über die der Server ihn zurückruft, und die Stopps, die ihn nicht erreicht haben. */
export class WorkspaceClientRegistry {
  readonly #clients = new Map<string, ClientEntry>();
  /** Stopps, die den Arbeitsplatz noch nicht erreicht haben, je Arbeitsplatz und Run mit dem Ordner der Bindung. */
  readonly #pendingStops = new Map<string, Map<string, string>>();
  readonly #stopRetries = new Map<string, NodeJS.Timeout>();

  async register(
    id: string,
    description: WorkspaceClientDescription,
    executor: string,
    connection: MethodConnection,
  ): Promise<WorkspaceClientInfo> {
    if (connection.streamless) {
      throw new DomainError("stream-required", "Die Anmeldung eines Arbeitsplatzes braucht einen Ereignisstrom.", 409);
    }
    if (executor !== WORKSPACE_EXECUTOR_VERSION) {
      throw new DomainError(
        "workspace-executor-version",
        `Der Arbeitsplatz ${description.label} bringt den Executor ${executor} mit, der Server verlangt ${WORKSPACE_EXECUTOR_VERSION}.`,
        409,
      );
    }
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

  /** Nur die Verbindung, die den Eintrag hält, meldet ihn ab; eine Abmeldung ohne Eintrag ist nach einer Trennung kein Fehler. */
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

  /** Die Runs, deren Stopp diesen Arbeitsplatz noch nicht erreicht hat. */
  pendingStops(owner: string | null, id: string): readonly string[] {
    return this.#pendingRuns(keyOf(owner, id));
  }

  /** Der Executor eines gebundenen Runs: dieselbe Schnittstelle wie im Server, nur über die Verbindung des Arbeitsplatzes seines Besitzers. */
  executorFor(owner: string | null, id: string, label: string, cwd: string): WorkspaceExecutor {
    const key = keyOf(owner, id);
    const call = async (runId: string, operation: string, input: unknown, options: WorkspaceExecuteOptions): Promise<unknown> => {
      if (options.untilAborted && !options.signal) throw new Error(`Die Operation ${operation} läuft bis zum Abbruch und braucht dafür ein Abbruchsignal`);
      if (this.#pendingStops.get(key)?.has(runId)) {
        // Aufräumen neben einem ausstehenden Stopp erledigt dieser mit; alles andere wartet, bis er zugestellt ist.
        if (options.whenReachable) return null;
        if (this.#clients.has(key)) await this.#deliverStop(key, runId);
      }
      const entry = this.#clients.get(key);
      if (!entry) {
        if (options.whenReachable) return null;
        throw new DomainError("workspace-client-disconnected", `Der Arbeitsplatz ${label} ist nicht verbunden.`, 409);
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

  /** Ein getrennter Arbeitsplatz verlässt die Registry; eine spätere Anmeldung über eine neue Verbindung bleibt stehen. */
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

  /** Eine Verbindung, die niemand mehr hält, bekommt keine Antworten mehr zugestellt; ihre offenen Aufrufe scheitern sofort. */
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
          fail(disconnected(label, "eine neue Verbindung hat die Anmeldung abgelöst")), { once: true })),
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

  /** Stellt einen ausstehenden Stopp zu; erreicht er den Arbeitsplatz nicht, bleibt er ausstehend, und die nächste Anmeldung holt ihn nach. */
  #deliverStop(key: string, runId: string): Promise<void> {
    const entry = this.#clients.get(key);
    const cwd = this.#pendingStops.get(key)?.get(runId);
    if (cwd === undefined) return Promise.resolve();
    if (!entry) {
      console.warn(`Der Stopp des Runs ${runId} erreicht seinen Arbeitsplatz erst bei dessen nächster Anmeldung.`);
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
        console.warn(`Der Stopp des Runs ${runId} hat den Arbeitsplatz ${entry.info.label} nicht erreicht und bleibt ausstehend: ${messageOf(cause)}`);
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
        console.warn(`Der nachgeholte Stopp des Runs ${runId} ist gescheitert: ${messageOf(cause)}`));
    }
  }

  #pendingRuns(key: string): readonly string[] {
    return [...this.#pendingStops.get(key)?.keys() ?? []];
  }

  /** Ein Arbeitsplatz, der angemeldet bleibt, aber nicht antwortet, bekommt seine ausstehenden Stopps später noch einmal. */
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
  implement(workspaceContracts.clients.register, ({ id, executor, ...description }, { access, connection, local }) => {
    assertMayRegister(access, local);
    return registry.register(id, description, executor, connection);
  }),
  implement(workspaceContracts.clients.unregister, ({ id }, { access, connection }) => {
    registry.unregister(ownerOf(access), id, connection);
    return null;
  }),
];
