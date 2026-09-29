import { canStartEntry, hasRight, type AccessSnapshot, type AccessUser } from "../../../packages/ragents/src/access";
import { runContracts } from "../../../packages/ragents/src/http/contracts";
import type { PublicStartEntry } from "../../../packages/ragents/src/plugin-types";
import { RpcError } from "../../../packages/ragents/src/rpc/protocol";
import { coreContracts } from "../../server/src/api/contracts";
import type { SessionInfo } from "../../web/src/api";
import type { RpcStreamStatus } from "../../web/src/rpc/client";
import { runSummaryFrom, sortRuns, type RunSummary } from "./run-model";
import { ServerClient, ServerError, UnreachableError } from "./server-client";

export type ConnectionStatus =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "unreachable"; message: string }
  | { kind: "login-required"; tokenGate: boolean }
  | { kind: "forbidden"; message: string };

const POLL_INTERVAL_MS = 5000;
const VIEW_DEBOUNCE_MS = 250;
export const RECONNECT_DELAY_MS = 5000;

const revisionOf = (view: unknown): number | undefined =>
  typeof view === "object" && view !== null && "revision" in view && typeof view.revision === "number" ? view.revision : undefined;

/** Depending on the path, a rejected call arrives as an HTTP error of the sign-in or as a domain error of the messaging layer. */
const rejectionOf = (cause: unknown): { status: number | undefined; code: string | undefined } => {
  if (cause instanceof ServerError) return { status: cause.status, code: cause.code };
  if (cause instanceof RpcError) return { status: cause.status, code: cause.domainCode };
  return { status: undefined, code: undefined };
};

interface CachedView {
  revision: number | undefined;
  view: unknown;
}

/** A template of the server as the Start page shows it. */
export interface StartEntrySummary {
  id: string;
  title: string;
  description: string;
  action: "skill" | "script";
  /** The group of templates; a run script without its own category is listed under "Run scripts". */
  category: string;
  /** Which start options the template fixes; "New run" presets none of them. */
  fixedStartOptions?: Readonly<Record<string, unknown>>;
  /** The guide that asks before the start; the run panel opens it, the template then says "Set up". */
  guide?: string;
}

/** Runs, run views, and connection state of the extension; pages, badge, and panel read only here. */
export class RunStore {
  #status: ConnectionStatus = { kind: "connecting" };
  #access: AccessSnapshot = { enabled: false, user: null };
  /** /api/access has answered: the server manages users, a sign-in is user and password. */
  #usersKnown = false;
  #entries: StartEntrySummary[] = [];
  #defaultEntry: string | undefined;
  #product: string | undefined;
  #serverVersion: string | null | undefined;
  #sessions: SessionInfo[] = [];
  #views = new Map<string, CachedView>();
  #summaries = new Map<string, { session: SessionInfo; view: unknown; summary: RunSummary }>();
  #listeners = new Set<() => void>();
  #watches = new Map<string, { count: number; unsubscribe: () => void; timer: ReturnType<typeof setTimeout> | undefined }>();
  #sessionsSubscription: (() => void) | undefined;
  #poll: ReturnType<typeof setInterval> | undefined;
  #reconnect: ReturnType<typeof setTimeout> | undefined;
  #refreshing: Promise<void> | undefined;
  #generation = 0;
  readonly #releaseStatus: () => void;

  constructor(readonly client: ServerClient) {
    this.#releaseStatus = client.rpc.onStatus((status) => this.#streamChanged(status));
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  get user(): AccessUser | null {
    return this.#access.user;
  }

  get access(): AccessSnapshot {
    return this.#access;
  }

  /** The server's permitted templates; the server already filters them by rights. */
  get startEntries(): readonly StartEntrySummary[] {
    return this.#entries;
  }

  /** The default template the profile sets for a new run; it is always one of the permitted templates. */
  get defaultEntry(): string | undefined {
    return this.#defaultEntry;
  }

  get product(): string | undefined {
    return this.#product;
  }

  /** The server's RAgents version from the bootstrap; null if it names none because it is older than this field, undefined as long as it has not answered. */
  get serverVersion(): string | null | undefined {
    return this.#serverVersion;
  }

  /** A new run is possible: either free or via at least one permitted template. */
  get canCreate(): boolean {
    return hasRight(this.#access, "runs.write")
      && (hasRight(this.#access, "runs.create") || this.#entries.some((entry) => canStartEntry(this.#access, entry.id)));
  }

  get runs(): RunSummary[] {
    return sortRuns(this.#sessions.map((session) => this.run(session.id)!));
  }

  run(runId: string): RunSummary | undefined {
    const session = this.#sessions.find((entry) => entry.id === runId);
    if (!session) return undefined;
    const view = this.#views.get(runId)?.view;
    const cached = this.#summaries.get(runId);
    if (cached && cached.session === session && cached.view === view) return cached.summary;
    const summary = runSummaryFrom(session, view);
    this.#summaries.set(runId, { session, view, summary });
    return summary;
  }

  get pendingActions(): number {
    return this.runs.reduce((sum, run) => sum + run.pendingActions, 0);
  }

  /** Reconnects: check access, load the list, subscribe channels. Also runs after sign-in and server change. */
  async start(): Promise<void> {
    const generation = ++this.#generation;
    this.stop();
    this.#set({ kind: "connecting" });
    try {
      const access = await this.client.access();
      if (generation !== this.#generation) return;
      this.#usersKnown = access.enabled;
      if (access.enabled && !access.user) {
        this.#access = access;
        this.#set({ kind: "login-required", tokenGate: false });
        return;
      }
      this.#access = access;
    } catch (cause) {
      if (generation !== this.#generation) return;
      this.#fail(cause);
      // A missing server is reported visibly and retried every five seconds; the pages of the extension show both.
      if (this.#status.kind === "unreachable") this.#reconnect = setTimeout(() => { this.#reconnect = undefined; void this.start(); }, RECONNECT_DELAY_MS);
      return;
    }
    this.#set({ kind: "connected" });
    this.#sessionsSubscription = this.client.rpc.subscribe(coreContracts.channels.runs, {}, () => void this.refresh());
    for (const runId of this.#watches.keys()) this.#subscribeRun(runId);
    this.#poll = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
    await Promise.all([this.#loadProfile(generation), this.refresh()]);
  }

  /** Product and permitted templates of the server; the overview offers them per server. */
  async #loadProfile(generation: number): Promise<void> {
    try {
      const profile = await this.client.rpc.call(coreContracts.plugins.bootstrap, {});
      if (generation !== this.#generation) return;
      const defaultEntry = profile.defaultStartEntry;
      if (defaultEntry !== undefined && !profile.startEntries.some((entry: PublicStartEntry) => entry.id === defaultEntry)) {
        throw new Error(`The server names the default template ${defaultEntry} but does not deliver it as a template`);
      }
      this.#product = profile.product.title;
      this.#serverVersion = typeof profile.version === "string" && profile.version ? profile.version : null;
      this.#entries = profile.startEntries.map((entry: PublicStartEntry) => ({
        id: entry.id,
        title: entry.title,
        description: entry.description,
        action: entry.action,
        category: entry.category ?? "Run scripts",
        ...(entry.fixedStartOptions !== undefined ? { fixedStartOptions: entry.fixedStartOptions } : {}),
        ...(entry.guide !== undefined ? { guide: entry.guide } : {}),
      }));
      this.#defaultEntry = defaultEntry;
      this.#notify();
    } catch (cause) {
      if (generation !== this.#generation) return;
      this.#fail(cause);
    }
  }

  stop(): void {
    if (this.#poll !== undefined) clearInterval(this.#poll);
    this.#poll = undefined;
    if (this.#reconnect !== undefined) clearTimeout(this.#reconnect);
    this.#reconnect = undefined;
    this.#sessionsSubscription?.();
    this.#sessionsSubscription = undefined;
    for (const watch of this.#watches.values()) {
      watch.unsubscribe();
      watch.unsubscribe = () => undefined;
      if (watch.timer !== undefined) clearTimeout(watch.timer);
      watch.timer = undefined;
    }
    this.client.rpc.close();
  }

  dispose(): void {
    this.stop();
    this.#releaseStatus();
    this.#watches.clear();
    this.#listeners.clear();
  }


  /** As long as a run is watched, its run view follows the run channel instead of only the list. */
  watch(runId: string): () => void {
    const existing = this.#watches.get(runId);
    if (existing) {
      existing.count += 1;
    } else {
      this.#watches.set(runId, { count: 1, unsubscribe: () => undefined, timer: undefined });
      if (this.#status.kind === "connected") this.#subscribeRun(runId);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const watch = this.#watches.get(runId);
      if (!watch) return;
      watch.count -= 1;
      if (watch.count > 0) return;
      watch.unsubscribe();
      if (watch.timer !== undefined) clearTimeout(watch.timer);
      this.#watches.delete(runId);
    };
  }

  refresh(): Promise<void> {
    if (this.#status.kind === "login-required" || this.#status.kind === "forbidden") return Promise.resolve();
    if (this.#refreshing) return this.#refreshing;
    this.#refreshing = this.#refreshInner().finally(() => { this.#refreshing = undefined; });
    return this.#refreshing;
  }

  async #refreshInner(): Promise<void> {
    const generation = this.#generation;
    try {
      const sessions = await this.client.rpc.call(coreContracts.runs.list, {});
      if (generation !== this.#generation) return;
      this.#sessions = sessions;
      for (const runId of this.#views.keys()) if (!sessions.some((session) => session.id === runId)) this.#views.delete(runId);
      if (this.#status.kind !== "connected") this.#set({ kind: "connected" });
      else this.#notify();
      await Promise.all(sessions
        .filter((session) => session.locked === undefined && this.#views.get(session.id)?.revision !== session.revision)
        .map((session) => this.#loadView(session.id, session.revision)));
    } catch (cause) {
      if (generation !== this.#generation) return;
      this.#fail(cause);
    }
  }

  async #loadView(runId: string, revision: number | undefined): Promise<void> {
    const generation = this.#generation;
    const view = await this.client.rpc.call(runContracts.view, { runId }) ?? undefined;
    if (generation !== this.#generation) return;
    this.#views.set(runId, { revision: revision ?? revisionOf(view), view });
    this.#notify();
  }

  #subscribeRun(runId: string): void {
    const watch = this.#watches.get(runId);
    if (!watch) return;
    watch.unsubscribe();
    watch.unsubscribe = this.client.rpc.subscribe(coreContracts.channels.run, { runId }, () => {
      if (watch.timer !== undefined) return;
      watch.timer = setTimeout(() => {
        watch.timer = undefined;
        void this.#loadView(runId, undefined).then(() => this.refresh()).catch((cause: unknown) => this.#fail(cause));
      }, VIEW_DEBOUNCE_MS);
    });
  }

  #fail(cause: unknown): void {
    const { status, code } = rejectionOf(cause);
    if (status === 401) {
      this.stop();
      this.#access = { enabled: this.#usersKnown, user: null };
      this.#set({ kind: "login-required", tokenGate: !this.#usersKnown && code !== "login-required" });
      return;
    }
    if (status === 403) {
      this.#set({ kind: "forbidden", message: cause instanceof Error ? cause.message : String(cause) });
      return;
    }
    const message = cause instanceof UnreachableError || cause instanceof Error ? cause.message : String(cause);
    this.#set({ kind: "unreachable", message });
  }

  #streamChanged(status: RpcStreamStatus): void {
    if (status.kind === "unauthorized") {
      this.stop();
      this.#access = { enabled: this.#usersKnown, user: null };
      this.#set({ kind: "login-required", tokenGate: false });
      return;
    }
    this.#notify();
  }

  #set(status: ConnectionStatus): void {
    this.#status = status;
    this.#notify();
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}
