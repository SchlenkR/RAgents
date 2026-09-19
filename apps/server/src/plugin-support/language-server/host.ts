import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { runManagedProcess } from "../managed-process.js";
import type { SandboxProcessContext, SandboxServices } from "../workspace-sandbox-host.js";
import type { LanguageServerDiagnostic, LanguageServerSnapshot } from "./contract.js";
import { diagnosticEntries, formatDiagnostics } from "./diagnostics.js";
import { LanguageServerSession, withTimeout, type LanguageServerLaunch } from "./session.js";
import { allowedWorkspacePath, containsWorkspacePath, expandWorkspaceAlias, resolvedWorkspacePath } from "../workspace-paths.js";

export interface LanguageServerAdapter {
  id: string;
  label: string;
  languages: Readonly<Record<string, string>>;
  rootDescription: string;
  resolveRoot: (workspaceRoot: string, root: string) => Promise<string>;
  launch: (context: SandboxProcessContext, root: string) => Promise<LanguageServerLaunch>;
  open: (session: LanguageServerSession, root: string, timeoutMs: number) => Promise<string>;
}

export interface LanguageServerHostOptions {
  idleMs?: number;
  openTimeoutMs?: number;
  diagnosticsTimeoutMs?: number;
}

interface OpenServer {
  root: string;
  session: LanguageServerSession;
  summary: string;
}

interface ServerEntry {
  root: string;
  state: "opening" | "ready" | "failed";
  summary: string;
  controller: AbortController;
  pending?: Promise<OpenServer>;
  initializing?: Promise<LanguageServerSession>;
  server?: OpenServer;
  closing?: Promise<void>;
}

const DEFAULT_IDLE_MS = 20 * 60 * 1000;
const DEFAULT_OPEN_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_DIAGNOSTICS_TIMEOUT_MS = 60 * 1000;
const GIT_TIMEOUT_MS = 30 * 1000;

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

const assertLocalWorkspace = (context: SandboxProcessContext): void => {
  if (context.remote === undefined) return;
  throw new Error(`Der Arbeitsbereich liegt auf dem Arbeitsplatz ${context.remote}; Language Server laufen nur bei einem Arbeitsbereich auf dem Server`);
};

export class LanguageServerHost {
  readonly adapter: LanguageServerAdapter;
  readonly #sandbox: SandboxServices;
  readonly #idleMs: number;
  readonly #openTimeoutMs: number;
  readonly #diagnosticsTimeoutMs: number;
  readonly #servers = new Map<string, ServerEntry>();
  readonly #roots = new Map<string, string>();
  readonly #lifetimes = new Map<string, object>();
  readonly #closing = new Map<string, Set<Promise<void>>>();
  readonly #idleTimers = new Map<string, NodeJS.Timeout>();
  readonly #seen = new Map<string, Map<string, readonly LanguageServerDiagnostic[]>>();
  #closed = false;

  constructor(adapter: LanguageServerAdapter, sandbox: SandboxServices, options: LanguageServerHostOptions = {}) {
    this.adapter = adapter;
    this.#sandbox = sandbox;
    this.#idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.#openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
    this.#diagnosticsTimeoutMs = options.diagnosticsTimeoutMs ?? DEFAULT_DIAGNOSTICS_TIMEOUT_MS;
  }

  handles(filePath: string): boolean {
    return this.adapter.languages[path.extname(filePath).toLowerCase()] !== undefined;
  }

  async open(runId: string, root: string): Promise<string> {
    const lifetime = this.#lifetime(runId);
    const previous = this.#servers.get(runId);
    let absoluteRoot = root;
    try {
      const context = await this.#sandbox.processContextFor(runId);
      this.#assertLifetime(runId, lifetime);
      assertLocalWorkspace(context);
      const allowed = await Promise.all([context.root, ...context.additionalRoots ?? []].map(resolvedWorkspacePath));
      const requested = await allowedWorkspacePath(path.resolve(context.root, expandWorkspaceAlias(root, context.workspaceAliases ?? {})), allowed);
      const workspaceRoot = allowed.find((directory) => containsWorkspacePath(directory, requested))!;
      absoluteRoot = await this.adapter.resolveRoot(workspaceRoot, requested);
      this.#assertLifetime(runId, lifetime);
      const current = this.#current(runId);
      if (current && current.root === absoluteRoot && current.state !== "failed") {
        const server = await current.pending!;
        this.#assertCurrent(runId, current);
        this.#touch(runId);
        return `${this.adapter.label} ist bereits geöffnet: ${server.summary}`;
      }
      const server = await this.#start(runId, context, absoluteRoot);
      this.#assertLifetime(runId, lifetime);
      if (this.#servers.get(runId)?.server !== server) throw this.#stopped();
      return server.summary;
    } catch (error) {
      if (this.#lifetimes.get(runId) === lifetime && this.#servers.get(runId) === previous && !this.#closed) {
        const failed: ServerEntry = { root: absoluteRoot, state: "failed", summary: messageOf(error), controller: new AbortController() };
        this.#servers.set(runId, failed);
        this.#roots.set(runId, absoluteRoot);
        this.#seen.delete(runId);
        if (previous) await this.#dispose(runId, previous);
      }
      throw error;
    }
  }

  async status(runId: string): Promise<string> {
    const current = this.#current(runId);
    if (current?.state === "opening") return current.summary;
    if (current?.state === "failed") return `${this.adapter.label} konnte nicht geöffnet werden: ${current.summary}`;
    if (current) return `${this.adapter.label} läuft: ${current.summary}`;
    const root = this.#roots.get(runId);
    return root
      ? `${this.adapter.label} ist nach Leerlauf beendet und wird beim nächsten Zugriff für ${root} neu geladen`
      : `${this.adapter.label} ist nicht geöffnet`;
  }

  async snapshot(runId: string): Promise<LanguageServerSnapshot> {
    const current = this.#current(runId);
    if (current?.state === "opening" || current?.state === "failed") {
      return { state: current.state, root: current.root, summary: current.summary, files: [] };
    }
    const root = current?.root ?? this.#roots.get(runId);
    const rootExists = !root || await this.#exists(root);
    if (this.#servers.get(runId) !== current || this.#roots.get(runId) !== root) return this.snapshot(runId);
    if (!rootExists) {
      await this.stopSession(runId);
      return { state: "closed", root: null, summary: null, files: [] };
    }
    const seen = this.#seen.get(runId);
    const files = seen === undefined ? [] : await this.#existingFiles(runId, seen);
    if (this.#servers.get(runId) !== current || this.#roots.get(runId) !== root) return this.snapshot(runId);
    return {
      state: current ? "ready" : root ? "suspended" : "closed",
      root: root ?? null,
      summary: current?.summary ?? null,
      files,
    };
  }

  async #exists(absolutePath: string): Promise<boolean> {
    return stat(absolutePath).then(() => true, () => false);
  }

  async #existingFiles(
    runId: string,
    seen: ReadonlyMap<string, readonly LanguageServerDiagnostic[]>,
  ): Promise<LanguageServerSnapshot["files"]> {
    const context = await this.#sandbox.processContextFor(runId);
    const entries = await Promise.all([...seen.entries()].map(async ([file, diagnostics]) =>
      await this.#exists(path.resolve(context.root, expandWorkspaceAlias(file, context.workspaceAliases ?? {}))) ? { path: file, diagnostics: [...diagnostics] } : null));
    return entries
      .filter((entry): entry is { path: string; diagnostics: LanguageServerDiagnostic[] } => entry !== null)
      .sort((left, right) => left.path.localeCompare(right.path, "de"));
  }

  async diagnostics(runId: string, paths: readonly string[] | undefined, includeWarnings: boolean): Promise<string> {
    const lifetime = this.#lifetime(runId);
    const context = await this.#sandbox.processContextFor(runId);
    this.#assertLifetime(runId, lifetime);
    assertLocalWorkspace(context);
    const server = await this.#ensure(runId, context);
    const files = paths === undefined || paths.length === 0
      ? await this.#changedFiles(context)
      : await Promise.all(paths.map((requested) => allowedWorkspacePath(path.resolve(context.root, expandWorkspaceAlias(requested, context.workspaceAliases ?? {})), [context.root, ...context.additionalRoots ?? []])));
    if (files.length === 0) return `Keine geänderten ${this.adapter.label}-Dateien im Arbeitsverzeichnis`;
    const results: string[] = [];
    for (const file of files) {
      if (!this.handles(file)) {
        throw new Error(`${path.relative(context.root, file)} hat keine ${this.adapter.label}-Endung (${Object.keys(this.adapter.languages).join(", ")})`);
      }
      results.push(await this.#format(context, server, file, includeWarnings));
    }
    return results.join("\n\n");
  }

  async annotate(runId: string, absolutePath: string): Promise<string | undefined> {
    if (!this.handles(absolutePath) || !this.#roots.has(runId)) return undefined;
    try {
      const lifetime = this.#lifetime(runId);
      const context = await this.#sandbox.processContextFor(runId);
      this.#assertLifetime(runId, lifetime);
      assertLocalWorkspace(context);
      const server = await this.#ensure(runId, context);
      return await this.#format(context, server, absolutePath, false);
    } catch (error) {
      return `Diagnostik (${this.adapter.label}) fehlgeschlagen: ${messageOf(error)}`;
    }
  }

  async stopSession(runId: string): Promise<void> {
    this.#lifetimes.delete(runId);
    this.#roots.delete(runId);
    this.#seen.delete(runId);
    await this.#close(runId);
    await Promise.all(this.#closing.get(runId) ?? []);
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
    const runs = new Set([...this.#lifetimes.keys(), ...this.#roots.keys(), ...this.#servers.keys(), ...this.#closing.keys()]);
    const results = await Promise.allSettled([...runs].map((runId) => this.stopSession(runId)));
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) throw new AggregateError(failures, `${this.adapter.label}-Shutdown fehlgeschlagen`);
  }

  async #format(
    context: SandboxProcessContext,
    server: OpenServer,
    absolutePath: string,
    includeWarnings: boolean,
  ): Promise<string> {
    this.#touch(context.runId);
    const checkedPath = await allowedWorkspacePath(absolutePath, [context.root, ...context.additionalRoots ?? []]);
    const diagnostics = await server.session.diagnosticsFor(await realpath(checkedPath), this.#diagnosticsTimeoutMs);
    if (this.#servers.get(context.runId)?.server !== server) throw this.#stopped();
    const alias = Object.entries(context.workspaceAliases ?? {}).find(([, root]) => containsWorkspacePath(root, checkedPath));
    const relativePath = alias ? `${alias[0]}/${path.relative(alias[1], checkedPath)}`
      : containsWorkspacePath(context.root, checkedPath) ? path.relative(context.root, checkedPath) : checkedPath;
    const seen = this.#seen.get(context.runId) ?? new Map<string, readonly LanguageServerDiagnostic[]>();
    seen.set(relativePath, diagnosticEntries(diagnostics));
    this.#seen.set(context.runId, seen);
    return formatDiagnostics(this.adapter.label, relativePath, diagnostics, includeWarnings);
  }

  async #changedFiles(context: SandboxProcessContext): Promise<string[]> {
    let output = "";
    const result = await runManagedProcess({
      command: "git",
      args: ["status", "--porcelain", "--untracked-files=all", "--no-renames"],
      cwd: context.root,
      env: context.env,
      uid: context.uid,
      gid: context.gid,
      label: "git status",
      timeoutMs: GIT_TIMEOUT_MS,
      onStdout: (chunk) => { output += chunk.toString("utf8"); },
    }).catch((error: unknown) => {
      throw new Error(`Ohne paths braucht ${this.adapter.id}_diagnostics ein Git-Arbeitsverzeichnis: ${messageOf(error)}`);
    });
    if (result.code !== 0) throw new Error(`Ohne paths braucht ${this.adapter.id}_diagnostics ein Git-Arbeitsverzeichnis (git status: Code ${result.code})`);
    const candidates = output.split("\n")
      .filter((line) => line.length > 3 && line[1] !== "D" && line[0] !== "D")
      .map((line) => path.resolve(context.root, line.slice(3)))
      .filter((file) => this.handles(file));
    const existing: string[] = [];
    for (const file of candidates) {
      if (await stat(file).then((info) => info.isFile(), () => false)) existing.push(file);
    }
    return existing;
  }

  #current(runId: string): ServerEntry | undefined {
    const current = this.#servers.get(runId);
    if (current?.server?.session.exited) {
      this.#servers.delete(runId);
      void this.#dispose(runId, current).catch((error) => console.error(`${this.adapter.label}: Bereinigung fehlgeschlagen: ${messageOf(error)}`));
      return undefined;
    }
    return current;
  }

  async #ensure(runId: string, context: SandboxProcessContext): Promise<OpenServer> {
    if (this.#closed) throw this.#stopped();
    const current = this.#current(runId);
    if (current?.state === "failed") throw new Error(current.summary);
    if (current) {
      const server = await current.pending!;
      this.#assertCurrent(runId, current);
      return server;
    }
    const root = this.#roots.get(runId);
    if (!root) throw new Error(`Kein ${this.adapter.label}-Server geöffnet; zuerst ${this.adapter.id}_open aufrufen`);
    return this.#start(runId, context, root);
  }

  #start(runId: string, context: SandboxProcessContext, root: string): Promise<OpenServer> {
    const previous = this.#servers.get(runId);
    const closing = previous ? this.#dispose(runId, previous) : undefined;
    const entry: ServerEntry = {
      root, state: "opening", summary: `${this.adapter.label} lädt ${root}`, controller: new AbortController(),
    };
    this.#servers.set(runId, entry);
    this.#roots.set(runId, root);
    this.#seen.delete(runId);
    entry.pending = (async (): Promise<OpenServer> => {
      try {
        await closing;
        this.#assertCurrent(runId, entry);
        const launch = await this.adapter.launch(context, root);
        this.#assertCurrent(runId, entry);
        entry.initializing = LanguageServerSession.start(launch, this.#openTimeoutMs);
        const session = await entry.initializing;
        this.#assertCurrent(runId, entry);
        let aborted!: () => void;
        const cancelled = new Promise<never>((_resolve, reject) => {
          aborted = () => reject(entry.controller.signal.reason);
          entry.controller.signal.addEventListener("abort", aborted, { once: true });
        });
        let summary: string;
        try {
          summary = await withTimeout(
            Promise.race([this.adapter.open(session, root, this.#openTimeoutMs), cancelled]),
            this.#openTimeoutMs,
            () => new Error(`${this.adapter.label}: ${root} nicht innerhalb von ${Math.round(this.#openTimeoutMs / 1000)} s geladen`),
          );
        } finally {
          entry.controller.signal.removeEventListener("abort", aborted);
        }
        this.#assertCurrent(runId, entry);
        if (session.exited) throw new Error(`${this.adapter.label} wurde während des Ladens beendet`);
        const server = { root, session, summary };
        entry.server = server;
        entry.state = "ready";
        entry.summary = summary;
        this.#touch(runId);
        return server;
      } catch (error) {
        if (this.#servers.get(runId) === entry && !entry.controller.signal.aborted) {
          entry.state = "failed";
          entry.summary = messageOf(error);
        }
        await this.#dispose(runId, entry);
        throw error;
      }
    })();
    return entry.pending;
  }

  async #close(runId: string): Promise<void> {
    const timer = this.#idleTimers.get(runId);
    if (timer) clearTimeout(timer);
    this.#idleTimers.delete(runId);
    const entry = this.#servers.get(runId);
    if (!entry) return;
    this.#servers.delete(runId);
    await this.#dispose(runId, entry);
  }

  #dispose(runId: string, entry: ServerEntry): Promise<void> {
    entry.controller.abort(this.#stopped());
    if (entry.closing) return entry.closing;
    entry.closing = (async () => {
      const session = await entry.initializing?.catch(() => undefined);
      await session?.shutdown();
    })();
    const pending = this.#closing.get(runId) ?? new Set<Promise<void>>();
    this.#closing.set(runId, pending);
    pending.add(entry.closing);
    const finished = () => {
      pending.delete(entry.closing!);
      if (pending.size === 0 && this.#closing.get(runId) === pending) this.#closing.delete(runId);
    };
    entry.closing.then(finished, finished);
    return entry.closing;
  }

  #lifetime(runId: string): object {
    if (this.#closed) throw this.#stopped();
    let lifetime = this.#lifetimes.get(runId);
    if (!lifetime) this.#lifetimes.set(runId, lifetime = {});
    return lifetime;
  }

  #assertLifetime(runId: string, lifetime: object): void {
    if (this.#closed || this.#lifetimes.get(runId) !== lifetime) throw this.#stopped();
  }

  #assertCurrent(runId: string, entry: ServerEntry): void {
    if (this.#closed || entry.controller.signal.aborted || entry.server?.session.exited || this.#servers.get(runId) !== entry) throw this.#stopped();
  }

  #stopped(): Error {
    return new Error(`${this.adapter.label}-Start wurde beendet`);
  }

  #touch(runId: string): void {
    const entry = this.#servers.get(runId);
    if (!entry || entry.state !== "ready") return;
    const existing = this.#idleTimers.get(runId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.#idleTimers.delete(runId);
      if (this.#servers.get(runId) !== entry) return;
      void this.#close(runId).catch((error) => console.error(`${this.adapter.label}: Beenden nach Leerlauf fehlgeschlagen: ${messageOf(error)}`));
    }, this.#idleMs);
    timer.unref();
    this.#idleTimers.set(runId, timer);
  }
}
