import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceProcessContext } from "../context.js";
import { runManagedProcess } from "../managed-process.js";
import type { LanguageServerDiagnostic, LanguageServerInstanceSnapshot, LanguageServerSnapshot } from "./contract.js";
import { diagnosticEntries, formatDiagnostics } from "./diagnostics.js";
import { LanguageServerSession, withTimeout, type LanguageServerLaunch } from "./session.js";
import { allowedWorkspacePath, containsWorkspacePath, expandWorkspaceAlias, resolvedWorkspacePath } from "../paths.js";

export interface LanguageServerAdapter {
  id: string;
  label: string;
  languages: Readonly<Record<string, string>>;
  rootDescription: string;
  resolveRoot: (workspaceRoot: string, root: string) => Promise<string>;
  rootDirectory: (root: string) => string;
  launch: (context: WorkspaceProcessContext, root: string) => Promise<LanguageServerLaunch>;
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
  runId: string;
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

const keyOf = (runId: string, root: string): string => `${runId}\n${root}`;

const runOf = (key: string): string => key.slice(0, key.indexOf("\n"));

const instanceCount = (count: number): string => `${count} offene Instanz${count === 1 ? "" : "en"}`;

const git = async (
  context: WorkspaceProcessContext,
  directory: string,
  tool: string,
  args: readonly string[],
): Promise<string> => {
  let output = "";
  const result = await runManagedProcess({
    command: "git",
    args: [...args],
    cwd: directory,
    env: context.env,
    uid: context.uid,
    gid: context.gid,
    label: `git ${args[0]}`,
    timeoutMs: GIT_TIMEOUT_MS,
    onStdout: (chunk) => { output += chunk.toString("utf8"); },
  }).catch((error: unknown) => {
    throw new Error(`Ohne paths braucht ${tool} ein Git-Arbeitsverzeichnis: ${messageOf(error)}`);
  });
  if (result.code !== 0) throw new Error(`Ohne paths braucht ${tool} ein Git-Arbeitsverzeichnis (git ${args[0]}: Code ${result.code})`);
  return output;
};

/** Git nennt seine Pfade relativ zur Repo-Wurzel; `-- .` grenzt sie auf die Wurzel der Instanz ein. */
export const changedWorkspaceFiles = async (
  context: WorkspaceProcessContext,
  directory: string,
  tool: string,
  handles: (filePath: string) => boolean,
): Promise<string[]> => {
  const topLevel = (await git(context, directory, tool, ["rev-parse", "--show-toplevel"])).trim();
  const candidates = (await git(context, directory, tool, ["status", "--porcelain", "--untracked-files=all", "--no-renames", "--", "."]))
    .split("\n")
    .filter((line) => line.length > 3 && line[1] !== "D" && line[0] !== "D")
    .map((line) => path.resolve(topLevel, line.slice(3)))
    .filter(handles);
  const existing: string[] = [];
  for (const file of candidates) {
    if (await stat(file).then((info) => info.isFile(), () => false)) existing.push(file);
  }
  return existing;
};

export class LanguageServerHost {
  readonly adapter: LanguageServerAdapter;
  readonly #contextFor: (runId: string) => Promise<WorkspaceProcessContext>;
  readonly #idleMs: number;
  readonly #openTimeoutMs: number;
  readonly #diagnosticsTimeoutMs: number;
  readonly #servers = new Map<string, ServerEntry>();
  readonly #roots = new Map<string, Set<string>>();
  readonly #lifetimes = new Map<string, object>();
  readonly #closing = new Map<string, Set<Promise<void>>>();
  readonly #idleTimers = new Map<string, NodeJS.Timeout>();
  readonly #seen = new Map<string, Map<string, readonly LanguageServerDiagnostic[]>>();
  #closed = false;

  constructor(
    adapter: LanguageServerAdapter,
    contextFor: (runId: string) => Promise<WorkspaceProcessContext>,
    options: LanguageServerHostOptions = {},
  ) {
    this.adapter = adapter;
    this.#contextFor = contextFor;
    this.#idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.#openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
    this.#diagnosticsTimeoutMs = options.diagnosticsTimeoutMs ?? DEFAULT_DIAGNOSTICS_TIMEOUT_MS;
  }

  handles(filePath: string): boolean {
    return this.adapter.languages[path.extname(filePath).toLowerCase()] !== undefined;
  }

  async open(runId: string, root: string): Promise<string> {
    const lifetime = this.#lifetime(runId);
    const { context, absoluteRoot } = await this.#prepare(runId, lifetime, root);
    const current = this.#current(runId, absoluteRoot);
    if (current && current.state !== "failed") {
      const server = await current.pending!.catch(async (error: unknown) => {
        await this.#recordFailure(runId, lifetime, absoluteRoot, error);
        throw error;
      });
      this.#assertCurrent(current);
      this.#touch(runId, absoluteRoot);
      return this.#openMessage(runId, `${this.adapter.label} ist für ${absoluteRoot} bereits geöffnet: ${server.summary}`);
    }
    const server = await this.#start(runId, context, absoluteRoot);
    this.#assertLifetime(runId, lifetime);
    if (this.#servers.get(keyOf(runId, absoluteRoot))?.server !== server) throw this.#stopped();
    return this.#openMessage(runId, `${server.summary} (Wurzel ${absoluteRoot})`);
  }

  async close(runId: string, root?: string): Promise<string> {
    if (root === undefined) {
      const roots = this.#openRoots(runId);
      if (roots.length === 0) return `${this.adapter.label} ist in diesem Run nicht geöffnet`;
      await Promise.all(roots.map((entry) => this.#closeInstance(runId, entry)));
      const closed = roots.length === 1 ? "eine Instanz" : `${roots.length} Instanzen`;
      return `${this.adapter.label}: ${closed} beendet; keine offene Instanz mehr in diesem Run`;
    }
    const context = await this.#contextFor(runId);
    const chosen = await this.#known(runId, context, root);
    await this.#closeInstance(runId, chosen);
    return `${this.adapter.label} für ${chosen} beendet; ${instanceCount(this.#openRoots(runId).length)} in diesem Run`;
  }

  async snapshot(runId: string): Promise<LanguageServerSnapshot> {
    const instances: LanguageServerInstanceSnapshot[] = [];
    for (const root of this.#openRoots(runId)) {
      const instance = await this.#instanceSnapshot(runId, root);
      if (instance) instances.push(instance);
    }
    return { instances };
  }

  async diagnostics(
    runId: string,
    paths: readonly string[] | undefined,
    includeWarnings: boolean,
    root?: string,
  ): Promise<string> {
    const lifetime = this.#lifetime(runId);
    const context = await this.#contextFor(runId);
    this.#assertLifetime(runId, lifetime);
    const roots = root === undefined ? this.#openRoots(runId) : [await this.#known(runId, context, root)];
    if (roots.length === 0) throw new Error(`Kein ${this.adapter.label}-Server geöffnet; zuerst ${this.adapter.id}_open aufrufen`);
    if (paths !== undefined && paths.length > 0) return (await this.#requested(runId, context, roots, paths, includeWarnings)).join("\n\n");
    const failed = root === undefined ? roots.filter((entry) => this.#current(runId, entry)?.state === "failed") : [];
    const failures = failed.map((entry) =>
      `${this.adapter.label} für ${entry} nicht geöffnet: ${this.#current(runId, entry)!.summary}; ${this.adapter.id}_open öffnet die Wurzel erneut`);
    if (failed.length === roots.length) throw new Error(failures.join("\n"));
    const results = await this.#changed(runId, context, roots.filter((entry) => !failed.includes(entry)), includeWarnings);
    const text = results.length === 0 ? `Keine geänderten ${this.adapter.label}-Dateien in den geöffneten Wurzeln` : results.join("\n\n");
    return [text, ...failures].join("\n\n");
  }

  async annotate(runId: string, absolutePath: string): Promise<string | undefined> {
    if (!this.handles(absolutePath) || this.#openRoots(runId).length === 0) return undefined;
    try {
      const lifetime = this.#lifetime(runId);
      const context = await this.#contextFor(runId);
      this.#assertLifetime(runId, lifetime);
      const file = await allowedWorkspacePath(absolutePath, [context.root, ...context.additionalRoots ?? []]);
      const chosen = this.#match(this.#openRoots(runId), file);
      if (!chosen) return undefined;
      const server = await this.#ensure(runId, context, chosen);
      return await this.#format(context, server, file, false);
    } catch (error) {
      return `Diagnostik (${this.adapter.label}) fehlgeschlagen: ${messageOf(error)}`;
    }
  }

  async stopSession(runId: string): Promise<void> {
    this.#lifetimes.delete(runId);
    const keys = new Set([
      ...this.#openRoots(runId).map((root) => keyOf(runId, root)),
      ...[...this.#servers.keys()].filter((key) => runOf(key) === runId),
    ]);
    this.#roots.delete(runId);
    for (const key of keys) this.#seen.delete(key);
    await Promise.all([...keys].map((key) => this.#close(key)));
    await Promise.all(this.#closing.get(runId) ?? []);
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
    const runs = new Set([
      ...this.#lifetimes.keys(),
      ...this.#roots.keys(),
      ...[...this.#servers.keys()].map(runOf),
      ...this.#closing.keys(),
    ]);
    const results = await Promise.allSettled([...runs].map((runId) => this.stopSession(runId)));
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) throw new AggregateError(failures, `${this.adapter.label}-Shutdown fehlgeschlagen`);
  }

  async #prepare(
    runId: string,
    lifetime: object,
    root: string,
  ): Promise<{ context: WorkspaceProcessContext; absoluteRoot: string }> {
    let absoluteRoot = root;
    try {
      const context = await this.#contextFor(runId);
      this.#assertLifetime(runId, lifetime);
      absoluteRoot = path.resolve(context.root, expandWorkspaceAlias(root, context.workspaceAliases ?? {}));
      const allowed = await Promise.all([context.root, ...context.additionalRoots ?? []].map(resolvedWorkspacePath));
      const requested = await allowedWorkspacePath(absoluteRoot, allowed);
      absoluteRoot = requested;
      const workspaceRoot = allowed.find((directory) => containsWorkspacePath(directory, requested))!;
      absoluteRoot = await this.adapter.resolveRoot(workspaceRoot, requested);
      this.#assertLifetime(runId, lifetime);
      return { context, absoluteRoot };
    } catch (error) {
      await this.#recordFailure(runId, lifetime, absoluteRoot, error);
      throw error;
    }
  }

  async #recordFailure(runId: string, lifetime: object, root: string, error: unknown): Promise<void> {
    if (this.#closed || this.#lifetimes.get(runId) !== lifetime) return;
    const key = keyOf(runId, root);
    const previous = this.#servers.get(key);
    if (previous && previous.state !== "failed") return;
    this.#servers.set(key, {
      runId,
      root,
      state: "failed",
      summary: messageOf(error),
      controller: new AbortController(),
    });
    this.#remember(runId, root);
    this.#seen.delete(key);
    if (previous) await this.#dispose(previous);
  }

  #openMessage(runId: string, text: string): string {
    return `${text}; ${instanceCount(this.#openRoots(runId).length)} von ${this.adapter.label} in diesem Run`;
  }

  async #instanceSnapshot(runId: string, root: string): Promise<LanguageServerInstanceSnapshot | undefined> {
    const entry = this.#current(runId, root);
    if (entry?.state === "opening" || entry?.state === "failed") {
      return { state: entry.state, root, summary: entry.summary, files: [] };
    }
    if (!await this.#exists(root)) {
      await this.#closeInstance(runId, root);
      return undefined;
    }
    const seen = this.#seen.get(keyOf(runId, root));
    const files = seen === undefined ? [] : await this.#existingFiles(runId, seen);
    if (!this.#roots.get(runId)?.has(root)) return undefined;
    return { state: entry ? "ready" : "suspended", root, summary: entry?.summary ?? null, files };
  }

  async #exists(absolutePath: string): Promise<boolean> {
    return stat(absolutePath).then(() => true, () => false);
  }

  async #existingFiles(
    runId: string,
    seen: ReadonlyMap<string, readonly LanguageServerDiagnostic[]>,
  ): Promise<LanguageServerInstanceSnapshot["files"]> {
    const context = await this.#contextFor(runId);
    const entries = await Promise.all([...seen.entries()].map(async ([file, diagnostics]) =>
      await this.#exists(path.resolve(context.root, expandWorkspaceAlias(file, context.workspaceAliases ?? {}))) ? { path: file, diagnostics: [...diagnostics] } : null));
    return entries
      .filter((entry): entry is { path: string; diagnostics: LanguageServerDiagnostic[] } => entry !== null)
      .sort((left, right) => left.path.localeCompare(right.path, "de"));
  }

  async #changed(
    runId: string,
    context: WorkspaceProcessContext,
    roots: readonly string[],
    includeWarnings: boolean,
  ): Promise<string[]> {
    const results: string[] = [];
    for (const root of roots) {
      const server = await this.#ensure(runId, context, root);
      const files = await changedWorkspaceFiles(
        context,
        this.adapter.rootDirectory(root),
        `${this.adapter.id}_diagnostics`,
        (file) => this.handles(file),
      );
      for (const file of files) results.push(await this.#format(context, server, file, includeWarnings));
    }
    return results;
  }

  async #requested(
    runId: string,
    context: WorkspaceProcessContext,
    roots: readonly string[],
    paths: readonly string[],
    includeWarnings: boolean,
  ): Promise<string[]> {
    const results: string[] = [];
    for (const requested of paths) {
      const file = await allowedWorkspacePath(path.resolve(context.root, expandWorkspaceAlias(requested, context.workspaceAliases ?? {})), [context.root, ...context.additionalRoots ?? []]);
      if (!this.handles(file)) {
        throw new Error(`${path.relative(context.root, file)} hat keine ${this.adapter.label}-Endung (${Object.keys(this.adapter.languages).join(", ")})`);
      }
      const chosen = this.#match(roots, file);
      if (!chosen) {
        throw new Error(`${path.relative(context.root, file)} liegt in keiner geöffneten ${this.adapter.label}-Wurzel; offen: ${roots.join(", ")}`);
      }
      results.push(await this.#format(context, await this.#ensure(runId, context, chosen), file, includeWarnings));
    }
    return results;
  }

  #match(roots: readonly string[], file: string): string | undefined {
    return [...roots]
      .filter((root) => containsWorkspacePath(this.adapter.rootDirectory(root), file))
      .sort((left, right) => this.adapter.rootDirectory(right).length - this.adapter.rootDirectory(left).length)[0];
  }

  async #known(runId: string, context: WorkspaceProcessContext, root: string): Promise<string> {
    const roots = this.#openRoots(runId);
    if (roots.length === 0) throw new Error(`Kein ${this.adapter.label}-Server geöffnet; zuerst ${this.adapter.id}_open aufrufen`);
    const lexical = path.resolve(context.root, expandWorkspaceAlias(root, context.workspaceAliases ?? {}));
    const requested = await resolvedWorkspacePath(lexical);
    const found = roots.find((open) => open === requested || open === lexical);
    if (!found) throw new Error(`Für ${root} ist kein ${this.adapter.label}-Server geöffnet; offen: ${roots.join(", ")}`);
    return found;
  }

  async #format(
    context: WorkspaceProcessContext,
    server: OpenServer,
    absolutePath: string,
    includeWarnings: boolean,
  ): Promise<string> {
    this.#touch(context.runId, server.root);
    const key = keyOf(context.runId, server.root);
    const checkedPath = await allowedWorkspacePath(absolutePath, [context.root, ...context.additionalRoots ?? []]);
    const diagnostics = await server.session.diagnosticsFor(await realpath(checkedPath), this.#diagnosticsTimeoutMs);
    if (this.#servers.get(key)?.server !== server) throw this.#stopped();
    const alias = Object.entries(context.workspaceAliases ?? {}).find(([, root]) => containsWorkspacePath(root, checkedPath));
    const relativePath = alias ? `${alias[0]}/${path.relative(alias[1], checkedPath)}`
      : containsWorkspacePath(context.root, checkedPath) ? path.relative(context.root, checkedPath) : checkedPath;
    const seen = this.#seen.get(key) ?? new Map<string, readonly LanguageServerDiagnostic[]>();
    seen.set(relativePath, diagnosticEntries(diagnostics));
    this.#seen.set(key, seen);
    return formatDiagnostics(this.adapter.label, relativePath, diagnostics, includeWarnings);
  }

  #openRoots(runId: string): string[] {
    return [...this.#roots.get(runId) ?? []];
  }

  #remember(runId: string, root: string): void {
    const roots = this.#roots.get(runId) ?? new Set<string>();
    roots.add(root);
    this.#roots.set(runId, roots);
  }

  async #closeInstance(runId: string, root: string): Promise<void> {
    const roots = this.#roots.get(runId);
    roots?.delete(root);
    if (roots?.size === 0) this.#roots.delete(runId);
    const key = keyOf(runId, root);
    this.#seen.delete(key);
    await this.#close(key);
  }

  #current(runId: string, root: string): ServerEntry | undefined {
    const key = keyOf(runId, root);
    const current = this.#servers.get(key);
    if (current?.server?.session.exited) {
      this.#servers.delete(key);
      void this.#dispose(current).catch((error) => console.error(`${this.adapter.label}: Bereinigung fehlgeschlagen: ${messageOf(error)}`));
      return undefined;
    }
    return current;
  }

  async #ensure(runId: string, context: WorkspaceProcessContext, root: string): Promise<OpenServer> {
    if (this.#closed) throw this.#stopped();
    const current = this.#current(runId, root);
    if (current?.state === "failed") throw new Error(current.summary);
    if (current) {
      const server = await current.pending!;
      this.#assertCurrent(current);
      return server;
    }
    return this.#start(runId, context, root);
  }

  #start(runId: string, context: WorkspaceProcessContext, root: string): Promise<OpenServer> {
    const key = keyOf(runId, root);
    const previous = this.#servers.get(key);
    const closing = previous ? this.#dispose(previous) : undefined;
    const entry: ServerEntry = {
      runId, root, state: "opening", summary: `${this.adapter.label} lädt ${root}`, controller: new AbortController(),
    };
    this.#servers.set(key, entry);
    this.#remember(runId, root);
    this.#seen.delete(key);
    entry.pending = (async (): Promise<OpenServer> => {
      try {
        await closing;
        this.#assertCurrent(entry);
        const launch = await this.adapter.launch(context, root);
        this.#assertCurrent(entry);
        entry.initializing = LanguageServerSession.start(launch, this.#openTimeoutMs);
        const session = await entry.initializing;
        this.#assertCurrent(entry);
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
        this.#assertCurrent(entry);
        if (session.exited) throw new Error(`${this.adapter.label} wurde während des Ladens beendet`);
        const server = { root, session, summary };
        entry.server = server;
        entry.state = "ready";
        entry.summary = summary;
        this.#touch(runId, root);
        return server;
      } catch (error) {
        if (this.#servers.get(key) === entry && !entry.controller.signal.aborted) {
          entry.state = "failed";
          entry.summary = messageOf(error);
        }
        await this.#dispose(entry);
        throw error;
      }
    })();
    return entry.pending;
  }

  async #close(key: string): Promise<void> {
    const timer = this.#idleTimers.get(key);
    if (timer) clearTimeout(timer);
    this.#idleTimers.delete(key);
    const entry = this.#servers.get(key);
    if (!entry) return;
    this.#servers.delete(key);
    await this.#dispose(entry);
  }

  #dispose(entry: ServerEntry): Promise<void> {
    entry.controller.abort(this.#stopped());
    if (entry.closing) return entry.closing;
    entry.closing = (async () => {
      const session = await entry.initializing?.catch(() => undefined);
      await session?.shutdown();
    })();
    const pending = this.#closing.get(entry.runId) ?? new Set<Promise<void>>();
    this.#closing.set(entry.runId, pending);
    pending.add(entry.closing);
    const finished = () => {
      pending.delete(entry.closing!);
      if (pending.size === 0 && this.#closing.get(entry.runId) === pending) this.#closing.delete(entry.runId);
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

  #assertCurrent(entry: ServerEntry): void {
    if (this.#closed
      || entry.controller.signal.aborted
      || entry.server?.session.exited
      || this.#servers.get(keyOf(entry.runId, entry.root)) !== entry) throw this.#stopped();
  }

  #stopped(): Error {
    return new Error(`${this.adapter.label}-Start wurde beendet`);
  }

  #touch(runId: string, root: string): void {
    const key = keyOf(runId, root);
    const entry = this.#servers.get(key);
    if (!entry || entry.state !== "ready") return;
    const existing = this.#idleTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.#idleTimers.delete(key);
      if (this.#servers.get(key) !== entry) return;
      void this.#close(key).catch((error) => console.error(`${this.adapter.label}: Beenden nach Leerlauf fehlgeschlagen: ${messageOf(error)}`));
    }, this.#idleMs);
    timer.unref();
    this.#idleTimers.set(key, timer);
  }
}
