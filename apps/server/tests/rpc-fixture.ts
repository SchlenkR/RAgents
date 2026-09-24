import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import type { TestContext } from "node:test";
import {
  ChannelContributionRegistry,
  MethodContributionRegistry,
  RpcPeer,
  StartOptionContributionRegistry,
  unrestrictedAccess,
  type AccessContext,
  type ChannelContribution,
  type HttpRouteContribution,
  type MethodConnection,
  type MethodContext,
  type MethodContribution,
  type RpcFailure,
  type RpcSuccess,
} from "@ragents/engine";
import { RpcConnection, RpcDispatcher } from "../src/rpc/dispatcher.ts";
import { RpcHttpTransport } from "../src/rpc/http-transport.ts";
import type { CoreMethodSources } from "../src/api/core-methods.ts";
import type { RunAccessPolicy } from "../src/api/rights.ts";

const connection: MethodConnection = {
  id: "test-connection",
  userId: null,
  streamless: true,
  call: () => Promise.reject(new Error("Der Test beantwortet keine Serveranfragen")),
  onClose: () => () => undefined,
};

/** Der Kontext, den der Dispatcher einer Methode übergibt; einzelne Felder überschreibt der Test per Spread. */
export const methodContext = (access: AccessContext = unrestrictedAccess): MethodContext => ({
  access,
  signal: new AbortController().signal,
  progress: () => undefined,
  connection,
  local: true,
});

const missing = (name: string) => () => { throw new Error(`Der Test stellt ${name} nicht bereit`); };

/** Ein Server ohne Eigentümerwissen: jede Run-Kennung ist erreichbar, wie ohne Anmeldung. */
export const openRunAccess: RunAccessPolicy = { global: undefined, ownerOf: () => undefined, ownerOnly: () => false };

/** Die Quellen der Kernmethoden; der Test liefert nur, was seine Methode wirklich benutzt. */
export const coreSources = (
  sessions: Partial<CoreMethodSources["sessions"]>,
  overrides: Partial<Omit<CoreMethodSources, "sessions">> = {},
): CoreMethodSources => ({
  plugins: { publicProfile: missing("plugins.publicProfile"), startOptions: new StartOptionContributionRegistry() } as unknown as CoreMethodSources["plugins"],
  global: undefined,
  runOwner: () => undefined,
  runOwnerOnly: () => false,
  settingsGuarded: () => false,
  external: { open: () => false, set: async () => undefined },
  ...overrides,
  sessions: {
    get: missing("sessions.get"),
    list: missing("sessions.list"),
    delete: missing("sessions.delete"),
    subscribeList: missing("sessions.subscribeList"),
    subscribeRun: missing("sessions.subscribeRun"),
    startOptions: missing("sessions.startOptions"),
    selectStartOption: missing("sessions.selectStartOption"),
    prepareRunMessage: missing("sessions.prepareRunMessage"),
    exportRun: missing("sessions.exportRun"),
    importRun: missing("sessions.importRun"),
    settings: missing("sessions.settings"),
    skill: missing("sessions.skill"),
    titleModelSettings: missing("sessions.titleModelSettings"),
    saveTitleModelSettings: missing("sessions.saveTitleModelSettings"),
    ...sessions,
  } as CoreMethodSources["sessions"],
});

export interface RpcServerOptions {
  methods?: readonly MethodContribution[];
  channels?: readonly ChannelContribution[];
  routes?: readonly HttpRouteContribution[];
  maxBodyBytes?: number;
  accessFor?: (request: IncomingMessage) => AccessContext;
  local?: boolean;
}

export interface RpcTestServer {
  url: string;
  transport: RpcHttpTransport;
  call: (method: string, params?: unknown, headers?: Record<string, string>) => Promise<Partial<RpcSuccess & RpcFailure>>;
}

/** Ein echter HTTP-Server mit den übergebenen Methoden, Kanälen und Zusatzrouten; er endet mit dem Test. */
export const startRpcServer = async (t: TestContext, options: RpcServerOptions): Promise<RpcTestServer> => {
  const methods = new MethodContributionRegistry();
  methods.register("test", [...options.methods ?? []]);
  const channels = new ChannelContributionRegistry();
  channels.register("test", [...options.channels ?? []]);
  const transport = new RpcHttpTransport({ dispatcher: new RpcDispatcher({ methods, channels }), maxBodyBytes: options.maxBodyBytes });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://test");
    const access = options.accessFor?.(request) ?? unrestrictedAccess;
    void (async () => {
      if (await transport.handle(request, response, url, access, options.local ?? true)) return;
      const route = options.routes?.find((entry) => entry.matches(request, url));
      if (route) { await route.handle({ request, response, url, access }); return; }
      response.writeHead(404).end();
    })();
  });
  t.after(() => { transport.close(); server.closeAllConnections(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Testserver ohne Port");
  const url = `http://127.0.0.1:${address.port}`;
  let id = 0;
  return {
    url,
    transport,
    call: async (method, params, headers = {}) => {
      id += 1;
      const response = await fetch(`${url}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      return await response.json() as Partial<RpcSuccess & RpcFailure>;
    },
  };
};

/** Ruft eine registrierte Methode wie der Server: Rechte, Eingabe und Ergebnis werden gegen den Vertrag geprüft. */
export const dispatchMethod = (
  methods: MethodContributionRegistry,
  method: string,
  params: unknown,
  access: AccessContext = unrestrictedAccess,
): Promise<unknown> => {
  const dispatcher = new RpcDispatcher({ methods, channels: new ChannelContributionRegistry() });
  const target = new RpcConnection({ id: "test-dispatch", access, local: true, streamless: true, peer: new RpcPeer({ send: () => undefined }) }, dispatcher);
  return dispatcher.dispatch(target, method, params, { id: 1, signal: new AbortController().signal, progress: () => undefined });
};
