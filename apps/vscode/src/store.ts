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

/** Eine Vorlage des Servers, so wie die Start-Seite sie zeigt. */
export interface StartEntrySummary {
  id: string;
  title: string;
  description: string;
  action: "skill" | "script";
  /** Die Gruppe der Vorlagen; ein Run-Script ohne eigene Kategorie steht unter "Run-Scripts". */
  category: string;
  /** Was die Vorlage an Startoptionen festlegt; "Neuer Run" belegt davon nichts vor. */
  fixedStartOptions?: Readonly<Record<string, unknown>>;
  /** Der Leitfaden, der vor dem Start fragt; das Run-Panel öffnet ihn, die Vorlage sagt dann "Einrichten". */
  guide?: string;
}

/** Runs, Run-Ansichten und Verbindungszustand der Erweiterung; Seiten, Abzeichen und Panel lesen nur hier. */
export class RunStore {
  #status: ConnectionStatus = { kind: "connecting" };
  #access: AccessSnapshot = { enabled: false, user: null };
  /** /api/access hat geantwortet: der Server führt Benutzer, eine Anmeldung ist Benutzer und Passwort. */
  #usersKnown = false;
  #entries: StartEntrySummary[] = [];
  #defaultEntry: string | undefined;
  #product: string | undefined;
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

  /** Die freigegebenen Vorlagen des Servers; der Server filtert sie schon nach den Rechten. */
  get startEntries(): readonly StartEntrySummary[] {
    return this.#entries;
  }

  /** Die Default-Vorlage, die das Profil einem neuen Run vorgibt; sie ist immer eine der freigegebenen Vorlagen. */
  get defaultEntry(): string | undefined {
    return this.#defaultEntry;
  }

  get product(): string | undefined {
    return this.#product;
  }

  /** Ein neuer Run ist möglich: entweder frei oder über mindestens eine freigegebene Vorlage. */
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

  /** Verbindet neu: Zugang prüfen, Liste laden, Kanäle anmelden. Läuft auch nach Anmeldung und Serverwechsel. */
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
      // Ein fehlender Server wird sichtbar gemeldet und alle fünf Sekunden erneut versucht; die Seiten der Erweiterung zeigen beides.
      if (this.#status.kind === "unreachable") this.#reconnect = setTimeout(() => { this.#reconnect = undefined; void this.start(); }, RECONNECT_DELAY_MS);
      return;
    }
    this.#set({ kind: "connected" });
    this.#sessionsSubscription = this.client.rpc.subscribe(coreContracts.channels.runs, {}, () => void this.refresh());
    for (const runId of this.#watches.keys()) this.#subscribeRun(runId);
    this.#poll = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
    await Promise.all([this.#loadProfile(generation), this.refresh()]);
  }

  /** Produkt und freigegebene Vorlagen des Servers; die Übersicht bietet sie je Server an. */
  async #loadProfile(generation: number): Promise<void> {
    try {
      const profile = await this.client.rpc.call(coreContracts.plugins.bootstrap, {});
      if (generation !== this.#generation) return;
      const defaultEntry = profile.defaultStartEntry;
      if (defaultEntry !== undefined && !profile.startEntries.some((entry: PublicStartEntry) => entry.id === defaultEntry)) {
        throw new Error(`Der Server nennt die Default-Vorlage ${defaultEntry}, liefert sie aber nicht als Vorlage`);
      }
      this.#product = profile.product.title;
      this.#entries = profile.startEntries.map((entry: PublicStartEntry) => ({
        id: entry.id,
        title: entry.title,
        description: entry.description,
        action: entry.action,
        category: entry.category ?? "Run-Scripts",
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


  /** Solange ein Run beobachtet wird, folgt seine Run-Ansicht dem Run-Kanal statt nur der Liste. */
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
