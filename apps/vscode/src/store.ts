import type { AccessUser } from "../../../packages/ragents/src/access";
import { runContracts } from "../../../packages/ragents/src/http/contracts";
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

/** Ein abgelehnter Aufruf kommt je nach Weg als HTTP-Fehler der Anmeldung oder als Fachfehler der Nachrichtenschicht. */
const rejectionOf = (cause: unknown): { status: number | undefined; code: string | undefined } => {
  if (cause instanceof ServerError) return { status: cause.status, code: cause.code };
  if (cause instanceof RpcError) return { status: cause.status, code: cause.domainCode };
  return { status: undefined, code: undefined };
};

interface CachedView {
  revision: number | undefined;
  view: unknown;
}

/** Runs, Laufansichten und Verbindungszustand der Erweiterung; Explorer, Abzeichen und Spalte lesen nur hier. */
export class RunStore {
  #status: ConnectionStatus = { kind: "connecting" };
  #user: AccessUser | null = null;
  #sessions: SessionInfo[] = [];
  #views = new Map<string, CachedView>();
  #summaries = new Map<string, { session: SessionInfo; view: unknown; summary: RunSummary }>();
  #listeners = new Set<() => void>();
  #selected: string | undefined;
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

  get streamStatus(): RpcStreamStatus {
    return this.client.rpc.status;
  }

  get user(): AccessUser | null {
    return this.#user;
  }

  get selectedRunId(): string | undefined {
    return this.#selected;
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

  get pendingQuestions(): number {
    return this.runs.reduce((sum, run) => sum + run.questions, 0);
  }

  /** Verbindet neu: Zugang prüfen, Liste laden, Kanäle anmelden. Läuft auch nach Anmeldung und Serverwechsel. */
  async start(): Promise<void> {
    const generation = ++this.#generation;
    this.stop();
    this.#set({ kind: "connecting" });
    try {
      const access = await this.client.access();
      if (generation !== this.#generation) return;
      if (access.enabled && !access.user) {
        this.#set({ kind: "login-required", tokenGate: false });
        return;
      }
      this.#user = access.user;
    } catch (cause) {
      if (generation !== this.#generation) return;
      this.#fail(cause);
      // Ein fehlender Server wird sichtbar gemeldet und alle fünf Sekunden erneut versucht; der Explorer zeigt beides.
      if (this.#status.kind === "unreachable") this.#reconnect = setTimeout(() => { this.#reconnect = undefined; void this.start(); }, RECONNECT_DELAY_MS);
      return;
    }
    this.#set({ kind: "connected" });
    this.#sessionsSubscription = this.client.rpc.subscribe(coreContracts.channels.sessions, {}, () => void this.refresh());
    for (const runId of this.#watches.keys()) this.#subscribeRun(runId);
    this.#poll = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
    await this.refresh();
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

  select(runId: string | undefined): void {
    if (this.#selected === runId) return;
    this.#selected = runId;
    this.#notify();
  }

  /** Solange ein Run beobachtet wird, folgt seine Laufansicht dem Run-Kanal statt nur der Liste. */
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
      const sessions = await this.client.rpc.call(coreContracts.sessions.list, {});
      if (generation !== this.#generation) return;
      this.#sessions = sessions;
      for (const runId of this.#views.keys()) if (!sessions.some((session) => session.id === runId)) this.#views.delete(runId);
      if (this.#status.kind !== "connected") this.#set({ kind: "connected" });
      else this.#notify();
      await Promise.all(sessions
        .filter((session) => this.#views.get(session.id)?.revision !== session.revision)
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
      this.#user = null;
      this.#set({ kind: "login-required", tokenGate: code !== "login-required" });
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
      this.#user = null;
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
