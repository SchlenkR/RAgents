import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ACCESS_TOKEN_QUERY, createAccessContext } from "@aicontainer/ragents";
import { coreChannels, coreMethods } from "./api/core-methods.js";
import { attachmentContentRoute } from "./api/delivery.js";
import { RpcDispatcher } from "./rpc/dispatcher.js";
import { isRpcPath, RpcHttpTransport } from "./rpc/http-transport.js";
import { startStdioTransport } from "./rpc/stdio-transport.js";
import { config, HOST_SECRET_ENV_NAMES, hostConfigKeys } from "./config.js";
import { configuredAnonymousUser, configuredUsers, validateConfigFileSections } from "./config-file.js";
import { createAccessSessionManager, isSameOriginRequest } from "./access-session.js";
import { isAccessServiceRequest, profileAccessCookieName } from "./access-service.js";
import { globalChatToken } from "./ragents/global-chat.js";
import { PayloadTooLargeError, readBody } from "./plugin-support/http.js";
import { workspaceRuntimeToken } from "./ragents/workspace-runtime.js";
import { externalAccessOpen, externalGate, isLocalRequest, loadExternalAccess, setExternalAccess } from "./external-access.js";
import { loadPlugins } from "./profile/plugin-discovery.js";
import { composeProfile, type ProfileComposition } from "./profile/compose.js";
import { Protocol, teeConsole } from "./protocol.js";
import { RunSessionProvider } from "./provider.js";
import { readHelpResponse } from "./help-files.js";

const stdioMode = process.env.RAGENTS_STDIO === "1";
const announce = process.env.RAGENTS_ANNOUNCE === "1";
const withoutHttp = process.env.RAGENTS_NO_HTTP === "1";
// Im stdio-Modus gehört stdout dem Protokoll; alles andere geht nach stderr.
if (stdioMode || announce) {
  console.log = console.error.bind(console);
  console.info = console.error.bind(console);
}
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

  if (isPluginApiPath(url.pathname)) {
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
provider.plugins.methods.register("host", [
  ...provider.engineMethods(),
  ...coreMethods({
    sessions: provider,
    plugins: provider.plugins,
    global: globalAccess,
    settingsGuarded: () => !process.env.ACCESS_TOKEN && !accessSessions.enabled,
    external: { open: externalAccessOpen, set: setExternalAccess },
  }),
]);
provider.plugins.channels.register("host", coreChannels({ sessions: provider, global: globalAccess }));
provider.plugins.http.register("host", [provider.engineArtifactRoute(), attachmentContentRoute(provider, globalAccess)]);
const dispatcher = new RpcDispatcher({ methods: provider.plugins.methods, channels: provider.plugins.channels });
const rpc = new RpcHttpTransport({ dispatcher });

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
  const protectedPath = /^\/(?:api|rpc|files)(?:\/|$)/.test(url.pathname) || provider.isPluginApiPath(url.pathname);
  if (protectedPath && access.enabled && !access.user) {
    jsonResponse(res, 401, { error: "Bitte melde dich an.", code: "login-required" });
    return;
  }
  if (access.enabled && protectedPath && !["GET", "HEAD", "OPTIONS"].includes(req.method ?? "")
    && !serviceRequest && !isSameOriginRequest(req)) {
    jsonResponse(res, 403, { error: "Änderungen sind nur von derselben Website möglich." });
    return;
  }
  if (protectedPath && !serviceRequest) accessSessions.track(req, res);

  if (await rpc.handle(req, res, url, access, isLoopbackRequest(req) && isLocalRequest(req))) return;
  if (await provider.pluginRoutes(req, res, url, access)) return;
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

if (!withoutHttp) {
  server.listen(config.port, announce ? "127.0.0.1" : undefined, () => {
    const address = server.address();
    const port = address && typeof address !== "string" ? address.port : config.port;
    console.log(`${productTitle}-Server: http://localhost:${port} (Workspace-Modus: ${workspaceMode}, Daten: ${config.dataDir})`);
    if (announce) {
      process.stdout.write(`${JSON.stringify({ ragents: { url: `http://127.0.0.1:${port}`, token: process.env.ACCESS_TOKEN ?? null, pid: process.pid } })}\n`);
    }
  });
}
if (stdioMode) {
  const stdio = startStdioTransport({ dispatcher, input: process.stdin, output: process.stdout });
  console.log(`${productTitle}-Server: JSON-RPC über stdio (Daten: ${config.dataDir})`);
  void stdio.closed.then(() => shutdown());
}

let shutdownPromise: Promise<void> | undefined;
const shutdown = (): void => {
  shutdownPromise ??= shutdownInner();
};

const shutdownInner = async (): Promise<void> => {
  accessSessions.close();
  rpc.close();
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
