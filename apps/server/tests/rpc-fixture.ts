import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import type { TestContext } from "node:test";
import {
  AccessProjectionRegistry,
  ChannelContributionRegistry,
  MethodContributionRegistry,
  RpcPeer,
  StartOptionContributionRegistry,
  notShared,
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
  call: () => Promise.reject(new Error("The test answers no server requests")),
  onClose: () => () => undefined,
};

/** The context the dispatcher passes to a method; the test overrides individual fields by spread. */
export const methodContext = (access: AccessContext = unrestrictedAccess): MethodContext => ({
  access,
  signal: new AbortController().signal,
  progress: () => undefined,
  connection,
  local: true,
});

const missing = (name: string) => () => { throw new Error(`The test does not provide ${name}`); };

/** A server without owner knowledge: every run id is reachable, as without sign-in. */
export const openRunAccess: RunAccessPolicy = { global: undefined, ownerOf: () => undefined, ownerOnly: () => false, sharing: () => notShared() };

/** The sources of the core methods; the test provides only what its method really uses. */
export const coreSources = (
  sessions: Partial<CoreMethodSources["sessions"]>,
  overrides: Partial<Omit<CoreMethodSources, "sessions">> = {},
): CoreMethodSources => ({
  plugins: { publicProfile: missing("plugins.publicProfile"), startOptions: new StartOptionContributionRegistry(), accessProjections: new AccessProjectionRegistry() } as unknown as CoreMethodSources["plugins"],
  version: "1.0.0",
  global: undefined,
  runOwner: () => undefined,
  runOwnerOnly: () => false,
  runSharing: () => notShared(),
  settingsGuarded: () => false,
  external: { open: () => false, set: async () => undefined },
  ...overrides,
  sessions: {
    get: missing("sessions.get"),
    list: missing("sessions.list"),
    delete: missing("sessions.delete"),
    subscribeList: missing("sessions.subscribeList"),
    markViewed: missing("sessions.markViewed"),
    sharing: missing("sessions.sharing"),
    share: missing("sessions.share"),
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

/** A real HTTP server with the given methods, channels and extra routes; it ends with the test. */
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
  if (!address || typeof address === "string") throw new Error("test server without port");
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

/** Calls a registered method like the server: rights, input and result are checked against the contract. */
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
