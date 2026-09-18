import type { AccessSnapshot } from "../../../packages/ragents/src/access";
import { accessSnapshotFrom } from "../../web/src/access-session";
import type { SessionInfo } from "../../web/src/api";

export class ServerError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "ServerError";
  }
}

export class UnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreachableError";
  }
}

export const isSessionInfo = (value: unknown): value is SessionInfo =>
  typeof value === "object" && value !== null && typeof (value as SessionInfo).id === "string"
  && typeof (value as SessionInfo).title === "string" && typeof (value as SessionInfo).updatedAt === "number";

const sessionTokenFrom = (setCookie: readonly string[]): string => {
  for (const cookie of setCookie) {
    const pair = cookie.split(";")[0] ?? "";
    const token = pair.slice(pair.indexOf("=") + 1).trim();
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) return token;
  }
  throw new ServerError("Der Server hat keinen Sitzungstoken geliefert.", 500);
};

const errorFrom = async (response: Response): Promise<ServerError> => {
  let message = `Der Server antwortete mit ${response.status}.`;
  let code: string | undefined;
  try {
    const body = await response.json() as { error?: unknown; message?: unknown; code?: unknown };
    if (typeof body.error === "string" && body.error) message = body.error;
    else if (typeof body.message === "string" && body.message) message = body.message;
    if (typeof body.code === "string") code = body.code;
  } catch {}
  return new ServerError(message, response.status, code);
};

/** Der HTTP-Zugang der Erweiterung: dieselben Routen wie apps/web/src/api.ts, der Sitzungstoken als Bearer statt als Cookie. */
export class ServerClient {
  readonly origin: string;

  constructor(readonly baseUrl: string, private token: string | undefined, private readonly request: typeof fetch = fetch) {
    this.origin = new URL(baseUrl).origin;
  }

  get hasToken(): boolean {
    return this.token !== undefined;
  }

  get accessToken(): string | undefined {
    return this.token;
  }

  useToken(token: string | undefined): void {
    this.token = token;
  }

  url(path: string): string {
    return new URL(path, `${this.origin}/`).toString();
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.token === undefined ? extra : { ...extra, authorization: `Bearer ${this.token}` };
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await this.request(this.url(path), { ...init, headers: this.headers(init.headers as Record<string, string> | undefined ?? {}) });
    } catch (cause) {
      throw new UnreachableError(`${this.origin} ist nicht erreichbar: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  async json<T>(path: string, init: RequestInit = {}, validate: (value: unknown) => T = (value) => value as T): Promise<T> {
    const response = await this.fetch(path, init);
    if (!response.ok) throw await errorFrom(response);
    return validate(await response.json());
  }

  access(): Promise<AccessSnapshot> {
    return this.json("/api/access", { cache: "no-store" }, accessSnapshotFrom);
  }

  async login(id: string, password: string): Promise<{ snapshot: AccessSnapshot; token: string }> {
    const response = await this.fetch("/api/access/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, password }),
    });
    if (!response.ok) throw await errorFrom(response);
    const snapshot = accessSnapshotFrom(await response.json());
    if (!snapshot.user) throw new ServerError("Der Server hat die Anmeldung nicht bestätigt.", 500);
    return { snapshot, token: sessionTokenFrom(response.headers.getSetCookie()) };
  }

  async logout(): Promise<void> {
    const response = await this.fetch("/api/access/logout", { method: "POST" });
    if (!response.ok && response.status !== 401) throw await errorFrom(response);
  }

  sessions(): Promise<SessionInfo[]> {
    return this.json("/chat/sessions", { cache: "no-store" }, (value) => {
      if (!Array.isArray(value) || !value.every(isSessionInfo)) throw new ServerError("Die Run-Liste hat nicht das erwartete Format.", 500);
      return value;
    });
  }

  async runView(runId: string): Promise<unknown> {
    const response = await this.fetch(`/chat/${encodeURIComponent(runId)}/run`, { cache: "no-store" });
    if (response.status === 404) return undefined;
    if (!response.ok) throw await errorFrom(response);
    return (await response.json()) ?? undefined;
  }

  async stopRun(runId: string, reason: string): Promise<void> {
    const response = await this.fetch(`/ragents/api/runs/${encodeURIComponent(runId)}/stop-all`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: crypto.randomUUID(), reason }),
    });
    if (!response.ok) throw await errorFrom(response);
  }

  journal(runId: string): Promise<unknown[]> {
    return this.json(`/ragents/api/runs/${encodeURIComponent(runId)}/events`, { cache: "no-store" }, (value) => {
      if (!Array.isArray(value)) throw new ServerError("Das Journal hat nicht das erwartete Format.", 500);
      return value;
    });
  }

  async artifactText(runId: string, artifactId: string): Promise<string> {
    const response = await this.fetch(`/ragents/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}/content`, { cache: "no-store" });
    if (!response.ok) throw await errorFrom(response);
    return response.text();
  }

  artifactUrl(runId: string, artifactId: string): string {
    return this.url(`/ragents/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}/content`);
  }

  async subscribe(connection: string, channel: string): Promise<void> {
    const response = await this.fetch(`/api/events/${connection}/subscriptions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel }),
    });
    if (!response.ok) throw await errorFrom(response);
  }

  async unsubscribe(connection: string, channel: string): Promise<void> {
    await this.fetch(`/api/events/${connection}/subscriptions/${encodeURIComponent(channel)}`, { method: "DELETE" }).catch(() => undefined);
  }
}
