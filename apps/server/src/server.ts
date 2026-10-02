import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ACCESS_TOKEN_QUERY, createAccessContext } from "@ragents/engine";
import { coreChannels, coreMethods } from "./api/core-methods.js";
import { attachmentContentRoute } from "./api/delivery.js";
import { assertRunAccess } from "./api/rights.js";
import { RpcDispatcher } from "./rpc/dispatcher.js";
import { RpcHttpTransport } from "./rpc/http-transport.js";
import { startStdioTransport } from "./rpc/stdio-transport.js";
import { config, HOST_SECRET_ENV_NAMES, hostConfigKeys } from "./config.js";
import { configuredAnonymousUser, configuredDefaultStartEntry, configuredUsers, validateConfigFileSections } from "./config-file.js";
import { createAccessSessionManager, isSameOriginRequest } from "./access-session.js";
import { coordinatorRequestUser, profileAccessCookieName } from "./access-service.js";
import { globalChatToken, globalRunPolicyOf } from "./ragents/global-chat.js";
import { PayloadTooLargeError, readBody } from "./plugin-support/http.js";
import { workspaceRuntimeToken } from "./ragents/workspace-runtime.js";
import { externalAccessOpen, externalGate, isLocalRequest, loadExternalAccess, setExternalAccess } from "./external-access.js";
import { loadPlugins, resolvePluginEntries, staleBuiltInBundles } from "./profile/plugin-discovery.js";
import { composeProfile, type ProfileComposition } from "./profile/compose.js";
import { Protocol, teeConsole } from "./protocol.js";
import { RunSessionProvider } from "./provider.js";
import { readHelpResponse } from "./help-files.js";
import { watchParentProcess } from "./parent-watch.js";
import { hostRoot, readPackageVersion } from "./host-version.js";
import { hostWebProblem, isCheckout } from "./host-web.js";
import { createStylesheet, STYLESHEET_PATH } from "./web-stylesheet.js";
import { isBundleSourceMap, isPublicBundleFile, isWebBundlePath, webBundleFile } from "./web-bundles.js";

const stdioMode = process.env.RAGENTS_STDIO === "1";
// scripts/start.sh --dev: the web comes from the Vite dev server, a watch keeps the bundles current.
const devMode = process.env.RAGENTS_DEV === "1";
const announce = process.env.RAGENTS_ANNOUNCE === "1";
const withoutHttp = process.env.RAGENTS_NO_HTTP === "1";
// In stdio mode, stdout belongs to the protocol; everything else goes to stderr.
if (stdioMode || announce) {
  console.log = console.error.bind(console);
  console.info = console.error.bind(console);
}
teeConsole(Protocol.forServer());
process.on("uncaughtException", (error) => {
  Protocol.fatal(`Unhandled error: ${error.stack ?? error.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  Protocol.fatal(`Unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
  process.exit(1);
});

const tokensEqual = (a: string, b: string): boolean => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
};

const cookieValue = (req: IncomingMessage, cookieName: string): string | undefined => {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === cookieName) return decodeURIComponent(rest.join("="));
  }
  return undefined;
};

const loginPage = (res: ServerResponse, status: number, title: string, hint = ""): void => {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font:14px/1.5 -apple-system,system-ui,sans-serif;background:#f4f6fa;color:#223347}
.card{background:#fff;border:1px solid #dde4ee;border-radius:14px;padding:28px 32px;width:min(340px,90vw);
box-shadow:0 10px 30px rgba(34,51,71,.08)}h1{font-size:1.05rem;margin:0 0 16px}
input{width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #dde4ee;border-radius:8px;font:inherit}
button{margin-top:12px;width:100%;padding:9px;border:0;border-radius:8px;background:#2a94fa;color:#fff;font:inherit;cursor:pointer}
.hint{color:#c0392b;font-size:.85rem;margin:10px 0 0}</style></head><body>
<form class="card" method="post" action="/access"><h1>${title}</h1>
<input autofocus name="token" placeholder="Access token" type="password">
<button type="submit">Sign in</button>${hint ? `<p class="hint">${hint}</p>` : ""}</form></body></html>`);
};

const setCookie = (res: ServerResponse, cookieName: string, token: string): void => {
  res.setHeader("Set-Cookie",
    `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
};

const accessGate = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  isPluginApiPath: (pathname: string) => boolean,
  isPublicFile: (pathname: string) => boolean,
  productTitle: string,
  cookieName: string,
): Promise<boolean> => {
  const token = process.env.ACCESS_TOKEN;
  if (!token) return false;
  // The built web, the served files of the web halves and the stylesheet are open, every data route requires the token; this way iframes load their scripts without a cookie.
  if (url.pathname === "/health" || url.pathname.startsWith("/assets/") || isPublicFile(url.pathname) || url.pathname === STYLESHEET_PATH) return false;

  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ") && tokensEqual(auth.slice(7), token)) return false;
  const cookie = cookieValue(req, cookieName);
  if (cookie && tokensEqual(cookie, token)) return false;

  const offered = url.searchParams.get(ACCESS_TOKEN_QUERY);
  if (offered && tokensEqual(offered, token)) {
    setCookie(res, cookieName, token);
    // Only a page navigation is redirected to the token-free address; iframes and API requests continue directly.
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
    if (tokensEqual(input, token)) {
      setCookie(res, cookieName, token);
      res.writeHead(302, { Location: "/" });
      res.end();
    } else {
      loginPage(res, 401, productTitle, "Token is incorrect.");
    }
    return true;
  }

  if (isPluginApiPath(url.pathname)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Access token missing" }));
    return true;
  }
  loginPage(res, 401, productTitle);
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
  throw new Error(`The profile ${config.productProfile} names no plugins: PLUGINS is missing in ragents.config.${config.productProfile}.ts`);
const root = hostRoot();
const checkout = isCheckout(root);
const rebuild = (command: string): string => checkout ? `rebuild in the checkout with ${command}` : "the package is incomplete; reinstall it";
if (!devMode) {
  const problem = hostWebProblem(config.webDistDir, root, checkout);
  if (problem) throw new Error(`${problem}; ${rebuild("pnpm build:web")}`);
  const stale = checkout ? staleBuiltInBundles(resolvePluginEntries(config.plugins)) : [];
  if (stale.length > 0) throw new Error(`Built-in bundles no longer match their sources under plugins/: ${stale.join(", ")}; ${rebuild("pnpm build:plugins")}`);
}
const loaded = await loadPlugins(config.plugins);
const stylesheet = await createStylesheet({ root, bundles: loaded.bundles, dev: devMode });
const bundleFolders: ReadonlyMap<string, string> = new Map(loaded.bundles.map((plugin) => [plugin.id, plugin.folder]));
const defaultStartEntry = configuredDefaultStartEntry();
const composition: ProfileComposition = {
  product: { id: config.productId, title: config.productTitle },
  pluginIds: loaded.ids,
  modules: loaded.modules,
  web: loaded.web,
  executor: loaded.executor,
  ...(defaultStartEntry !== undefined ? { defaultStartEntry } : {}),
};

/** Binds the port and returns the one actually bound; a port in use aborts the start. */
const listenOn = (target: Server, port: number, host: string | undefined): Promise<number> => new Promise((resolve, reject) => {
  target.once("error", reject);
  target.listen(port, host, () => {
    target.off("error", reject);
    const address = target.address();
    if (!address || typeof address === "string") reject(new Error(`The server is not listening on a TCP port: ${String(address)}`));
    else resolve(address.port);
  });
});

// The port is fixed before setup so that every address is correct from the start; requests wait until the server is ready.
const opened = Promise.withResolvers<void>();
const server = createServer((req, res) => { void opened.promise.then(() => handleRequest(req, res)); });
const port = withoutHttp ? undefined : await listenOn(server, config.port, announce ? "127.0.0.1" : undefined);
const provider = new RunSessionProvider((bridges) => composeProfile(composition, bridges), port === undefined ? undefined : `http://127.0.0.1:${port}`);
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
const globalAccess = globalRunPolicyOf(provider.plugins.optionalService(globalChatToken));
await loadExternalAccess();
await provider.init();
const workspaceMode = provider.plugins.service(workspaceRuntimeToken).describe().mode;
provider.plugins.methods.register("host", [
  ...provider.engineMethods(),
  ...coreMethods({
    sessions: provider,
    plugins: provider.plugins,
    version: readPackageVersion(),
    global: globalAccess,
    runOwner: (runId) => provider.runOwner(runId),
    runOwnerOnly: (runId) => provider.runOwnerOnly(runId),
    runSharing: (runId) => provider.runSharing(runId),
    settingsGuarded: () => !process.env.ACCESS_TOKEN && !accessSessions.enabled,
    external: { open: externalAccessOpen, set: setExternalAccess },
  }),
]);
provider.plugins.channels.register("host", coreChannels({
  sessions: provider,
  plugins: provider.plugins,
  global: globalAccess,
  runOwner: (runId) => provider.runOwner(runId),
  runOwnerOnly: (runId) => provider.runOwnerOnly(runId),
  runSharing: (runId) => provider.runSharing(runId),
}));
provider.plugins.http.register("host", [provider.engineArtifactRoute(), attachmentContentRoute(provider, provider.runAccess())]);
const dispatcher = new RpcDispatcher({
  methods: provider.plugins.methods,
  channels: provider.plugins.channels,
  assertRunReachable: (access, runId, operates) => assertRunAccess(access, runId, operates, provider.runAccess()),
  watchRunAccess: (runId, listener) => provider.watchRunAccess(runId, listener),
});
const rpc = new RpcHttpTransport({ dispatcher });

const jsonResponse = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const isLoopbackRequest = (req: IncomingMessage): boolean => {
  const address = req.socket.remoteAddress;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
};

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const startedAt = Date.now();
  res.once("close", () =>
    console.log(`${req.method} ${url.pathname} -> ${res.statusCode} (${Date.now() - startedAt} ms)`));
  if (externalGate(req, res)) return;

  const coordinator = accessSessions.enabled || configuredAnonymousUser() !== undefined ? coordinatorRequestUser(req, url) : undefined;
  const serviceRequest = coordinator !== undefined;
  if (!serviceRequest && !accessSessions.enabled && await accessGate(
    req, res, url, (pathname) => pathname.startsWith("/api/") || provider.isPluginApiPath(pathname),
    (pathname) => isPublicBundleFile(bundleFolders, pathname), productTitle, accessCookieName,
  )) return;
  if (await accessSessions.handle(req, res, url)) return;
  const access = createAccessContext(coordinator ? accessSessions.coordinatorSnapshot(coordinator.userId) : accessSessions.snapshot(req));
  const protectedPath = /^\/(?:api|rpc|files)(?:\/|$)/.test(url.pathname) || provider.isPluginApiPath(url.pathname)
    || isBundleSourceMap(bundleFolders, url.pathname);
  if (protectedPath && access.enabled && !access.user) {
    jsonResponse(res, 401, { error: "Please sign in.", code: "login-required" });
    return;
  }
  if (access.enabled && protectedPath && !["GET", "HEAD", "OPTIONS"].includes(req.method ?? "")
    && !serviceRequest && !isSameOriginRequest(req)) {
    jsonResponse(res, 403, { error: "Changes are only possible from the same website." });
    return;
  }
  if (protectedPath && !serviceRequest) accessSessions.track(req, res);

  if (isWebBundlePath(bundleFolders, url.pathname)) {
    const file = await webBundleFile(bundleFolders, url.pathname, req.headers["if-none-match"]);
    res.writeHead(file.status, file.headers);
    res.end(req.method === "HEAD" ? undefined : file.body);
    return;
  }
  if (await rpc.handle(req, res, url, access, isLoopbackRequest(req) && isLocalRequest(req))) return;
  if (await provider.pluginRoutes(req, res, url, access)) return;
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, external: externalAccessOpen(), pid: process.pid }));
    return;
  }

  if (url.pathname === STYLESHEET_PATH) {
    // A bundle may be being rebuilt right now; that costs this request, not the server.
    const built = await stylesheet().catch((error: unknown) => error instanceof Error ? error : new Error(String(error)));
    if (built instanceof Error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(built.message);
      return;
    }
    const { css, etag } = built;
    const caching = { "Cache-Control": "no-cache", ETag: etag };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, caching);
      res.end();
      return;
    }
    res.writeHead(200, { ...caching, "Content-Type": "text/css; charset=utf-8" });
    res.end(req.method === "HEAD" ? undefined : css);
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
  res.end("Not found");
}

opened.resolve();
if (port !== undefined) {
  console.log(`${productTitle} server: http://localhost:${port} (workspace mode: ${workspaceMode}, data: ${config.dataDir})`);
  if (announce) {
    process.stdout.write(`${JSON.stringify({ ragents: { url: `http://127.0.0.1:${port}`, token: process.env.ACCESS_TOKEN ?? null, pid: process.pid } })}\n`);
  }
}
if (stdioMode) {
  const stdio = startStdioTransport({ dispatcher, input: process.stdin, output: process.stdout });
  console.log(`${productTitle} server: JSON-RPC over stdio (data: ${config.dataDir})`);
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
    console.error("Server shutdown aborted after 15 seconds");
    process.exit(1);
  }, 15_000);
  timeout.unref();
  const serverClosed = new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  try {
    await provider.shutdown();
    server.closeAllConnections();
    await serverClosed;
    clearTimeout(timeout);
    process.exitCode = 0;
  } catch (error) {
    console.error(`Server shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
    server.closeAllConnections();
    await serverClosed.catch((closeError) =>
      console.error(`HTTP server could not be closed: ${closeError instanceof Error ? closeError.message : String(closeError)}`));
    process.exitCode = 1;
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown);
// A caller such as the VS Code extension names itself in RAGENTS_PARENT_PID; if it disappears, the host ends as on SIGTERM.
watchParentProcess({
  parentPid: process.env.RAGENTS_PARENT_PID,
  onGone: (pid) => {
    console.error(`The calling process ${pid} is no longer alive; the host is shutting down.`);
    shutdown();
  },
});
// Crash and shutdown timeout end in process.exit: the lock is still released.
process.on("exit", () => provider.closeJournal());
