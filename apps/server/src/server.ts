import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createChatHandler } from "./chat-handler.js";
import { ACCESS_TOKEN_QUERY, createAccessContext, DomainError } from "@aicontainer/ragents";
import { config, HOST_SECRET_ENV_NAMES, hostConfigKeys } from "./config.js";
import { configuredAnonymousUser, configuredUsers, validateConfigFileSections } from "./config-file.js";
import { createAccessSessionManager, isSameOriginRequest } from "./access-session.js";
import { isAccessServiceRequest, profileAccessCookieName } from "./access-service.js";
import { enforceHostAccess, hostRequiredRights } from "./access-policy.js";
import { accessibleChatEvent } from "./access-projection.js";
import { SESSIONS_CHANNEL, runIdOfChannel } from "./event-channels.js";
import { globalChatToken } from "./ragents/global-chat.js";
import { PayloadTooLargeError, readBody, readJsonBody, guardedJsonRoute, writeJson } from "./plugin-support/http.js";
import { workspaceRuntimeToken } from "./ragents/workspace-runtime.js";
import {
  externalAccessOpen,
  externalGate,
  isLocalRequest,
  loadExternalAccess,
  setExternalAccess,
} from "./external-access.js";
import { loadPlugins } from "./profile/plugin-discovery.js";
import { composeProfile, type ProfileComposition } from "./profile/compose.js";
import { Protocol, teeConsole } from "./protocol.js";
import { RunSessionProvider } from "./provider.js";
import { readHelpResponse } from "./help-files.js";
import { handleRunPreparationRequest } from "./run-preparation.js";

teeConsole(Protocol.forServer());
process.on("uncaughtException", (error) => {
  Protocol.fatal(`Unbehandelter Fehler: ${error.stack ?? error.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  Protocol.fatal(`Unbehandelte Ablehnung: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
  process.exit(1);
});

const tokenGleich = (a: string, b: string): boolean => {
  const pufferA = Buffer.from(a);
  const pufferB = Buffer.from(b);
  return pufferA.length === pufferB.length && timingSafeEqual(pufferA, pufferB);
};

const cookieValue = (req: IncomingMessage, cookieName: string): string | undefined => {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const teil of raw.split(";")) {
    const [name, ...rest] = teil.trim().split("=");
    if (name === cookieName) return decodeURIComponent(rest.join("="));
  }
  return undefined;
};

const loginSeite = (res: ServerResponse, status: number, title: string, hint = ""): void => {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font:14px/1.5 -apple-system,system-ui,sans-serif;background:#f4f6fa;color:#223347}
.card{background:#fff;border:1px solid #dde4ee;border-radius:14px;padding:28px 32px;width:min(340px,90vw);
box-shadow:0 10px 30px rgba(34,51,71,.08)}h1{font-size:1.05rem;margin:0 0 16px}
input{width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #dde4ee;border-radius:8px;font:inherit}
button{margin-top:12px;width:100%;padding:9px;border:0;border-radius:8px;background:#2a94fa;color:#fff;font:inherit;cursor:pointer}
.hinweis{color:#c0392b;font-size:.85rem;margin:10px 0 0}</style></head><body>
<form class="card" method="post" action="/access"><h1>${title}</h1>
<input autofocus name="token" placeholder="Zugangstoken" type="password">
<button type="submit">Anmelden</button>${hint ? `<p class="hinweis">${hint}</p>` : ""}</form></body></html>`);
};

const setzeCookie = (res: ServerResponse, cookieName: string, token: string): void => {
  res.setHeader("Set-Cookie",
    `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
};

const accessGate = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  isPluginApiPath: (pathname: string) => boolean,
  productTitle: string,
  cookieName: string,
): Promise<boolean> => {
  const token = process.env.ACCESS_TOKEN;
  if (!token) return false;
  // Das gebaute Web ist frei, jede Datenroute verlangt den Token; so laden iframes ohne Cookie ihre Skripte.
  if (url.pathname === "/health" || url.pathname.startsWith("/assets/")) return false;

  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ") && tokenGleich(auth.slice(7), token)) return false;
  const cookie = cookieValue(req, cookieName);
  if (cookie && tokenGleich(cookie, token)) return false;

  const offered = url.searchParams.get(ACCESS_TOKEN_QUERY);
  if (offered && tokenGleich(offered, token)) {
    setzeCookie(res, cookieName, token);
    // Nur eine Seitennavigation wird auf die tokenfreie Adresse umgeleitet; iframes und API-Abrufe laufen direkt weiter.
    if (req.headers["sec-fetch-dest"] !== "document") return false;
    res.writeHead(302, { Location: url.pathname });
    res.end();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/access") {
    let input = "";
    try {
      input = new URLSearchParams(await readBody(req)).get("token") ?? "";
    } catch (error) {
      if (!(error instanceof PayloadTooLargeError)) throw error;
    }
    if (tokenGleich(input, token)) {
      setzeCookie(res, cookieName, token);
      res.writeHead(302, { Location: "/" });
      res.end();
    } else {
      loginSeite(res, 401, productTitle, "Token stimmt nicht.");
    }
    return true;
  }

  if (url.pathname.startsWith("/chat") || isPluginApiPath(url.pathname)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Zugangstoken fehlt" }));
    return true;
  }
  loginSeite(res, 401, productTitle);
  return true;
};

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

if (config.plugins.length === 0)
  throw new Error(`Das Profil ${config.productProfile} nennt keine Plugins: PLUGINS fehlt in ragents.config.${config.productProfile}.ts`);
const loaded = await loadPlugins(config.plugins);
const composition: ProfileComposition = {
  product: { id: config.productId, title: config.productTitle },
  pluginIds: loaded.ids,
  modules: loaded.modules,
};

const provider = new RunSessionProvider((bridges) => composeProfile(composition, bridges));
validateConfigFileSections({
  hostKeys: hostConfigKeys,
  knownPluginIds: loaded.known,
  activePluginIds: composition.pluginIds,
  declaredKeysFor: (pluginId) => provider.plugins.config.publicEntries(pluginId).map((descriptor) => descriptor.key),
  secretKeys: [...HOST_SECRET_ENV_NAMES, ...provider.plugins.config.secretKeys()],
});
const product = provider.plugins.publicProfile().product;
const productTitle = product.title;
const accessCookieName = product.accessCookieName ?? `${product.id}-access`;
const accessSessions = createAccessSessionManager({
  users: configuredUsers(),
  anonymousUser: configuredAnonymousUser(),
  cookieName: profileAccessCookieName(product.id, config.productProfile),
});
const globalChat = provider.plugins.optionalService(globalChatToken);
const globalAccess = globalChat?.access ? { runId: globalChat.runId, ...globalChat.access } : undefined;
await loadExternalAccess();
await provider.init();
const workspaceMode = provider.plugins.service(workspaceRuntimeToken).describe().mode;
const chatHandler = createChatHandler({ manager: provider });
provider.eventHub.channels(
  {
    id: "sessions",
    matches: (channel) => channel === SESSIONS_CHANNEL,
    requiredRights: () => hostRequiredRights("GET", "/chat/sessions/stream", globalAccess),
    open: (_channel, emit) => {
      const notify = () => emit({ type: "changed" });
      const unsubscribe = provider.subscribeList(notify);
      notify();
      return unsubscribe;
    },
  },
  {
    id: "run",
    matches: (channel) => runIdOfChannel(channel, "run") !== undefined,
    requiredRights: (channel) => hostRequiredRights("GET", `/chat/${runIdOfChannel(channel, "run")}/run/stream`, globalAccess),
    open: (channel, emit) => {
      emit({ kind: "ready" });
      return provider.subscribeRun(runIdOfChannel(channel, "run")!, () => emit({ kind: "run" }));
    },
  },
  {
    id: "chat",
    matches: (channel) => runIdOfChannel(channel, "chat") !== undefined,
    requiredRights: (channel) => hostRequiredRights("GET", `/chat/${runIdOfChannel(channel, "chat")}/stream`, globalAccess),
    open: async (channel, emit, access) => {
      const session = await provider.get(runIdOfChannel(channel, "chat")!);
      return session.subscribe((event) => {
        const visible = accessibleChatEvent(event, access);
        if (visible) emit(visible);
      });
    },
  },
);

const jsonResponse = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const isLoopbackRequest = (req: IncomingMessage): boolean => {
  const address = req.socket.remoteAddress;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const startedAt = Date.now();
  res.once("close", () =>
    console.log(`${req.method} ${url.pathname} -> ${res.statusCode} (${Date.now() - startedAt} ms)`));
  if (externalGate(req, res)) return;

  const serviceRequest = (accessSessions.enabled || configuredAnonymousUser() !== undefined) && isAccessServiceRequest(req, url);
  if (!serviceRequest && !accessSessions.enabled && await accessGate(
    req, res, url, (pathname) => pathname.startsWith("/api/") || provider.isPluginApiPath(pathname),
    productTitle, accessCookieName,
  )) return;
  if (await accessSessions.handle(req, res, url)) return;
  const access = createAccessContext(serviceRequest
    ? { enabled: true, user: { id: "host-service", label: "Host", rights: ["runs.read", "runs.write", "runs.create", "runs.inspect"] } }
    : accessSessions.snapshot(req));
  const protectedPath = /^\/(?:api|chat|ragents)(?:\/|$)/.test(url.pathname)
    || provider.isPluginApiPath(url.pathname) || url.pathname === "/extern";
  if (protectedPath && access.enabled && !access.user) {
    jsonResponse(res, 401, { error: "Bitte melde dich an.", code: "login-required" });
    return;
  }
  if (access.enabled && protectedPath && !["GET", "HEAD", "OPTIONS"].includes(req.method ?? "")
    && !serviceRequest && !isSameOriginRequest(req)) {
    jsonResponse(res, 403, { error: "Änderungen sind nur von derselben Website möglich." });
    return;
  }
  if (enforceHostAccess(req, res, url, access, globalAccess)) return;
  if (protectedPath && !serviceRequest) accessSessions.track(req, res);

  if (req.method === "POST" && url.pathname === "/extern") {
    if (!isLocalRequest(req)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Nur lokal schaltbar" }));
      return;
    }
    const wanted = url.searchParams.get("state");
    if (wanted !== "on" && wanted !== "off") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "state muss on oder off sein" }));
      return;
    }
    await setExternalAccess(wanted === "on");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ external: externalAccessOpen() }));
    return;
  }

  const settingsSkillMatch = url.pathname.match(/^\/api\/settings\/skills\/(.+)$/);
  if (url.pathname === "/api/settings" || url.pathname === "/api/settings/titles" || settingsSkillMatch) {
    const localSettingsRequest = isLoopbackRequest(req) && isLocalRequest(req);
    if (!localSettingsRequest && !process.env.ACCESS_TOKEN && !accessSessions.enabled) {
      jsonResponse(res, 403, { error: "Einstellungen sind nur lokal oder mit Zugangstoken verfügbar" });
      return;
    }
    if (url.pathname === "/api/settings/titles") {
      await guardedJsonRoute({ request: req, response: res, handle: async () => {
        if (req.method === "GET") writeJson(res, 200, provider.titleModelSettings());
        else if (req.method === "PUT") writeJson(res, 200, await provider.saveTitleModelSettings(await readJsonBody(req, (value) => value, undefined, 4096)));
        else { res.setHeader("Allow", "GET, PUT"); writeJson(res, 405, { error: "Erlaubt sind GET und PUT." }); }
      } });
      return;
    }
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      jsonResponse(res, 405, { error: "Methode nicht erlaubt" });
      return;
    }
    try {
      if (!settingsSkillMatch) {
        jsonResponse(res, 200, await provider.settings());
        return;
      }
      const skill = await provider.skill(decodeURIComponent(settingsSkillMatch[1]));
      if (skill) jsonResponse(res, 200, skill);
      else jsonResponse(res, 404, { error: "Skill ist nicht registriert" });
    } catch (error) {
      console.error(`Einstellungen konnten nicht geladen werden: ${error instanceof Error ? error.message : String(error)}`);
      jsonResponse(res, 500, { error: "Einstellungen konnten nicht geladen werden" });
    }
    return;
  }

  if (await provider.eventHub.handle(req, res, url, access)) return;
  if (await provider.pluginRoutes(req, res, url, access)) return;

  const preparationMatch = url.pathname.match(/^\/chat\/([A-Za-z0-9_-]{1,64})\/prepare$/);
  if (preparationMatch) {
    await handleRunPreparationRequest(req, res, (request, signal) => provider.prepareRunMessage(preparationMatch[1], request, signal));
    return;
  }

  const optionsMatch = url.pathname.match(/^\/chat\/([A-Za-z0-9_-]{1,64})\/options(?:\/([A-Za-z0-9._-]{1,128}))?$/);
  if (optionsMatch) {
    const [, sessionId, optionId] = optionsMatch;
    try {
      if (req.method === "GET" && optionId === undefined) {
        jsonResponse(res, 200, { options: provider.startOptions(sessionId) });
        return;
      }
      if (req.method === "PUT" && optionId !== undefined) {
        const body = JSON.parse(await readBody(req) || "{}") as Record<string, unknown>;
        if (!("value" in body)) {
          jsonResponse(res, 400, { error: "value fehlt" });
          return;
        }
        jsonResponse(res, 200, provider.selectStartOption(sessionId, optionId, body.value));
        return;
      }
      res.setHeader("Allow", optionId === undefined ? "GET" : "PUT");
      jsonResponse(res, 405, { error: "Methode nicht erlaubt" });
    } catch (error) {
      jsonResponse(res, error instanceof DomainError ? error.status : 400, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  const runMatch = url.pathname.match(/^\/chat\/([A-Za-z0-9_-]{1,64})\/run$/);
  if (req.method === "GET" && runMatch) {
    try {
      const sessionId = runMatch[1];
      jsonResponse(res, 200, provider.hasRun(sessionId) ? provider.runView(sessionId, access) : null);
    } catch (error) {
      jsonResponse(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (url.pathname.startsWith("/ragents/") && await provider.runtimeRoutes(req, res, "/ragents", access)) return;

  if (await chatHandler(req, res, access)) return;
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, external: externalAccessOpen() }));
    return;
  }

  const help = await readHelpResponse(url, config.webDistDir, req.method);
  if (help) {
    res.writeHead(help.status, help.headers);
    res.end(help.body);
    return;
  }

  const requested = path.normalize(url.pathname).replace(/^([.\\/])+/, "");
  const candidates = requested && requested !== "."
    ? [path.join(config.webDistDir, requested), path.join(config.webDistDir, "index.html")]
    : [path.join(config.webDistDir, "index.html")];
  for (const file of candidates) {
    try {
      const content = await readFile(file);
      const type = contentTypes[path.extname(file)] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(content);
      return;
    } catch {
      continue;
    }
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Nicht gefunden");
});

server.listen(config.port, () => {
  const address = server.address();
  const port = address && typeof address !== "string" ? address.port : config.port;
  console.log(`${productTitle}-Server: http://localhost:${port} (Workspace-Modus: ${workspaceMode}, Daten: ${config.dataDir})`);
});

let shutdownPromise: Promise<void> | undefined;
const shutdown = (): void => {
  shutdownPromise ??= shutdownInner();
};

const shutdownInner = async (): Promise<void> => {
  accessSessions.close();
  const timeout = setTimeout(() => {
    console.error("Server-Shutdown nach 15 Sekunden abgebrochen");
    process.exit(1);
  }, 15_000);
  timeout.unref();
  const serverGeschlossen = new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  try {
    await provider.shutdown();
    server.closeAllConnections();
    await serverGeschlossen;
    clearTimeout(timeout);
    process.exitCode = 0;
  } catch (error) {
    console.error(`Server-Shutdown fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    server.closeAllConnections();
    await serverGeschlossen.catch((closeError) =>
      console.error(`HTTP-Server konnte nicht geschlossen werden: ${closeError instanceof Error ? closeError.message : String(closeError)}`));
    process.exitCode = 1;
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown);
// Absturz und Shutdown-Zeitüberschreitung enden in process.exit: das Lock geht trotzdem zurück.
process.on("exit", () => provider.closeJournal());
