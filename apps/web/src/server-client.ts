import type { AccessSnapshot } from "../../../packages/ragents/src/access";
import { accessSnapshotFrom } from "./access-session";
import { RpcClient } from "./rpc/client";

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

const sessionTokenFrom = (setCookie: readonly string[]): string => {
  for (const cookie of setCookie) {
    const pair = cookie.split(";")[0] ?? "";
    const token = pair.slice(pair.indexOf("=") + 1).trim();
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) return token;
  }
  throw new ServerError("The server did not deliver a session token.", 500);
};

const errorFrom = async (response: Response): Promise<ServerError> => {
  let message = `The server responded with ${response.status}.`;
  let code: string | undefined;
  try {
    const body = await response.json() as { error?: unknown; message?: unknown; code?: unknown };
    if (typeof body.error === "string" && body.error) message = body.error;
    else if (typeof body.message === "string" && body.message) message = body.message;
    if (typeof body.code === "string") code = body.code;
  } catch {}
  return new ServerError(message, response.status, code);
};

/** A workstation's access: sign-in and delivery over HTTP, everything else as JSON-RPC; the session token goes as bearer. */
export interface SignInOptions {
  readonly credentials: () => Promise<{ id: string; password: string } | undefined>;
  readonly onToken?: (token: string) => Promise<void>;
  readonly log?: (line: string) => void;
}

export class ServerClient {
  #authenticating: Promise<boolean> | undefined;
  #signInFailure: string | undefined;
  readonly origin: string;
  readonly rpc: RpcClient;

  constructor(readonly baseUrl: string, private token: string | undefined, private readonly request: typeof fetch = fetch, private readonly signIn?: SignInOptions) {
    this.origin = new URL(baseUrl).origin;
    this.rpc = new RpcClient({
      baseUrl: this.origin,
      fetch: (input, init) => this.#authorized(input, init),
    });
  }

  signInFailure(): string | undefined {
    return this.#signInFailure;
  }

  async #authorized(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
    const token = this.token;
    const send = () => this.request(input, { ...init, headers: this.headers(init?.headers as Record<string, string> | undefined ?? {}) });
    const response = await send();
    if (response.status !== 401 || !this.signIn || init?.signal?.aborted) return response;
    const rejection = await response.clone().json().catch(() => undefined) as { code?: unknown } | undefined;
    if (rejection?.code !== "login-required") {
      this.#signInFailure = "Access token required: this server does not accept automatic user/password sign-in. Supply a valid access token.";
      return response;
    }
    if (token === this.token) {
      this.#authenticating ??= this.#authenticate().finally(() => { this.#authenticating = undefined; });
      if (!await this.#authenticating) return response;
    }
    if (init?.signal?.aborted) return response;
    await response.body?.cancel();
    const retried = await send();
    if (retried.status === 401) this.#signInFailure = "Sign-in required: the server rejected the renewed session.";
    return retried;
  }

  async #authenticate(): Promise<boolean> {
    try {
      const credentials = await this.signIn!.credentials();
      if (!credentials) {
        this.#signInFailure = "Sign-in required: no credentials are configured for session renewal.";
        return false;
      }
      this.signIn!.log?.(`== Signing in to ${this.origin} with configured credentials`);
      const { token } = await this.login(credentials.id, credentials.password);
      await this.signIn!.onToken?.(token);
      this.useToken(token);
      this.#signInFailure = undefined;
      return true;
    } catch {
      this.#signInFailure = "Sign-in required: automatic sign-in failed. Check the configured credentials and server availability.";
      return false;
    }
  }

  get hasToken(): boolean {
    return this.token !== undefined;
  }

  get accessToken(): string | undefined {
    return this.token;
  }

  /** The client reads the token on every request, so the messaging layer stays in place. */
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
      return await this.#authorized(this.url(path), init);
    } catch (cause) {
      throw new UnreachableError(`${this.origin} is unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  async json<T>(path: string, init: RequestInit = {}, validate: (value: unknown) => T = (value) => value as T): Promise<T> {
    const response = await this.fetch(path, init);
    if (!response.ok) throw await errorFrom(response);
    return validate(await response.json());
  }

  async access(): Promise<AccessSnapshot> {
    const snapshot = await this.json("/api/access", { cache: "no-store" }, accessSnapshotFrom);
    if (!snapshot.enabled || snapshot.user || !this.signIn) return snapshot;
    this.#authenticating ??= this.#authenticate().finally(() => { this.#authenticating = undefined; });
    return await this.#authenticating ? this.json("/api/access", { cache: "no-store" }, accessSnapshotFrom) : snapshot;
  }

  async login(id: string, password: string): Promise<{ snapshot: AccessSnapshot; token: string }> {
    const response = await this.request(this.url("/api/access/login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, password }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!response.ok) throw await errorFrom(response);
    const snapshot = accessSnapshotFrom(await response.json());
    if (!snapshot.user) throw new ServerError("The server did not confirm the sign-in.", 500);
    return { snapshot, token: sessionTokenFrom(response.headers.getSetCookie()) };
  }

  async logout(): Promise<void> {
    const response = await this.fetch("/api/access/logout", { method: "POST" });
    if (!response.ok && response.status !== 401) throw await errorFrom(response);
  }
}
