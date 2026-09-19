import { randomBytes } from "node:crypto";
import type { HttpRouteContribution } from "@aicontainer/ragents";
import { guardedJsonRoute } from "@aicontainer/server/plugin-support/http.js";
import { browserRuntimeStyles } from "./client-runtime.js";
import type { ActorProgramRuntime } from "./runtime.js";

export const miniAppsApiPrefix = "/api/plugins/ragents.actor-programs";

const framePattern = new RegExp(`^${miniAppsApiPrefix.replaceAll(".", "\\.")}\/runs\/([A-Za-z0-9_-]{1,64})\/apps\/([a-z][a-z0-9_-]{0,129})\/frame$`);

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

export interface MiniAppFrameOptions {
  ensureSession: (runId: string) => void;
  runtime: ActorProgramRuntime;
}

/** Die einzige Auslieferungsroute des Plugins: das HTML des Mini-App-Frames; alles andere sind Methoden. */
export const createMiniAppFrameRoutes = (options: MiniAppFrameOptions): HttpRouteContribution[] => [
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
];
