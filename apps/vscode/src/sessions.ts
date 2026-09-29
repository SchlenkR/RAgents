import type { WorkspaceClient, WorkspaceClientStatus } from "../../../plugins/ragents.workspace/client/workspace-client";
import { missingEnvironmentOf, type MissingEnvironment } from "../../server/src/missing-environment";
import { connectionSecretKey, credentialsSecretKey, type Connection } from "./connections";
import type { RunningHost } from "./host-process";
import type { RunSummary } from "./run-model";
import { ServerClient } from "./server-client";
import { RunStore, type ConnectionStatus, type StartEntrySummary } from "./store";
import { workspaceRegistrationRefusal } from "./workspace-identity";

/** State of a server: not started, being set up, failed, or the connection state of its session. */
export type SessionStatus =
  | { kind: "stopped" }
  | { kind: "starting"; detail: string | undefined }
  | { kind: "failed"; message: string }
  | ConnectionStatus;

/** Where the session talks to after the server has started. */
export interface LaunchedConnection {
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
  /** The RAgents version of this extension (ragents.packageVersion, equal to its own); every server is compared with it. */
  version: string;
  /** The workspace of this window with the folders it currently offers. */
  workspaceClient: (transport: { rpc: ServerClient["rpc"] }) => WorkspaceClient;
  secrets: SecretStore;
  /** Address and token of the server: for an address the stored session, for a profile the freshly started host. */
  launch: (connection: Connection, report: (detail: string) => void) => Promise<LaunchedConnection>;
  log: (line: string) => void;
  /** A connected server is asked once whether it distributes a client profile. */
  probe: (session: ConnectionSession) => void;
  /** The local host of a server has ended on its own. */
  onHostExit: (session: ConnectionSession, code: number | null) => void;
}

/** Everything the pages and commands of the extension need from a server; without VS Code types. */
export interface ConnectionSnapshot {
  connection: Connection;
  status: SessionStatus;
  url: string | undefined;
  /** The session talks to a host the extension started itself; for a server, that is its distributed profile. */
  localHost: boolean;
  runs: readonly RunSummary[];
  entries: readonly StartEntrySummary[];
  /** The template the server's plus uses and that comes first on Start; without it, a new run is an empty chat. */
  defaultEntry: string | undefined;
  user: string | undefined;
  canCreate: boolean;
  loginUser: string | undefined;
  savedLogin: boolean;
  problem: string | undefined;
  /** The last attempt failed on an environment variable that the configuration names with env("NAME"). */
  missingEnvironment: MissingEnvironment | undefined;
  /** Extension and server carry a different RAgents version or a different revision. */
  versionNotice: VersionNotice | undefined;
}

/** What does not match about the version: error if the workspace is therefore not registered, otherwise warning; update names the side that needs updating. */
export interface VersionNotice {
  level: "error" | "warning";
  text: string;
  update: "extension" | "server" | undefined;
}

const versionParts = (version: string): readonly number[] | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? match.slice(1).map(Number) : undefined;
};

/** Which side is older; without a readable version, this cannot be said. */
const olderSide = (extension: string, server: string | null): "extension" | "server" | undefined => {
  if (server === null) return "server";
  const left = versionParts(extension);
  const right = versionParts(server);
  if (!left || !right) return undefined;
  const difference = left.map((part, index) => part - right[index]!).find((value) => value !== 0) ?? 0;
  return difference === 0 ? undefined : difference < 0 ? "extension" : "server";
};

export interface VersionInput {
  extension: string;
  /** undefined as long as the server has not answered; null if it names no version. */
  server: string | null | undefined;
  /** A local profile runs on the host that ragents.hostPath names; without the setting, the extension fetches its own version. */
  connection: Connection["kind"];
  workspace: WorkspaceClientStatus | undefined;
}

/** A different version is a warning as long as the workspace is registered; if the server rejects it because of that, it is an error. */
export const versionNotice = ({ extension, server, connection, workspace }: VersionInput): VersionNotice | undefined => {
  const refusal = workspace?.kind === "failed" && workspace.mismatch ? workspace.message : undefined;
  if (server === undefined || server === extension) {
    return refusal === undefined ? undefined
      : { level: "error", text: `RAgents revision does not match the server, the workspace is not registered: ${refusal}`, update: undefined };
  }
  const older = olderSide(extension, server);
  const target = older === "extension" ? server : extension;
  const action = older === "extension" ? `update the RAgents extension to ${target}`
    : older === "server" && connection === "profile" ? `bring the host at ragents.hostPath to ${target}`
    : older === "server" ? `update the server to ${target}`
    : "bring extension and server to the same version";
  const text = `RAgents version does not match: extension ${extension}, server ${server ?? "without version"} - ${action}`;
  return refusal === undefined
    ? { level: "warning", text: `${text}.`, update: older }
    : { level: "error", text: `${text}. The workspace is therefore not registered: ${refusal}`, update: older };
};

interface SessionParts {
  url: string;
  client: ServerClient;
  store: RunStore;
  workspaceClient: WorkspaceClient;
  host: RunningHost | undefined;
}

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** A server with its own session: connection, runs, workspace and, for a local profile, its host. */
export class ConnectionSession {
  #status: SessionStatus = { kind: "stopped" };
  #parts: SessionParts | undefined;
  #releases: Array<() => void> = [];
  #listeners = new Set<() => void>();
  #connecting: Promise<void> | undefined;
  /** Counts starts and disconnects; a start overtaken by a disconnect discards its result. */
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

  /** Starts the server if it is not running yet: fetch the host, set up the session, connect. */
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

  /** Sets up the session against an address; also the path after applying a server-delivered profile. */
  async attach(launched: LaunchedConnection): Promise<void> {
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

  /** Reconnects the existing session and then registers the workspace. */
  async reconnect(): Promise<void> {
    const parts = this.#parts;
    if (!parts) return this.connect();
    this.#problem = undefined;
    this.#missingEnvironment = undefined;
    await parts.store.start();
    await this.registerWorkspaceClient();
  }

  /** A new attempt after a failure; if applying a distributed profile failed, the session starts over. */
  async retry(): Promise<void> {
    if (this.#missingEnvironment !== undefined && this.#parts) await this.disconnect();
    await this.connect();
  }

  /** A failure outside the start, e.g. when applying a distributed profile; it then shows at the server. */
  reportProblem(cause: unknown): void {
    this.#problem = messageOf(cause);
    this.#missingEnvironment = missingEnvironmentOf(cause);
    this.#notify();
  }

  /** Ends the session: unregister the workspace, close channels, stop an own host. */
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
      this.services.log(`== Stopping host ${parts.host.url}`);
      await parts.host.stop();
    }
  }

  /** The workspace registers as soon as the server answers and offers the open folders. */
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

  /** User and password stay per server in the SecretStorage; the next session signs in with them silently. */
  async loginWith(user: string, password: string): Promise<void> {
    const parts = this.#parts;
    if (!parts) throw new Error(`The server ${this.name} is not connected.`);
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

  /** A profile with ACCESS_TOKEN asks for the token instead of user and password. */
  async loginWithToken(token: string): Promise<void> {
    const parts = this.#parts;
    if (!parts) throw new Error(`The server ${this.name} is not connected.`);
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

  /** Sets the session token, remembers it per server, and reconnects with it. */
  async useToken(token: string | undefined): Promise<void> {
    const parts = this.#parts;
    if (!parts) throw new Error(`The server ${this.name} is not connected.`);
    parts.client.useToken(token);
    const key = connectionSecretKey(this.connection);
    if (key && !parts.host) {
      if (token === undefined) await this.services.secrets.delete(key);
      else await this.services.secrets.store(key, token);
    }
    this.#notify();
    await this.reconnect();
  }

  /** The stored credentials go first; otherwise they would remain if the server rejects the sign-out. */
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

  /** Deletes the stored credentials of this server without ending the session. */
  async forgetCredentials(): Promise<void> {
    const key = credentialsSecretKey(this.connection);
    if (!key) return;
    await this.services.secrets.delete(key);
    this.#savedLogin = false;
    this.#notify();
  }

  /** Everything that is a remembered token or stored credentials of this server disappears with it. */
  async forgetSecrets(): Promise<void> {
    for (const key of [connectionSecretKey(this.connection), credentialsSecretKey(this.connection)]) {
      if (key) await this.services.secrets.delete(key);
    }
    this.#savedLogin = false;
  }

  snapshot(): ConnectionSnapshot {
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
      versionNotice: parts ? versionNotice({
        extension: this.services.version,
        server: parts.store.serverVersion,
        connection: this.connection.kind,
        workspace: parts.workspaceClient.status,
      }) : undefined,
    };
  }

  /** Why the workspace of this window is not registered with the connected server. */
  #workspaceProblem(parts: SessionParts | undefined): string | undefined {
    if (!parts || parts.store.status.kind !== "connected" || parts.workspaceClient.folders.length === 0) return undefined;
    const refusal = workspaceRegistrationRefusal(parts.store.access, parts.url);
    if (refusal !== undefined) return refusal;
    const status = parts.workspaceClient.status;
    return status.kind === "failed" && !status.mismatch ? `Workspace not registered: ${status.message}` : undefined;
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
    this.services.log(`== Signing in to ${this.name} as ${parsed.user} with stored credentials`);
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
