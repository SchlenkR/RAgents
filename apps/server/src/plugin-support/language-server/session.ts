import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { startManagedService, type ManagedService } from "../managed-process.js";
import { JsonRpcConnection, JsonRpcError, LSP_CONTENT_MODIFIED } from "./json-rpc.js";

export interface LanguageServerLaunch {
  label: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  uid?: number;
  gid?: number;
  rootUri: string;
  initializationOptions?: unknown;
  languages: Readonly<Record<string, string>>;
  newFileSettleMs?: number;
  publishesOnlyChangedDiagnostics?: boolean;
}

export interface Position {
  line: number;
  character: number;
}

export interface Diagnostic {
  range: { start: Position; end: Position };
  severity?: number;
  code?: number | string;
  source?: string;
  message: string;
}

interface PublishedDiagnostics {
  version: number | undefined;
  diagnostics: Diagnostic[];
  receivedAt: number;
}

interface DocumentState {
  version: number;
  text: string;
}

const STDERR_TAIL = 4_096;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const SETTLE_MS = 600;
const SETTLE_LIMIT_MS = 5_000;
const CLOSE_PUBLISH_TIMEOUT_MS = 5_000;
const CONTENT_MODIFIED_RETRY_MS = 500;
const NEW_FILE_AGE_MS = 10_000;

const uriOf = (absolutePath: string): string => pathToFileURL(absolutePath).href;

const timeoutError = (label: string, what: string, timeoutMs: number): Error =>
  new Error(`${label}: ${what} nicht innerhalb von ${Math.round(timeoutMs / 1000)} s`);

export const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, error: () => Error): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(error()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });

export class LanguageServerSession {
  readonly label: string;
  readonly #launch: LanguageServerLaunch;
  readonly #service: ManagedService;
  readonly #connection: JsonRpcConnection;
  readonly #input = new PassThrough();
  readonly #documents = new Map<string, DocumentState>();
  readonly #published = new Map<string, PublishedDiagnostics>();
  readonly #publishListeners = new Set<(uri: string) => void>();
  readonly #notificationListeners = new Set<(method: string, params: unknown) => void>();
  readonly #exitListeners = new Set<(error: Error) => void>();
  #stderr = "";
  #serverCapabilities: Record<string, unknown> = {};
  #pullRegistered = false;
  readonly #pullIdentifiers = new Set<string>();
  #exitReason: string | undefined;
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(launch: LanguageServerLaunch) {
    this.label = launch.label;
    this.#launch = launch;
    this.#service = startManagedService({
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      env: launch.env,
      uid: launch.uid,
      gid: launch.gid,
      label: launch.label,
      stdin: "pipe",
      onStdout: (chunk) => {
        this.#input.write(chunk);
      },
      onStderr: (chunk) => {
        this.#stderr = (this.#stderr + chunk.toString("utf8")).slice(-STDERR_TAIL);
      },
      onExit: (code) => this.#ended(`Code ${code ?? "Signal"}`),
      onError: (error) => {
        this.#service.kill("SIGKILL");
        this.#ended(`Fehler: ${error.message}`);
      },
    });
    const output = this.#service.stdin;
    if (!output) throw new Error(`${launch.label}: Standardeingabe fehlt`);
    this.#connection = new JsonRpcConnection({
      label: launch.label,
      input: this.#input,
      output,
      onRequest: async (method, params) => this.#handleServerRequest(method, params),
      onNotification: (method, params) => this.#handleNotification(method, params),
      onError: (error) => {
        this.#service.kill("SIGKILL");
        this.#ended(error.message);
      },
    });
  }

  static async start(
    launch: LanguageServerLaunch,
    timeoutMs: number,
    listener?: (method: string, params: unknown) => void,
  ): Promise<LanguageServerSession> {
    const session = new LanguageServerSession(launch);
    if (listener) session.onNotification(listener);
    try {
      const result = await withTimeout(
        session.#connection.request("initialize", {
          processId: process.pid,
          clientInfo: { name: "RAgents", version: "1" },
          rootUri: launch.rootUri,
          workspaceFolders: [{ uri: launch.rootUri, name: path.basename(launch.cwd) }],
          initializationOptions: launch.initializationOptions ?? null,
          capabilities: {
            workspace: {
              configuration: true,
              workspaceFolders: true,
              didChangeWatchedFiles: { dynamicRegistration: false },
              diagnostics: { refreshSupport: false },
            },
            textDocument: {
              synchronization: { dynamicRegistration: false, didSave: true },
              publishDiagnostics: { relatedInformation: false, versionSupport: true },
              diagnostic: { dynamicRegistration: true, relatedDocumentSupport: false },
            },
            window: { workDoneProgress: true },
            general: { positionEncodings: ["utf-16"] },
          },
        }),
        timeoutMs,
        () => timeoutError(launch.label, "initialisiert", timeoutMs),
      ) as { capabilities?: Record<string, unknown> };
      session.#serverCapabilities = result.capabilities ?? {};
      session.#connection.notify("initialized", {});
      return session;
    } catch (error) {
      await session.shutdown();
      throw error;
    }
  }

  get exited(): boolean {
    return this.#exitReason !== undefined;
  }

  get usesPullDiagnostics(): boolean {
    return this.#pullRegistered || this.#serverCapabilities.diagnosticProvider !== undefined;
  }

  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.#connection.request(method, params, signal);
  }

  notify(method: string, params: unknown): void {
    this.#connection.notify(method, params);
  }

  onNotification(listener: (method: string, params: unknown) => void): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  waitForNotification(
    timeoutMs: number,
    what: string,
    accept: (method: string, params: unknown) => boolean,
  ): Promise<unknown> {
    return withTimeout(
      new Promise<unknown>((resolve, reject) => {
        if (this.#exitReason !== undefined) {
          reject(new Error(`${this.label} läuft nicht mehr (${this.#exitReason})${this.#stderrHint()}`));
          return;
        }
        const onExit = (error: Error) => {
          off();
          reject(error);
        };
        const off = this.onNotification((method, params) => {
          if (!accept(method, params)) return;
          off();
          this.#exitListeners.delete(onExit);
          resolve(params);
        });
        this.#exitListeners.add(onExit);
      }),
      timeoutMs,
      () => timeoutError(this.label, what, timeoutMs),
    );
  }

  diagnosticsFor(absolutePath: string, timeoutMs: number): Promise<Diagnostic[]> {
    const run = async () => {
      this.#assertRunning();
      const extension = path.extname(absolutePath).toLowerCase();
      const languageId = this.#launch.languages[extension];
      if (!languageId) throw new Error(`${this.label} kennt die Endung ${extension || "(keine)"} nicht`);
      const uri = uriOf(absolutePath);
      const text = await readFile(absolutePath, "utf8");
      const settleMs = this.#launch.newFileSettleMs;
      if (settleMs && !this.#documents.has(uri) && await this.#isYoung(absolutePath)) {
        await new Promise((resolve) => setTimeout(resolve, settleMs));
      }
      const known = this.#documents.get(uri);
      const published = this.#published.get(uri);
      if (known?.text === text && !this.usesPullDiagnostics && published) return published.diagnostics;
      if (this.#reopenRequired(known, published)) await this.#reopen(uri);
      const sentAt = Math.max(Date.now(), (this.#published.get(uri)?.receivedAt ?? 0) + 1);
      const version = this.#syncDocument(uri, languageId, text);
      return this.usesPullDiagnostics
        ? this.#pullDiagnostics(uri, timeoutMs)
        : this.#awaitPublished(uri, version, sentAt, timeoutMs);
    };
    const result = this.#queue.then(run, run);
    this.#queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async shutdown(): Promise<void> {
    if (this.#exitReason !== undefined) {
      await this.#service.finished.catch(() => undefined);
      return;
    }
    try {
      await withTimeout(
        this.#connection.request("shutdown", null),
        SHUTDOWN_TIMEOUT_MS,
        () => timeoutError(this.label, "shutdown beantwortet", SHUTDOWN_TIMEOUT_MS),
      );
      this.#connection.notify("exit", null);
    } catch {
    }
    await withTimeout(this.#service.finished, SHUTDOWN_TIMEOUT_MS, () => new Error("weiter")).catch(() => {
      this.#service.kill("SIGKILL");
    });
    await this.#service.finished.catch(() => undefined);
    this.#connection.close(new Error(`${this.label} wurde beendet`));
  }

  async #isYoung(absolutePath: string): Promise<boolean> {
    const info = await stat(absolutePath);
    return Date.now() - info.birthtimeMs < NEW_FILE_AGE_MS;
  }

  #ended(reason: string): void {
    if (this.#exitReason !== undefined) return;
    this.#exitReason = reason;
    const error = new Error(`${this.label} wurde beendet (${reason})${this.#stderrHint()}`);
    this.#connection.close(error);
    this.#input.destroy();
    for (const listener of [...this.#exitListeners]) listener(error);
    this.#exitListeners.clear();
  }

  #notifyListeners(method: string, params: unknown): void {
    for (const listener of [...this.#notificationListeners]) {
      try {
        listener(method, params);
      } catch {
        continue;
      }
    }
  }

  #assertRunning(): void {
    if (this.#exitReason !== undefined) {
      throw new Error(`${this.label} läuft nicht mehr (${this.#exitReason})${this.#stderrHint()}`);
    }
  }

  #stderrHint(): string {
    const tail = this.#stderr.trim();
    return tail ? `\n${tail}` : "";
  }

  #syncDocument(uri: string, languageId: string, text: string): number {
    const state = this.#documents.get(uri);
    if (!state) {
      this.#documents.set(uri, { version: 1, text });
      this.#connection.notify("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text } });
      return 1;
    }
    const previousLines = state.text.split("\n");
    const end = { line: previousLines.length - 1, character: previousLines[previousLines.length - 1].length };
    const version = state.version + 1;
    this.#documents.set(uri, { version, text });
    this.#connection.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ range: { start: { line: 0, character: 0 }, end }, text }],
    });
    return version;
  }

  async #pullDiagnostics(uri: string, timeoutMs: number): Promise<Diagnostic[]> {
    const deadline = Date.now() + timeoutMs;
    const identifiers = this.#pullIdentifiers.size > 0 ? [...this.#pullIdentifiers] : [undefined];
    const merged = new Map<string, Diagnostic>();
    for (const identifier of identifiers) {
      for (const item of await this.#pullOnce(uri, identifier, deadline, timeoutMs)) {
        const { start, end } = item.range;
        merged.set(`${start.line}:${start.character}-${end.line}:${end.character}|${item.code ?? ""}|${item.message}`, item);
      }
    }
    return [...merged.values()];
  }

  async #pullOnce(uri: string, identifier: string | undefined, deadline: number, timeoutMs: number): Promise<Diagnostic[]> {
    for (;;) {
      try {
        const result = await withTimeout(
          this.#connection.request("textDocument/diagnostic", {
            textDocument: { uri },
            ...(identifier === undefined ? {} : { identifier }),
          }),
          Math.max(1, deadline - Date.now()),
          () => timeoutError(this.label, "Diagnostik geliefert", timeoutMs),
        ) as { kind?: string; items?: Diagnostic[] } | null;
        return result?.items ?? [];
      } catch (error) {
        if (!(error instanceof JsonRpcError) || error.code !== LSP_CONTENT_MODIFIED || Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, CONTENT_MODIFIED_RETRY_MS));
      }
    }
  }

  #reopenRequired(known: DocumentState | undefined, published: PublishedDiagnostics | undefined): boolean {
    return this.#launch.publishesOnlyChangedDiagnostics === true
      && !this.usesPullDiagnostics
      && known !== undefined
      && !(published !== undefined && published.diagnostics.length > 0);
  }

  async #reopen(uri: string): Promise<void> {
    const closedAt = Date.now();
    this.#documents.delete(uri);
    this.#connection.notify("textDocument/didClose", { textDocument: { uri } });
    const confirmed = (entry: PublishedDiagnostics | undefined): boolean =>
      entry !== undefined && entry.receivedAt >= closedAt;
    if (!confirmed(this.#published.get(uri)) && !await this.#waitForPublish(uri, confirmed, CLOSE_PUBLISH_TIMEOUT_MS)) {
      this.#assertRunning();
      throw timeoutError(this.label, "didClose bestätigt", CLOSE_PUBLISH_TIMEOUT_MS);
    }
  }

  #waitForPublish(
    uri: string,
    matches: (entry: PublishedDiagnostics | undefined) => boolean,
    limitMs: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const finish = (received: boolean) => {
        clearTimeout(timer);
        this.#publishListeners.delete(listener);
        this.#exitListeners.delete(onExit);
        resolve(received);
      };
      const timer = setTimeout(() => finish(false), limitMs);
      const listener = (publishedUri: string) => {
        if (publishedUri === uri && matches(this.#published.get(uri))) finish(true);
      };
      const onExit = () => finish(false);
      this.#publishListeners.add(listener);
      this.#exitListeners.add(onExit);
    });
  }

  async #awaitPublished(uri: string, version: number, sentAt: number, timeoutMs: number): Promise<Diagnostic[]> {
    const matches = (entry: PublishedDiagnostics | undefined): boolean =>
      entry !== undefined && entry.receivedAt >= sentAt && (entry.version === undefined || entry.version >= version);
    if (!matches(this.#published.get(uri)) && !await this.#waitForPublish(uri, matches, timeoutMs)) {
      this.#assertRunning();
      throw timeoutError(this.label, "Diagnostik geliefert", timeoutMs);
    }
    const settleDeadline = Date.now() + SETTLE_LIMIT_MS;
    while (Date.now() < settleDeadline && await this.#waitForPublish(uri, matches, SETTLE_MS)) continue;
    return this.#published.get(uri)?.diagnostics ?? [];
  }

  #handleNotification(method: string, params: unknown): void {
    if (method === "textDocument/publishDiagnostics") {
      const { uri, version, diagnostics } = params as { uri: string; version?: number; diagnostics: Diagnostic[] };
      this.#published.set(uri, { version, diagnostics: diagnostics ?? [], receivedAt: Date.now() });
      for (const listener of [...this.#publishListeners]) listener(uri);
    }
    this.#notifyListeners(method, params);
  }

  #handleServerRequest(method: string, params: unknown): unknown {
    this.#notifyListeners(`request:${method}`, params);
    switch (method) {
      case "client/registerCapability": {
        const registrations = (params as {
          registrations?: Array<{ method: string; registerOptions?: { identifier?: string } }>;
        }).registrations ?? [];
        for (const registration of registrations) {
          if (registration.method !== "textDocument/diagnostic") continue;
          this.#pullRegistered = true;
          if (registration.registerOptions?.identifier) this.#pullIdentifiers.add(registration.registerOptions.identifier);
        }
        return null;
      }
      case "workspace/configuration":
        return ((params as { items?: unknown[] }).items ?? []).map(() => null);
      case "workspace/applyEdit":
        return { applied: false };
      default:
        return null;
    }
  }
}
