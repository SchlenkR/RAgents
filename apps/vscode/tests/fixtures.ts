import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import {
  ARTIFACT_CONTENT_PATH,
  ChannelContributionRegistry,
  createAccessContext,
  DomainError,
  implement,
  implementChannel,
  MethodContributionRegistry,
  runContracts,
  type MethodConnection,
} from "@ragents/engine";
import type { JournalEvent } from "../../../packages/ragents/src/domain/events";
import type { RunView as JournalRunView } from "../../../packages/ragents/src/domain/model";
import { coreContracts, type HostBootstrap } from "../../server/src/api/contracts";
import { RpcDispatcher } from "../../server/src/rpc/dispatcher";
import { RpcHttpTransport } from "../../server/src/rpc/http-transport";
import { workspaceClientContracts, workspaceContracts, type WorkspaceClientDescription } from "../../../plugins/ragents.workspace/contract";
import { processesContracts } from "../../../plugins/ragents.processes/contract";
import { TunnelStreams } from "../../../plugins/ragents.processes/server/tunnel-streams";
import { WORKSPACE_EXECUTOR_VERSION, type ExecutorContributionRevision } from "@ragents/workspace-executor";
import type { ListedSession } from "../../web/src/api";
import type { PublicPluginProfile } from "../../../packages/ragents/src/plugin-types";
import type { RunView } from "../../web/src/run-view";

export const SESSION_TOKEN = "a".repeat(43);

/** The RAgents version the stub names without its own value; the extension of the tests carries the same. */
export const STUB_VERSION = "0.1.8";

/** The run view of the UI carries the same data as that of the engine, only with its own types. */
const servedView = (value: RunView): JournalRunView => value as unknown as JournalRunView;

const at = "2026-09-17T10:00:00.000Z";

const JOURNAL: unknown[] = [{ sequence: 1, type: "run.created", payload: { runId: "run-a" } }];

const ARTIFACT_TEXT = "# Minutes\n";

export const runView = (overrides: Partial<RunView> = {}): RunView => ({
  id: "run-a",
  revision: 12,
  title: "Night bus round",
  ownerId: "owner",
  primaryActorId: "coordinator",
  createdAt: at,
  forkedFrom: null,
  actors: [
    { id: "owner", kind: "human", handle: "user", displayName: "You", grants: [], createdAt: at },
    { id: "coordinator", kind: "agent", handle: "coordinator", displayName: "Coordinator", grants: [], createdAt: at, lifecycle: { kind: "idle", since: at } },
    { id: "mira", kind: "agent", handle: "mira", displayName: "Mira", grants: [], createdAt: at, lifecycle: { kind: "running", turnId: "turn-5", inputId: "input-5", startedAt: at } },
    { id: "jon", kind: "agent", handle: "jon", displayName: "Jon", grants: [], createdAt: at, lifecycle: { kind: "idle", since: at } },
    { id: "circle", kind: "script", handle: "conversation-circle", displayName: "Conversation circle", grants: [], createdAt: at, lifecycle: { kind: "stopped", stoppedAt: at, reason: "done" } },
  ],
  inputs: [
    { id: "input-6", actorId: "jon", content: "Your vote", artifactIds: [], sourceEventIds: [], subscriptionId: null, enqueuedBy: "circle", enqueuedAt: at, sequence: 6, lifecycle: { kind: "pending" } },
    { id: "input-7", actorId: "jon", content: "Addendum", artifactIds: [], sourceEventIds: [], subscriptionId: null, enqueuedBy: "circle", enqueuedAt: at, sequence: 7, lifecycle: { kind: "pending" } },
  ],
  turns: [],
  subscriptions: [],
  pluginStates: [{
    pluginId: "ragents.actor-programs",
    scope: { kind: "actor", actorId: "circle" },
    updatedAt: at,
    state: { version: 1, program: { name: "board", actorId: "circle", actorHandle: "conversation-circle", revision: "r1", views: [
      { id: "board--main", title: "Collection board", visible: true },
      { id: "board--hidden", title: "Internal", visible: false },
    ] } },
  }, {
    pluginId: "ragents.actor-programs",
    scope: { kind: "actor", actorId: "jon" },
    updatedAt: at,
    state: { version: 1, program: { name: "decision", actorId: "jon", actorHandle: "jon", revision: "r2", views: [{ id: "decision--main", title: "Decision", visible: true }] } },
  }],
  actions: [{
    id: "question-1", askedBy: "jon", owner: "ragents.ask", payload: { question: "Introduce a night bus?", options: ["Yes", "No"], multi: false }, title: "Introduce a night bus?",
    description: null, parameters: {}, input: null, status: "pending", proposedAt: at, resolvedAt: null, resolvedBy: null, result: null,
  }],
  artifacts: [{ id: "artifact-1", title: "minutes.md", mediaType: "text/markdown", hash: "h", size: 120, previousVersionId: null, createdBy: "coordinator", createdAt: at }],
  ...overrides,
});

export const session = (overrides: Partial<ListedSession> = {}): ListedSession => ({
  id: "run-a", title: "Night bus round", createdAt: 1, updatedAt: 2, revision: 12, running: true, state: "running", pendingActions: 1, workspaceAccessible: true, operable: true, ...overrides,
});

/** The client profile the stub delivers: product and two permitted start templates. */
export const stubProfile = (overrides: Partial<PublicPluginProfile> = {}): PublicPluginProfile => ({
  product: { id: "stub", title: "Stub" },
  plugins: [],
  startEntries: [
    { id: "ragents.reference.board", owner: "ragents.reference", title: "Collection board", description: "A board for ideas", action: "skill", skill: "board", category: "Mini-apps", prompt: "Build a board." },
    { id: "ragents.reference.circle", owner: "ragents.reference", title: "Conversation circle", description: "Four agents in a circle", action: "script", coordinator: true },
  ],
  ...overrides,
});

export interface StubServer {
  url: string;
  requests: Array<{ method: string; path: string; authorization: string | undefined }>;
  workspaceClients: () => ReadonlyMap<string, WorkspaceClientDescription>;
  workspaceConnection: (id: string) => MethodConnection | undefined;
  emit: (key: string) => void;
  subscribed: () => ReadonlySet<string>;
  setSessions: (sessions: ListedSession[]) => void;
  /** How often a client asked for a run view. */
  viewRequests: () => number;
  close: () => Promise<void>;
}

interface Emitter {
  key: string;
  send: () => void;
}

const readBody = (request: IncomingMessage): Promise<string> => new Promise((resolve) => {
  let body = "";
  request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
  request.on("end", () => resolve(body));
});

/** A stub made of the real building blocks: sign-in and artifacts over HTTP, everything else via dispatcher and transport. */
export const startStubServer = async (options: {
  loginRequired?: boolean;
  userRights?: string[];
  tokenGate?: boolean;
  logoutFails?: boolean;
  profile?: PublicPluginProfile;
  /** What the stub's plugins contribute to the executor; a workspace must bring exactly that. */
  contributions?: readonly ExecutorContributionRevision[];
  /** The RAgents version in the bootstrap; null omits it like a server that is older than this field. */
  version?: string | null;
  /** This is how the server rejects every registration of a workspace, e.g. with a different executor revision. */
  refuseRegistration?: { code: string; message: string };
  /** The tunnel of the process plugin with the real pairing of legs; the test plays the run's machine. Without it the stub does not know the method. */
  tunnel?: {
    /** Fails like the run's executor when no process of the run listens on the port. */
    check: (runId: string, port: number, signal: AbortSignal) => Promise<void>;
    dial: (runId: string, port: number, path: string, signal: AbortSignal) => Promise<void>;
  };
} = {}): Promise<StubServer> => {
  const requests: StubServer["requests"] = [];
  const workspaceClients = new Map<string, WorkspaceClientDescription>();
  const workspaceConnections = new Map<string, MethodConnection>();
  const emitters = new Set<Emitter>();
  let sessions: ListedSession[] = [session()];
  let viewRequests = 0;
  const view: RunView = runView();
  const profile = options.profile ?? stubProfile();

  const tunnel = options.tunnel;
  const streams = tunnel ? new TunnelStreams({ dial: tunnel.dial }) : undefined;
  const methods = new MethodContributionRegistry();
  methods.register("stub", [
    implement(coreContracts.runs.list, () => sessions),
    implement(coreContracts.runs.delete, ({ runId }) => {
      sessions = sessions.filter((entry) => entry.id !== runId);
      return null;
    }),
    implement(coreContracts.plugins.bootstrap, () => options.version === null ? profile as HostBootstrap : { ...profile, version: options.version ?? STUB_VERSION, hostPackage: null }),
    implement(runContracts.view, ({ runId }) => {
      viewRequests += 1;
      if (sessions.some((entry) => entry.id === runId && entry.locked !== undefined)) throw new DomainError("journal-unavailable", `Journal for run ${runId} is not available`, 409);
      return runId === view.id ? servedView(view) : null;
    }),
    implement(runContracts.events, () => JOURNAL as JournalEvent[]),
    // As in the server, the stop goes to the workspace first and is only answered afterwards.
    implement(runContracts.stopAll, async ({ runId }) => {
      for (const [id, connection] of workspaceConnections) {
        const cwd = workspaceClients.get(id)?.folders[0];
        if (cwd) await connection.call(workspaceClientContracts.execute, { runId, operation: "stop", cwd, env: {}, input: null });
      }
      return servedView(view);
    }),
    implement(workspaceContracts.clients.contributions, () => (options.contributions ?? []).map((entry) => ({ ...entry }))),
    implement(workspaceContracts.clients.register, (input, { connection }) => {
      if (options.refuseRegistration) throw new DomainError(options.refuseRegistration.code, options.refuseRegistration.message, 409);
      if (!("id" in input) || input.executor !== WORKSPACE_EXECUTOR_VERSION) throw new Error(`The workspace brings executor ${input.executor}`);
      if (JSON.stringify(input.contributions) !== JSON.stringify(options.contributions ?? [])) throw new Error("The workspace brings different executor contributions");
      const { id, executor: _executor, contributions: _contributions, backgroundTasks: _backgroundTasks, ...description } = input;
      workspaceClients.set(id, description);
      workspaceConnections.set(id, connection);
      return { ...description, id };
    }),
    implement(workspaceContracts.clients.unregister, ({ id }) => {
      workspaceClients.delete(id);
      workspaceConnections.delete(id);
      return null;
    }),
    ...(tunnel && streams ? [implement(processesContracts.tunnel, async ({ runId, port, connect }, { signal }) => {
      if (connect) return streams.open(runId, port, signal);
      await tunnel.check(runId, port, signal);
      return null;
    })] : []),
  ]);
  const channels = new ChannelContributionRegistry();
  const channel = (key: string, send: () => void): (() => void) => {
    const emitter: Emitter = { key, send };
    emitters.add(emitter);
    return () => { emitters.delete(emitter); };
  };
  channels.register("stub", [
    implementChannel(coreContracts.channels.runs, (_params, emit) => channel("runs", () => emit({ type: "changed" }))),
    implementChannel(coreContracts.channels.run, ({ runId }, emit) => channel(`run:${runId}`, () => emit({ kind: "run" }))),
  ]);
  const transport = new RpcHttpTransport({ dispatcher: new RpcDispatcher({ methods, channels }) });

  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const user = { id: "alice", label: "Alice", rights: options.userRights ?? ["runs.read", "runs.write", "runs.inspect"] };
  const authorized = (request: IncomingMessage) => request.headers.authorization === `Bearer ${SESSION_TOKEN}`;
  const route = async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> => {
    if (options.tokenGate && !authorized(request)) return json(response, 401, { error: "Access token missing" });
    if (options.loginRequired && !authorized(request)) {
      if (url.pathname === "/api/access") return json(response, 200, { enabled: true, user: null });
      if (url.pathname === "/api/access/login") {
        const body = JSON.parse(await readBody(request)) as { id: string; password: string };
        if (body.id !== "alice" || body.password !== "secret") return json(response, 401, { error: "User id or password is incorrect" });
        response.setHeader("set-cookie", `ragents-test-user=${SESSION_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`);
        return json(response, 200, { enabled: true, user });
      }
      return json(response, 401, { error: "Please sign in.", code: "login-required" });
    }
    if (url.pathname === "/api/access") return json(response, 200, options.loginRequired ? { enabled: true, user } : { enabled: false, user: null });
    if (url.pathname === "/api/access/logout") {
      return options.logoutFails ? json(response, 500, { error: "Signing out is not supported here" }) : json(response, 200, { enabled: true, user: null });
    }
    if (ARTIFACT_CONTENT_PATH.test(url.pathname)) {
      response.writeHead(200, { "content-type": "text/markdown" });
      response.end(ARTIFACT_TEXT);
      return;
    }
    const access = createAccessContext(options.loginRequired ? { enabled: true, user } : { enabled: false, user: null });
    if (await transport.handle(request, response, url, access, true)) return;
    json(response, 404, { error: "Unknown route" });
  };

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push({ method: request.method ?? "", path: url.pathname, authorization: request.headers.authorization });
    void route(request, response, url);
  });
  const upgrades = streams?.route();
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (upgrades?.upgrade && upgrades.matches(request, url)) void upgrades.upgrade({ request, socket, head, url });
    else socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    workspaceClients: () => workspaceClients,
    workspaceConnection: (id) => workspaceConnections.get(id),
    emit: (key) => {
      for (const emitter of [...emitters]) if (emitter.key === key) emitter.send();
    },
    subscribed: () => new Set([...emitters].map((emitter) => emitter.key)),
    setSessions: (next) => { sessions = next; },
    viewRequests: () => viewRequests,
    close: async () => {
      transport.close();
      await streams?.shutdown();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
};

export const waitFor = async (condition: () => boolean, timeoutMs = 3000): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Condition was not met.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
