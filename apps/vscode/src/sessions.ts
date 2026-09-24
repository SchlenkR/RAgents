import type { WorkspaceClient } from "../../../plugins/ragents.workspace/client/workspace-client";
import { missingEnvironmentOf, type MissingEnvironment } from "../../server/src/missing-environment";
import { connectionSecretKey, credentialsSecretKey, type Connection } from "./connections";
import type { RunningHost } from "./host-process";
import type { RunSummary } from "./run-model";
import { ServerClient } from "./server-client";
import { RunStore, type ConnectionStatus, type StartEntrySummary } from "./store";
import { workspaceRegistrationRefusal } from "./workspace-identity";

/** Zustand einer Umgebung: nicht gestartet, im Aufbau, gescheitert oder der Verbindungszustand seiner Sitzung. */
export type SessionStatus =
  | { kind: "stopped" }
  | { kind: "starting"; detail: string | undefined }
  | { kind: "failed"; message: string }
  | ConnectionStatus;

/** Wohin die Sitzung spricht, nachdem die Umgebung gestartet ist. */
export interface LaunchedTarget {
  url: string;
  token: string | undefined;
  host: RunningHost | undefined;
}

export interface SecretStore {
  get: (key: string) => Thenable<string | undefined>;
  store: (key: string, value: string) => Thenable<void>;
  delete: (key: string) => Thenable<void>;
}

export interface SessionServices {
  /** Der Arbeitsplatz dieses Fensters mit den Ordnern, die er gerade anbietet. */
  workspaceClient: (transport: { rpc: ServerClient["rpc"] }) => WorkspaceClient;
  secrets: SecretStore;
  /** Adresse und Token der Umgebung: beim Server die gespeicherte Sitzung, beim Profil der frisch gestartete Host. */
  launch: (connection: Connection, report: (detail: string) => void) => Promise<LaunchedTarget>;
  log: (line: string) => void;
  /** Ein verbundener Server wird einmal gefragt, ob er ein Client-Profil verteilt. */
  probe: (session: TargetSession) => void;
  /** Der lokale Host einer Umgebung hat von selbst geendet. */
  onHostExit: (session: TargetSession, code: number | null) => void;
}

/** Alles, was die Seiten und die Befehle der Erweiterung von einer Umgebung brauchen; ohne VS-Code-Typen. */
export interface TargetSnapshot {
  connection: Connection;
  status: SessionStatus;
  url: string | undefined;
  /** Die Sitzung spricht mit einem Host, den die Erweiterung selbst gestartet hat; bei einem Server ist das sein verteiltes Profil. */
  localHost: boolean;
  runs: readonly RunSummary[];
  entries: readonly StartEntrySummary[];
  /** Die Vorlage, die das Plus und die erste Kachel der Umgebung nehmen; ohne sie ist ein neuer Run ein leerer Chat. */
  defaultEntry: string | undefined;
  user: string | undefined;
  canCreate: boolean;
  loginUser: string | undefined;
  savedLogin: boolean;
  problem: string | undefined;
  /** Der letzte Versuch scheiterte an einer Umgebungsvariablen, die die Konfiguration mit env("NAME") nennt. */
  missingEnvironment: MissingEnvironment | undefined;
}

interface SessionParts {
  url: string;
  client: ServerClient;
  store: RunStore;
  workspaceClient: WorkspaceClient;
  host: RunningHost | undefined;
}

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** Eine Umgebung mit ihrer eigenen Sitzung: Verbindung, Runs, Arbeitsplatz und, bei einem lokalen Profil, ihr Host. */
export class TargetSession {
  #status: SessionStatus = { kind: "stopped" };
  #parts: SessionParts | undefined;
  #releases: Array<() => void> = [];
  #listeners = new Set<() => void>();
  #connecting: Promise<void> | undefined;
  /** Zählt Starts und Trennungen; ein Start, den ein Trennen überholt hat, wirft sein Ergebnis weg. */
  #generation = 0;
  #registering = false;
  #probed: boolean;
  #autoLoginTried = false;
  #loginUser: string | undefined;
  #savedLogin = false;
  #problem: string | undefined;
  #missingEnvironment: MissingEnvironment | undefined;

  constructor(readonly connection: Connection, private readonly services: SessionServices) {
    this.#probed = connection.kind !== "server";
    void this.#readSavedLogin();
  }

  get name(): string {
    return this.connection.name;
  }

  get status(): SessionStatus {
    return this.#parts ? this.#parts.store.status : this.#status;
  }

  get store(): RunStore | undefined {
    return this.#parts?.store;
  }

  get client(): ServerClient | undefined {
    return this.#parts?.client;
  }

  get workspaceClient(): WorkspaceClient | undefined {
    return this.#parts?.workspaceClient;
  }

  get url(): string | undefined {
    return this.#parts?.url;
  }

  get host(): RunningHost | undefined {
    return this.#parts?.host;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** Startet die Umgebung, wenn sie noch nicht läuft: Host holen, Sitzung aufbauen, verbinden. */
  connect(): Promise<void> {
    if (this.#parts) return this.reconnect();
    this.#connecting ??= this.#launch().finally(() => { this.#connecting = undefined; });
    return this.#connecting;
  }

  async #launch(): Promise<void> {
    const generation = ++this.#generation;
    this.#problem = undefined;
    this.#missingEnvironment = undefined;
    this.#set({ kind: "starting", detail: undefined });
    try {
      const launched = await this.services.launch(this.connection, (detail) => this.#set({ kind: "starting", detail }));
      if (generation !== this.#generation) { await launched.host?.stop(); return; }
      await this.attach(launched);
    } catch (cause) {
      if (generation !== this.#generation) return;
      this.services.log(`== ${this.name}: ${messageOf(cause)}`);
      this.#missingEnvironment = missingEnvironmentOf(cause);
      this.#set({ kind: "failed", message: messageOf(cause) });
    }
  }

  /** Baut die Sitzung gegen eine Adresse auf; auch der Weg nach der Übernahme eines servergelieferten Profils. */
  async attach(launched: LaunchedTarget): Promise<void> {
    await this.#detach();
    const client = new ServerClient(launched.url, launched.token);
    const store = new RunStore(client);
    const workspaceClient = this.services.workspaceClient(client);
    const parts: SessionParts = { url: launched.url, client, store, workspaceClient, host: launched.host };
    this.#parts = parts;
    this.#releases.push(
      store.onChange(() => this.#storeChanged(parts)),
      workspaceClient.onChange(() => this.#notify()),
    );
    if (launched.host) {
      void launched.host.exited.then((code) => {
        if (this.#parts !== parts) return;
        this.services.onHostExit(this, code);
      });
    }
    this.#notify();
    await this.reconnect();
  }

  /** Verbindet die bestehende Sitzung neu und meldet danach den Arbeitsplatz an. */
  async reconnect(): Promise<void> {
    const parts = this.#parts;
    if (!parts) return this.connect();
    this.#problem = undefined;
    this.#missingEnvironment = undefined;
    await parts.store.start();
    await this.registerWorkspaceClient();
  }

  /** Ein neuer Versuch nach einem Fehlschlag; scheiterte die Übernahme eines verteilten Profils, beginnt die Sitzung von vorn. */
  async retry(): Promise<void> {
    if (this.#missingEnvironment !== undefined && this.#parts) await this.disconnect();
    await this.connect();
  }

  /** Ein Fehlschlag neben dem Start, etwa beim Übernehmen eines verteilten Profils; er steht danach an der Umgebung. */
  reportProblem(cause: unknown): void {
    this.#problem = messageOf(cause);
    this.#missingEnvironment = missingEnvironmentOf(cause);
    this.#notify();
  }

  /** Beendet die Sitzung: Arbeitsplatz abmelden, Kanäle schließen, einen eigenen Host stoppen. */
  async disconnect(): Promise<void> {
    this.#generation += 1;
    await this.#detach();
    this.#autoLoginTried = false;
    this.#probed = this.connection.kind !== "server";
    this.#missingEnvironment = undefined;
    this.#set({ kind: "stopped" });
  }

  async #detach(): Promise<void> {
    const parts = this.#parts;
    if (!parts) return;
    this.#parts = undefined;
    for (const release of this.#releases.splice(0)) release();
    await parts.workspaceClient.unregister().catch(() => undefined);
    parts.store.dispose();
    if (parts.host) {
      this.services.log(`== Host ${parts.host.url} beenden`);
      await parts.host.stop();
    }
  }

  /** Der Arbeitsplatz meldet sich an, sobald der Server antwortet, und bietet dabei die geöffneten Ordner an. */
  async registerWorkspaceClient(): Promise<void> {
    const parts = this.#parts;
    if (!parts || this.#registering || parts.store.status.kind !== "connected" || parts.workspaceClient.folders.length === 0) return;
    if (workspaceRegistrationRefusal(parts.store.access, parts.url) !== undefined) return;
    this.#registering = true;
    try {
      await parts.workspaceClient.register();
    } finally {
      this.#registering = false;
    }
  }

  async updateFolders(folders: readonly string[]): Promise<void> {
    const parts = this.#parts;
    if (!parts) return;
    await parts.workspaceClient.update(folders);
    await this.registerWorkspaceClient();
  }

  /** Benutzer und Passwort bleiben je Server in der SecretStorage; die nächste Sitzung meldet sich damit still an. */
  async loginWith(user: string, password: string): Promise<void> {
    const parts = this.#parts;
    if (!parts) throw new Error(`Die Umgebung ${this.name} ist nicht verbunden.`);
    this.#problem = undefined;
    this.#loginUser = user.trim();
    try {
      const { token } = await parts.client.login(user.trim(), password);
      const key = credentialsSecretKey(this.connection);
      if (key && !parts.host) {
        await this.services.secrets.store(key, JSON.stringify({ user: user.trim(), password }));
        this.#savedLogin = true;
      }
      await this.useToken(token);
    } catch (cause) {
      this.#problem = messageOf(cause);
      this.#notify();
    }
  }

  /** Ein Profil mit ACCESS_TOKEN fragt statt nach Benutzer und Passwort nach dem Token. */
  async loginWithToken(token: string): Promise<void> {
    const parts = this.#parts;
    if (!parts) throw new Error(`Die Umgebung ${this.name} ist nicht verbunden.`);
    this.#problem = undefined;
    const previous = parts.client.accessToken;
    parts.client.useToken(token.trim());
    try {
      await parts.client.access();
    } catch (cause) {
      parts.client.useToken(previous);
      this.#problem = messageOf(cause);
      this.#notify();
      return;
    }
    await this.useToken(token.trim());
  }

  /** Setzt den Sitzungstoken, merkt ihn je Server und verbindet damit neu. */
  async useToken(token: string | undefined): Promise<void> {
    const parts = this.#parts;
    if (!parts) throw new Error(`Die Umgebung ${this.name} ist nicht verbunden.`);
    parts.client.useToken(token);
    const key = connectionSecretKey(this.connection);
    if (key && !parts.host) {
      if (token === undefined) await this.services.secrets.delete(key);
      else await this.services.secrets.store(key, token);
    }
    this.#notify();
    await this.reconnect();
  }

  /** Die gespeicherten Anmeldedaten gehen zuerst; sonst blieben sie liegen, wenn der Server das Abmelden ablehnt. */
  async logout(): Promise<void> {
    const parts = this.#parts;
    if (!parts) return;
    await this.forgetCredentials();
    this.#autoLoginTried = true;
    try {
      await parts.client.logout();
    } catch (cause) {
      this.#problem = messageOf(cause);
      this.#notify();
      return;
    }
    await this.useToken(undefined);
  }

  /** Löscht die gespeicherten Anmeldedaten dieses Servers, ohne die Sitzung zu beenden. */
  async forgetCredentials(): Promise<void> {
    const key = credentialsSecretKey(this.connection);
    if (!key) return;
    await this.services.secrets.delete(key);
    this.#savedLogin = false;
    this.#notify();
  }

  /** Alles, was ein gemerkter Token und gespeicherte Anmeldedaten dieser Umgebung sind, verschwindet mit ihr. */
  async forgetSecrets(): Promise<void> {
    for (const key of [connectionSecretKey(this.connection), credentialsSecretKey(this.connection)]) {
      if (key) await this.services.secrets.delete(key);
    }
    this.#savedLogin = false;
  }

  snapshot(): TargetSnapshot {
    const parts = this.#parts;
    const store = parts?.store;
    return {
      connection: this.connection,
      status: this.status,
      url: parts?.url,
      localHost: parts?.host !== undefined,
      runs: store?.runs ?? [],
      entries: store?.startEntries ?? [],
      defaultEntry: store?.defaultEntry,
      user: store?.user?.label,
      canCreate: store?.canCreate ?? false,
      loginUser: this.#loginUser,
      savedLogin: this.#savedLogin,
      problem: this.#problem ?? this.#workspaceProblem(parts),
      missingEnvironment: this.#missingEnvironment,
    };
  }

  /** Warum der Arbeitsplatz dieses Fensters bei der verbundenen Umgebung nicht angemeldet ist. */
  #workspaceProblem(parts: SessionParts | undefined): string | undefined {
    if (!parts || parts.store.status.kind !== "connected" || parts.workspaceClient.folders.length === 0) return undefined;
    const refusal = workspaceRegistrationRefusal(parts.store.access, parts.url);
    if (refusal !== undefined) return refusal;
    const status = parts.workspaceClient.status;
    return status.kind === "failed" ? `Arbeitsplatz nicht angemeldet: ${status.message}` : undefined;
  }

  #storeChanged(parts: SessionParts): void {
    if (this.#parts !== parts) return;
    const status = parts.store.status;
    if (parts.workspaceClient.status.kind === "idle") void this.registerWorkspaceClient();
    if (status.kind === "login-required" && !status.tokenGate && !this.#autoLoginTried) void this.#loginWithSavedCredentials();
    if (status.kind === "connected" && !this.#probed) {
      this.#probed = true;
      this.services.probe(this);
    }
    this.#notify();
  }

  async #readSavedLogin(): Promise<void> {
    const key = credentialsSecretKey(this.connection);
    if (!key) return;
    this.#savedLogin = (await this.services.secrets.get(key)) !== undefined;
    this.#notify();
  }

  async #loginWithSavedCredentials(): Promise<void> {
    this.#autoLoginTried = true;
    const key = credentialsSecretKey(this.connection);
    const raw = key ? await this.services.secrets.get(key) : undefined;
    if (!raw || !this.#parts) return;
    const parsed = JSON.parse(raw) as { user?: unknown; password?: unknown };
    if (typeof parsed.user !== "string" || typeof parsed.password !== "string") return;
    this.services.log(`== Anmeldung bei ${this.name} als ${parsed.user} mit gespeicherten Anmeldedaten`);
    await this.loginWith(parsed.user, parsed.password);
  }

  #set(status: SessionStatus): void {
    this.#status = status;
    this.#notify();
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}
