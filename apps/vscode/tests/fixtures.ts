import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ARTIFACT_CONTENT_PATH,
  ChannelContributionRegistry,
  createAccessContext,
  implement,
  implementChannel,
  MethodContributionRegistry,
  runContracts,
  type MethodConnection,
} from "@ragents/engine";
import type { JournalEvent } from "../../../packages/ragents/src/domain/events";
import type { RunView as JournalRunView } from "../../../packages/ragents/src/domain/model";
import { coreContracts } from "../../server/src/api/contracts";
import { RpcDispatcher } from "../../server/src/rpc/dispatcher";
import { RpcHttpTransport } from "../../server/src/rpc/http-transport";
import { workspaceClientContracts, workspaceContracts, type WorkspaceClientDescription } from "../../../plugins/ragents.workspace/contract";
import { WORKSPACE_EXECUTOR_VERSION } from "@ragents/workspace-executor";
import type { SessionInfo } from "../../web/src/api";
import type { PublicPluginProfile } from "../../../packages/ragents/src/plugin-types";
import type { RunView } from "../../web/src/run-view";

export const SESSION_TOKEN = "a".repeat(43);

/** Die Run-Ansicht der Oberfläche trägt dieselben Daten wie die der Engine, nur mit eigenen Typen. */
const servedView = (value: RunView): JournalRunView => value as unknown as JournalRunView;

const at = "2026-09-17T10:00:00.000Z";

const JOURNAL: unknown[] = [{ sequence: 1, type: "run.created", payload: { runId: "run-a" } }];

const ARTIFACT_TEXT = "# Protokoll\n";

export const runView = (overrides: Partial<RunView> = {}): RunView => ({
  id: "run-a",
  revision: 12,
  title: "Nachtbus-Runde",
  ownerId: "owner",
  primaryActorId: "coordinator",
  createdAt: at,
  forkedFrom: null,
  actors: [
    { id: "owner", kind: "human", handle: "user", displayName: "Du", grants: [], createdAt: at },
    { id: "coordinator", kind: "agent", handle: "coordinator", displayName: "Koordinator", grants: [], createdAt: at, lifecycle: { kind: "idle", since: at } },
    { id: "mira", kind: "agent", handle: "mira", displayName: "Mira", grants: [], createdAt: at, lifecycle: { kind: "running", turnId: "turn-5", inputId: "input-5", startedAt: at } },
    { id: "jon", kind: "agent", handle: "jon", displayName: "Jon", grants: [], createdAt: at, lifecycle: { kind: "idle", since: at } },
    { id: "circle", kind: "script", handle: "conversation-circle", displayName: "Gesprächsrunde", grants: [], createdAt: at, lifecycle: { kind: "stopped", stoppedAt: at, reason: "fertig" } },
  ],
  inputs: [
    { id: "input-6", actorId: "jon", content: "Deine Stimme", artifactIds: [], sourceEventIds: [], subscriptionId: null, enqueuedBy: "circle", enqueuedAt: at, sequence: 6, lifecycle: { kind: "pending" } },
    { id: "input-7", actorId: "jon", content: "Nachtrag", artifactIds: [], sourceEventIds: [], subscriptionId: null, enqueuedBy: "circle", enqueuedAt: at, sequence: 7, lifecycle: { kind: "pending" } },
  ],
  turns: [],
  subscriptions: [],
  pluginStates: [{
    pluginId: "ragents.actor-programs",
    scope: { kind: "actor", actorId: "circle" },
    updatedAt: at,
    state: { version: 1, program: { name: "board", actorId: "circle", actorHandle: "conversation-circle", revision: "r1", views: [
      { id: "board--main", title: "Sammelboard", visible: true },
      { id: "board--hidden", title: "Intern", visible: false },
    ] } },
  }, {
    pluginId: "ragents.actor-programs",
    scope: { kind: "actor", actorId: "jon" },
    updatedAt: at,
    state: { version: 1, program: { name: "decision", actorId: "jon", actorHandle: "jon", revision: "r2", views: [{ id: "decision--main", title: "Entscheidung", visible: true }] } },
  }],
  actions: [{
    id: "question-1", askedBy: "jon", owner: "ragents.ask", payload: { question: "Nachtbus einführen?", options: ["Ja", "Nein"], multi: false }, title: "Nachtbus einführen?",
    description: null, parameters: {}, input: null, status: "pending", proposedAt: at, resolvedAt: null, resolvedBy: null, result: null,
  }],
  artifacts: [{ id: "artifact-1", title: "protokoll.md", mediaType: "text/markdown", hash: "h", size: 120, previousVersionId: null, createdBy: "coordinator", createdAt: at }],
  ...overrides,
});

export const session = (overrides: Partial<SessionInfo> = {}): SessionInfo => ({
  id: "run-a", title: "Nachtbus-Runde", createdAt: 1, updatedAt: 2, revision: 12, running: true, ...overrides,
});

/** Das Client-Profil, das der Stub ausliefert: Produkt und zwei freigegebene Startvorlagen. */
export const stubProfile = (overrides: Partial<PublicPluginProfile> = {}): PublicPluginProfile => ({
  product: { id: "stub", title: "Stub" },
  plugins: [],
  startEntries: [
    { id: "ragents.reference.board", owner: "ragents.reference", title: "Sammelboard", description: "Ein Board für Ideen", action: "skill", skill: "board", category: "Mini-Apps", prompt: "Bau ein Board." },
    { id: "ragents.reference.circle", owner: "ragents.reference", title: "Gesprächsrunde", description: "Vier Agenten im Kreis", action: "script", coordinator: true },
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
  setSessions: (sessions: SessionInfo[]) => void;
  setView: (view: RunView) => void;
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

/** Ein Stub aus den echten Bausteinen: Anmeldung und Artefakte per HTTP, alles Weitere über Dispatcher und Transport. */
export const startStubServer = async (options: { loginRequired?: boolean; tokenGate?: boolean; logoutFails?: boolean; profile?: PublicPluginProfile } = {}): Promise<StubServer> => {
  const requests: StubServer["requests"] = [];
  const workspaceClients = new Map<string, WorkspaceClientDescription>();
  const workspaceConnections = new Map<string, MethodConnection>();
  const emitters = new Set<Emitter>();
  let sessions: SessionInfo[] = [session()];
  let view: RunView = runView();
  const profile = options.profile ?? stubProfile();

  const methods = new MethodContributionRegistry();
  methods.register("stub", [
    implement(coreContracts.runs.list, () => sessions),
    implement(coreContracts.plugins.bootstrap, () => profile),
    implement(runContracts.view, ({ runId }) => runId === view.id ? servedView(view) : null),
    implement(runContracts.events, () => JOURNAL as JournalEvent[]),
    // Wie im Server geht der Stopp erst an den Arbeitsplatz und wird erst danach beantwortet.
    implement(runContracts.stopAll, async ({ runId }) => {
      for (const [id, connection] of workspaceConnections) {
        const cwd = workspaceClients.get(id)?.folders[0];
        if (cwd) await connection.call(workspaceClientContracts.execute, { runId, operation: "stop", cwd, env: {}, input: null });
      }
      return servedView(view);
    }),
    implement(workspaceContracts.clients.register, ({ id, executor, ...description }, { connection }) => {
      if (executor !== WORKSPACE_EXECUTOR_VERSION) throw new Error(`Der Arbeitsplatz bringt den Executor ${executor} mit`);
      workspaceClients.set(id, description);
      workspaceConnections.set(id, connection);
      return { ...description, id };
    }),
    implement(workspaceContracts.clients.unregister, ({ id }) => {
      workspaceClients.delete(id);
      workspaceConnections.delete(id);
      return null;
    }),
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
  const user = { id: "alice", label: "Alice", rights: ["runs.read", "runs.write", "runs.inspect"] };
  const authorized = (request: IncomingMessage) => request.headers.authorization === `Bearer ${SESSION_TOKEN}`;
  const route = async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> => {
    if (options.tokenGate && !authorized(request)) return json(response, 401, { error: "Zugangstoken fehlt" });
    if (options.loginRequired && !authorized(request)) {
      if (url.pathname === "/api/access") return json(response, 200, { enabled: true, user: null });
      if (url.pathname === "/api/access/login") {
        const body = JSON.parse(await readBody(request)) as { id: string; password: string };
        if (body.id !== "alice" || body.password !== "geheim") return json(response, 401, { error: "Benutzerkennung oder Passwort stimmen nicht" });
        response.setHeader("set-cookie", `ragents-test-user=${SESSION_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`);
        return json(response, 200, { enabled: true, user });
      }
      return json(response, 401, { error: "Bitte melde dich an.", code: "login-required" });
    }
    if (url.pathname === "/api/access") return json(response, 200, options.loginRequired ? { enabled: true, user } : { enabled: false, user: null });
    if (url.pathname === "/api/access/logout") {
      return options.logoutFails ? json(response, 500, { error: "Abmelden ist hier nicht vorgesehen" }) : json(response, 200, { enabled: true, user: null });
    }
    if (ARTIFACT_CONTENT_PATH.test(url.pathname)) {
      response.writeHead(200, { "content-type": "text/markdown" });
      response.end(ARTIFACT_TEXT);
      return;
    }
    const access = createAccessContext(options.loginRequired ? { enabled: true, user } : { enabled: false, user: null });
    if (await transport.handle(request, response, url, access, true)) return;
    json(response, 404, { error: "Unbekannte Route" });
  };

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push({ method: request.method ?? "", path: url.pathname, authorization: request.headers.authorization });
    void route(request, response, url);
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
    setView: (next) => { view = next; },
    close: async () => {
      transport.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
};

export const waitFor = async (condition: () => boolean, timeoutMs = 3000): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Bedingung wurde nicht erfüllt.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
