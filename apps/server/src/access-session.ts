import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ACCESS_TOKEN_QUERY, type AccessSnapshot, type AccessUser } from "@ragents/engine";
import type { ResolvedProfileUser } from "./config-file.js";
import { PayloadTooLargeError, readJsonBody, writeJson } from "./plugin-support/http.js";

export interface AccessSessionOptions {
  users?: readonly ResolvedProfileUser[];
  anonymousUser?: AccessUser;
  cookieName: string;
  sessionTtlMs?: number;
  now?: () => number;
}

interface PasswordRecord {
  user: AccessUser;
  salt: Buffer;
  hash: Buffer;
}

interface LoginSession {
  user: AccessUser;
  expiresAt: number;
  responses: Set<ServerResponse>;
  timer: ReturnType<typeof setTimeout>;
}

const derivePassword = (password: string, salt: Buffer): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, 32, (error, key) => error ? reject(error) : resolve(key));
});

const digestOf = (token: string): Buffer => createHash("sha256").update(token).digest();

export const isSameOriginRequest = (request: IncomingMessage): boolean => {
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.host === request.headers.host;
  } catch {
    return false;
  }
};

export const createAccessSessionManager = (options: AccessSessionOptions) => {
  if (!/^[A-Za-z0-9_-]+$/.test(options.cookieName)) throw new Error("Ungültiger Name für das Anmeldungscookie");
  if (options.users?.length === 0) throw new Error("Eine aktivierte Anmeldung braucht mindestens einen Benutzer");
  if (options.users && options.anonymousUser) throw new Error("Benutzeranmeldung und anonymer Zugang schließen einander aus");
  const enabled = options.users !== undefined;
  const now = options.now ?? Date.now;
  const sessionTtlMs = options.sessionTtlMs ?? 12 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1 || sessionTtlMs > 2_147_483_647) {
    throw new Error("Ungültige Gültigkeitsdauer für Anmeldungen");
  }
  const passwords = new Map<string, PasswordRecord>();
  // Persönliche Token liegen nur als SHA-256 im Speicher; der Vergleich läuft zeitkonstant über alle Einträge.
  const personalTokens: Array<{ digest: Buffer; user: AccessUser }> = [];
  for (const entry of options.users ?? []) {
    if (passwords.has(entry.id)) throw new Error(`Doppelter Benutzer: ${entry.id}`);
    const salt = randomBytes(16);
    const user = Object.freeze({ id: entry.id, label: entry.label, rights: Object.freeze([...entry.rights]),
      ...(entry.startEntries ? { startEntries: Object.freeze([...entry.startEntries]) } : {}),
    });
    passwords.set(entry.id, { user, salt, hash: scryptSync(entry.password, salt, 32) });
    if (entry.token === undefined) continue;
    const digest = digestOf(entry.token);
    if (personalTokens.some((known) => timingSafeEqual(known.digest, digest))) throw new Error(`Der Token von Benutzer ${entry.id} gehört bereits einem anderen Benutzer`);
    personalTokens.push({ digest, user });
  }
  const dummySalt = randomBytes(16);
  const dummyHash = randomBytes(32);
  const sessions = new Map<string, LoginSession>();
  const wellFormed = (token: string | undefined): string | undefined => token !== undefined && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
  // Clients ohne Cookie (VS-Code-Erweiterung, ihre iframes) senden den Token als Bearer; GET-Abrufe ohne Header (Ereignisstrom, Frames) als Abfrageparameter.
  const tokenFor = (request: IncomingMessage): string | undefined => {
    const authorization = request.headers.authorization;
    if (authorization !== undefined) return wellFormed(/^Bearer (.+)$/.exec(authorization)?.[1]);
    const offered = request.method === "GET" ? new URL(request.url ?? "/", "http://localhost").searchParams.get(ACCESS_TOKEN_QUERY) : null;
    if (offered !== null) return wellFormed(offered);
    const matches = (request.headers.cookie ?? "").split(";").map((part) => part.trim())
      .filter((part) => part.startsWith(`${options.cookieName}=`));
    if (matches.length !== 1) return undefined;
    return wellFormed(matches[0]!.slice(options.cookieName.length + 1));
  };
  // Ein persönlicher Token gilt nur als Bearer oder, bei GET, als Abfrageparameter; nie als Cookie.
  const offeredToken = (request: IncomingMessage): string | undefined => {
    const authorization = request.headers.authorization;
    if (authorization !== undefined) return /^Bearer (.+)$/.exec(authorization)?.[1];
    if (request.method !== "GET") return undefined;
    return new URL(request.url ?? "/", "http://localhost").searchParams.get(ACCESS_TOKEN_QUERY) ?? undefined;
  };
  const personalUserFor = (request: IncomingMessage): AccessUser | undefined => {
    if (personalTokens.length === 0) return undefined;
    const offered = offeredToken(request);
    if (!offered || offered.length > 512) return undefined;
    const digest = digestOf(offered);
    return personalTokens.find((known) => timingSafeEqual(known.digest, digest))?.user;
  };
  const invalidate = (token: string): void => {
    const session = sessions.get(token);
    if (!session) return;
    sessions.delete(token);
    clearTimeout(session.timer);
    for (const response of session.responses) response.destroy();
    session.responses.clear();
  };
  const sessionFor = (request: IncomingMessage): LoginSession | undefined => {
    const token = tokenFor(request);
    if (!token) return undefined;
    const session = sessions.get(token);
    if (session && session.expiresAt <= now()) {
      invalidate(token);
      return undefined;
    }
    return session;
  };
  const snapshot = (request: IncomingMessage): AccessSnapshot => ({
    enabled,
    user: enabled ? personalUserFor(request) ?? sessionFor(request)?.user ?? null : options.anonymousUser ?? null,
  });
  const cookie = (request: IncomingMessage, token: string, age: number): string =>
    `${options.cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}`
    + ((request.socket as { encrypted?: boolean }).encrypted ? "; Secure" : "");
  const handle = async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> => {
    if (!["/api/access", "/api/access/login", "/api/access/logout"].includes(url.pathname)) return false;
    const expected = url.pathname === "/api/access" ? "GET" : "POST";
    if (request.method !== expected) {
      response.setHeader("Allow", expected);
      writeJson(response, 405, { error: "Methode nicht erlaubt" });
      return true;
    }
    if (expected === "GET") {
      writeJson(response, 200, snapshot(request));
      return true;
    }
    if (!isSameOriginRequest(request)) {
      writeJson(response, 403, { error: "Anmeldung und Abmeldung sind nur von derselben Website möglich" });
      return true;
    }
    if (!enabled) {
      writeJson(response, 409, { error: "Die Anmeldung ist in diesem Profil ausgeschaltet" });
      return true;
    }
    if (url.pathname === "/api/access/logout") {
      const token = tokenFor(request);
      if (token) invalidate(token);
      response.setHeader("Set-Cookie", cookie(request, "", 0));
      writeJson(response, 200, { enabled, user: null } satisfies AccessSnapshot);
      return true;
    }
    if (request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {
      writeJson(response, 415, { error: "Die Anmeldung benötigt application/json" });
      return true;
    }
    try {
      const credentials = await readJsonBody(request, (body) => {
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Benutzerkennung und Passwort fehlen");
        const value = body as Record<string, unknown>;
        if (Object.keys(value).some((key) => key !== "id" && key !== "password")
          || typeof value.id !== "string" || !value.id || value.id.length > 64
          || typeof value.password !== "string" || !value.password || value.password.length > 2048) {
          throw new Error("Benutzerkennung und Passwort sind ungültig");
        }
        return { id: value.id, password: value.password };
      }, "Die Anmeldung enthält kein gültiges JSON", 4096);
      const record = passwords.get(credentials.id);
      const hash = await derivePassword(credentials.password, record?.salt ?? dummySalt);
      const matches = timingSafeEqual(hash, record?.hash ?? dummyHash);
      if (!record || !matches) {
        writeJson(response, 401, { error: "Benutzerkennung oder Passwort stimmen nicht" });
        return true;
      }
      const previous = tokenFor(request);
      if (previous) invalidate(previous);
      const token = randomBytes(32).toString("base64url");
      const timer = setTimeout(() => invalidate(token), sessionTtlMs);
      timer.unref();
      sessions.set(token, { user: record.user, expiresAt: now() + sessionTtlMs, responses: new Set(), timer });
      response.setHeader("Set-Cookie", cookie(request, token, Math.ceil(sessionTtlMs / 1000)));
      writeJson(response, 200, { enabled, user: record.user } satisfies AccessSnapshot);
    } catch (error) {
      if (!request.aborted && !response.destroyed) {
        writeJson(response, error instanceof PayloadTooLargeError ? 413 : 400, {
          error: error instanceof PayloadTooLargeError ? "Die Anmeldedaten sind zu groß" : "Die Anmeldedaten sind ungültig",
        });
      }
    }
    return true;
  };
  const track = (request: IncomingMessage, response: ServerResponse): void => {
    const session = sessionFor(request);
    if (!session) return;
    session.responses.add(response);
    const release = () => {
      session.responses.delete(response);
      response.off("close", release);
      response.off("finish", release);
    };
    response.once("close", release);
    response.once("finish", release);
  };
  /** Der Zugang, mit dem die Werkzeuge des Koordinators eines Benutzers handeln: dessen aktueller Stand, null ist der eine Zugang ohne Anmeldung. */
  const coordinatorSnapshot = (userId: string | null): AccessSnapshot => userId === null
    ? { enabled, user: enabled ? null : options.anonymousUser ?? null }
    : { enabled: true, user: passwords.get(userId)?.user ?? null };
  return { enabled, snapshot, coordinatorSnapshot, handle, track, close: () => { for (const token of sessions.keys()) invalidate(token); } };
};
