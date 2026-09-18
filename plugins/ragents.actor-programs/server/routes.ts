import type { IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import type { HttpRouteContribution } from "@aicontainer/ragents";
import { guardedJsonRoute, readJsonBody, writeJson } from "@aicontainer/server/plugin-support/http.js";
import { browserRuntimeStyles } from "./client-runtime.js";
import type { ActorProgramRuntime } from "./runtime.js";

export const miniAppsApiPrefix = "/api/plugins/ragents.actor-programs";

const MAX_BODY_BYTES = 128 * 1024;
const MAX_INPUT_BYTES = 64 * 1024;
const basePattern = `${miniAppsApiPrefix.replaceAll(".", "\\.")}\/runs\/([A-Za-z0-9_-]{1,64})\/apps`;
const listPattern = new RegExp(`^${basePattern}$`);
const framePattern = new RegExp(`^${basePattern}\/([a-z][a-z0-9_-]{0,129})\/frame$`);
const actionPattern = new RegExp(`^${basePattern}\/([a-z][a-z0-9_-]{0,129})\/actions\/([a-zA-Z][a-zA-Z0-9_-]{0,63})$`);
const invocationPattern = new RegExp(`^${basePattern}\/([a-z][a-z0-9_-]{0,129})\/invocations\/([A-Za-z0-9_-]{1,100})$`);
const sourcePattern = new RegExp(`^${basePattern}\/([a-z][a-z0-9_-]{0,129})\/source$`);

const actorBasePattern = `${miniAppsApiPrefix.replaceAll(".", "\\.")}/runs/([A-Za-z0-9_-]{1,64})/actors/([a-z][a-z0-9-]{0,63})`;
const functionPattern = new RegExp(`^${actorBasePattern}/functions/([a-zA-Z][a-zA-Z0-9_-]{0,63})$`);
const functionInvocationPattern = new RegExp(`^${actorBasePattern}/invocations/([A-Za-z0-9_-]{1,100})$`);

interface ActionBody {
  requestId: string;
  revision: string;
  input: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readActionBody = (request: IncomingMessage): Promise<ActionBody> =>
  readJsonBody(
    request,
    (body) => {
      if (!isObject(body)
        || typeof body.requestId !== "string"
        || typeof body.revision !== "string"
        || !/^[a-f0-9]{64}$/.test(body.revision)
        || !("input" in body)) {
        throw new Error("Der Request braucht requestId, revision und input.");
      }
      if (Buffer.byteLength(JSON.stringify(body.input), "utf8") > MAX_INPUT_BYTES)
        throw new Error(`Die Aktionseingabe ist größer als ${MAX_INPUT_BYTES} Byte.`);
      return { requestId: body.requestId, revision: body.revision, input: body.input };
    },
    "Der Request enthält kein gültiges JSON.",
    MAX_BODY_BYTES,
  );

const escapeForwarder = `
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    queueMicrotask(() => {
      if (!event.defaultPrevented) parent.postMessage({ type: "ragents.app.escape", version: 1, token: bridgeToken }, "*");
    });
  });`;

const themeReceiver = `
  const applyHostTheme = (theme) => {
    if (theme !== "light" && theme !== "dark") throw new Error("Das Host-Theme muss light oder dark sein.");
    document.documentElement.dataset.theme = theme;
  };`;

const escapedScript = (source: string): string => source.replace(/<\/script/gi, "<\\/script");

const typedBridgeSdk = (nonce: string, styles: string): string => `<script nonce="${nonce}">
globalThis.__ragentsAppContext = (() => {
  document.documentElement.dataset.uiSurface = "mini-app";
  document.documentElement.dataset.miniAppFrame = "true";
  const style = document.createElement("style");
  style.setAttribute("nonce", ${JSON.stringify(nonce)});
  style.textContent = atob(${JSON.stringify(Buffer.from(styles, "utf8").toString("base64"))});
  document.head.prepend(style);
  const pending = new Map();
  const listeners = new Set();
  const chats = new Map();
  const freeze = (value) => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  const bridgeToken = new URLSearchParams(location.hash.slice(1)).get("ragentsBridge");
  ${escapeForwarder}
  ${themeReceiver}
  const channel = new MessageChannel();
  const port = channel.port1;
  let currentState = freeze({});
  let currentApp = null;
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const terminal = new Set(["succeeded", "failed", "cancelled"]);
  const requestId = () => crypto.randomUUID().replaceAll("-", "");
  const stateValue = (value) => value && typeof value === "object" && value.values && typeof value.values === "object"
    ? freeze(structuredClone(value.values))
    : freeze({});
  const settle = (message) => {
    const id = message.requestId || message.invocation?.requestId;
    const waiter = id ? pending.get(id) : undefined;
    if (!waiter || !terminal.has(message.invocation.status)) return;
    pending.delete(id);
    if (message.invocation.status === "succeeded") waiter.resolve(message.invocation.result);
    else waiter.reject(new Error(message.invocation.error || "Die App-Aktion wurde nicht abgeschlossen."));
  };
  port.onmessage = ({ data }) => {
    if (data?.version !== 1) return;
    if (data.type === "ragents.app.ready") {
      applyHostTheme(data.theme);
      currentApp = data.app;
      currentState = stateValue(data.state);
      listeners.forEach((listener) => listener(currentState));
      readyResolve();
      port.postMessage({ type: "ragents.app.connected", version: 1 });
    } else if (data.type === "ragents.app.theme") {
      applyHostTheme(data.theme);
    } else if (data.type === "ragents.app.state") {
      currentState = stateValue(data.state);
      const waiter = data.requestId ? pending.get(data.requestId) : undefined;
      if (waiter) {
        pending.delete(data.requestId);
        waiter.resolve(currentState);
      }
      listeners.forEach((listener) => listener(currentState));
    } else if (data.type === "ragents.app.invocation") {
      settle(data);
    } else if (data.type === "ragents.app.chat-state") {
      const entry = chats.get(data.actor);
      if (entry) {
        entry.snapshot = freeze(data.snapshot);
        entry.listeners.forEach((listener) => listener());
      }
      const waiter = pending.get(data.requestId);
      if (waiter) { pending.delete(data.requestId); waiter.resolve(); }
    } else if (data.type === "ragents.app.chat-ack") {
      const waiter = pending.get(data.requestId);
      if (waiter) { pending.delete(data.requestId); waiter.resolve(); }
    } else if (data.type === "ragents.app.error") {
      const waiter = data.requestId ? pending.get(data.requestId) : undefined;
      if (waiter) {
        pending.delete(data.requestId);
        waiter.reject(new Error(data.message));
      }
    }
  };
  port.start();
  const send = async (message) => {
    await ready;
    return new Promise((resolve, reject) => {
      pending.set(message.requestId, { resolve, reject });
      port.postMessage(message);
    });
  };
  if (/^[a-f0-9]{32}$/.test(bridgeToken || "")) {
    parent.postMessage(
      { type: "ragents.app.frame-ready", version: 1, token: bridgeToken },
      "*",
      [channel.port2],
    );
  }
  return Object.freeze({
    get actor() { if (!currentApp) throw new Error("Die Actor-Ansicht ist noch nicht bereit."); return Object.freeze({id:currentApp.actorId,handle:currentApp.actorHandle}); },
    ready: ready.then(() => undefined),
    run: Object.freeze({ id: "current" }),
    principal: Object.freeze({ id: "operator", kind: "operator" }),
    state: Object.freeze({
      read: () => currentState,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    chat: Object.freeze({
      read: (actor) => chats.get(actor)?.snapshot,
      subscribe: (actor, listener) => {
        let entry = chats.get(actor);
        if (!entry) {
          entry = { listeners: new Set(), snapshot: undefined, started: false };
          chats.set(actor, entry);
          ready.then(() => {
            if (chats.get(actor) !== entry) return;
            entry.started = true;
            send({ type: "ragents.app.chat-watch", version: 1, requestId: requestId(), actor })
              .catch((error) => {
                if (chats.get(actor) !== entry) return;
                entry.snapshot = freeze({ messages: [], running: false, error: error.message });
                entry.listeners.forEach((notify) => notify());
              });
          });
        }
        entry.listeners.add(listener);
        return () => {
          entry.listeners.delete(listener);
          if (entry.listeners.size > 0 || chats.get(actor) !== entry) return;
          chats.delete(actor);
          if (entry.started) {
            port.postMessage({ type: "ragents.app.chat-unwatch", version: 1, requestId: requestId(), actor });
          }
        };
      },
      send: (actor, text, attachments) => send({ type: "ragents.app.chat-send", version: 1, requestId: requestId(), actor, text, attachments }),
    }),
    capabilities: Object.freeze({
      list: () => (currentApp?.actions ?? []).map((action) => action.id),
      call: async (actionId, input = {}) => {
        await ready;
        if (!(currentApp?.actions ?? []).some((action) => action.id === actionId)) {
          throw new Error("Die angeforderte App-Aktion ist nicht installiert.");
        }
        return send({
          type: "ragents.app.invoke",
          version: 1,
          requestId: requestId(),
          actionId,
          input,
        });
      },
    }),
  });
})();
</script>`;

export const frameHtml = (
  frame: ReturnType<ActorProgramRuntime["frame"]>,
  nonce: string,
): string => {
  const head = /<head(?:\s[^>]*)?>/i;
  if (!head.test(frame.html)) throw new Error("Die installierte App besitzt keinen gültigen head.");
  const client = `<script nonce="${nonce}" type="module">await globalThis.__ragentsAppContext.ready;${escapedScript(frame.clientJavaScript)}</script>`;
  return frame.html.replace(head, (value) => `${value}${typedBridgeSdk(nonce, `${browserRuntimeStyles}\n${frame.styles}`)}${client}`);
};

export interface MiniAppRoutesOptions {
  ensureSession: (runId: string) => void;
  runtime: ActorProgramRuntime;
}

export const createMiniAppRoutes = (options: MiniAppRoutesOptions): HttpRouteContribution[] => [
  {
    id: "ragents.actor-programs.apps",
    isApiPath: (pathname) => pathname.startsWith(miniAppsApiPrefix),
    matches: (request, url) => request.method === "GET" && listPattern.test(url.pathname),
    handle: async ({ request, response, url, access }) => {
      const match = url.pathname.match(listPattern);
      if (!match) throw new Error("Ungültige App-Route.");
      const runId = match[1]!;
      await guardedJsonRoute({
        request,
        response,
        ensureSession: () => options.ensureSession(runId),
        handle: () => writeJson(response, 200, {
          apps: options.runtime.apps(runId),
          tools: access.can("runs.inspect") ? options.runtime.runLocalTools(runId) : [],
        }),
      });
    },
  },
  {
    id: "ragents.actor-programs.frame",
    isApiPath: (pathname) => pathname.startsWith(miniAppsApiPrefix),
    matches: (request, url) => request.method === "GET" && framePattern.test(url.pathname),
    handle: async ({ request, response, url }) => {
      const match = url.pathname.match(framePattern);
      if (!match) throw new Error("Ungültige App-Route.");
      const [, runId, appId] = match;
      await guardedJsonRoute({
        request,
        response,
        ensureSession: () => options.ensureSession(runId!),
        errorStatus: 404,
        handle: () => {
          const revision = url.searchParams.get("revision") ?? "";
          const nonce = randomBytes(18).toString("base64");
          const frame = options.runtime.frame(runId!, appId!, revision);
          const content = Buffer.from(frameHtml(frame, nonce), "utf8");
          // Die Vorfahren decken den Browser und die Webviews von VS Code ab (Desktop: vscode-file und vscode-cdn.net, ältere Fassungen: vscode-webview).
          const scripts = `'nonce-${nonce}'`;
          const styles = `'nonce-${nonce}'`;
          response.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Security-Policy": `sandbox allow-scripts allow-downloads; default-src 'none'; script-src ${scripts}; style-src ${styles}; img-src 'self' data: blob:; font-src data:; connect-src 'none'; media-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' https://*.vscode-cdn.net vscode-file: vscode-webview:`,
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": content.byteLength,
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
          });
          response.end(content);
        },
      });
    },
  },
  {
    id: "ragents.actor-programs.source",
    requiredRights: ["runs.read", "runs.inspect"],
    isApiPath: (pathname) => pathname.startsWith(miniAppsApiPrefix),
    matches: (request, url) => request.method === "GET" && sourcePattern.test(url.pathname),
    handle: async ({ request, response, url }) => {
      const match = url.pathname.match(sourcePattern);
      if (!match) throw new Error("Ungültige App-Route.");
      const [, runId, appId] = match;
      await guardedJsonRoute({
        request,
        response,
        ensureSession: () => options.ensureSession(runId!),
        errorStatus: 404,
        handle: async () => writeJson(response, 200, await options.runtime.moduleSource(runId!, appId!)),
      });
    },
  },
  {
    id: "ragents.actor-programs.action",
    isApiPath: (pathname) => pathname.startsWith(miniAppsApiPrefix),
    matches: (request, url) => request.method === "POST" && actionPattern.test(url.pathname),
    handle: async ({ request, response, url }) => {
      const match = url.pathname.match(actionPattern);
      if (!match) throw new Error("Ungültige App-Route.");
      const [, runId, appId, actionId] = match;
      await guardedJsonRoute({
        request,
        response,
        ensureSession: () => options.ensureSession(runId!),
        handle: async () => {
          if (request.headers["x-ragents-app-bridge"] !== "1")
            throw new Error("Diese Route darf nur über die App-Bridge aufgerufen werden.");
          const permit = options.runtime.invocationPermit(runId!);
          const body = await readActionBody(request);
          options.ensureSession(runId!);
          const invocation = options.runtime.startInvocation(
            runId!,
            appId!,
            body.revision,
            actionId!,
            body.requestId,
            body.input,
            permit,
          );
          writeJson(response, 202, invocation);
        },
      });
    },
  },
  {
    id: "ragents.actor-programs.invocation",
    isApiPath: (pathname) => pathname.startsWith(miniAppsApiPrefix),
    matches: (request, url) => request.method === "GET" && invocationPattern.test(url.pathname),
    handle: async ({ request, response, url }) => {
      const match = url.pathname.match(invocationPattern);
      if (!match) throw new Error("Ungültige App-Route.");
      const [, runId, appId, invocationId] = match;
      await guardedJsonRoute({
        request,
        response,
        ensureSession: () => options.ensureSession(runId!),
        errorStatus: 404,
        handle: () => writeJson(response, 200, options.runtime.invocation(runId!, appId!, invocationId!)),
      });
    },
  },
  {
    id:"ragents.actor-programs.function",
    requiredRights:["runs.read","runs.write","runs.inspect"],
    isApiPath:(pathname)=>pathname.startsWith(miniAppsApiPrefix),
    matches:(request,url)=>request.method==="POST"&&functionPattern.test(url.pathname),
    handle:async({request,response,url})=>{
      const [,runId,actorHandle,functionId]=url.pathname.match(functionPattern)!;
      await guardedJsonRoute({request,response,ensureSession:()=>options.ensureSession(runId!),handle:async()=>{
        const permit=options.runtime.invocationPermit(runId!);
        const body=await readActionBody(request);
        options.ensureSession(runId!);
        writeJson(response,202,options.runtime.startFunctionInvocation(runId!,actorHandle!,body.revision,functionId!,body.requestId,body.input,permit));
      }});
    },
  },
  {
    id:"ragents.actor-programs.function-invocation",
    requiredRights:["runs.read","runs.inspect"],
    isApiPath:(pathname)=>pathname.startsWith(miniAppsApiPrefix),
    matches:(request,url)=>request.method==="GET"&&functionInvocationPattern.test(url.pathname),
    handle:async({request,response,url})=>{
      const [,runId,actorHandle,id]=url.pathname.match(functionInvocationPattern)!;
      await guardedJsonRoute({request,response,ensureSession:()=>options.ensureSession(runId!),handle:()=>writeJson(response,200,options.runtime.invocation(runId!,actorHandle!,id!))});
    },
  },
];
