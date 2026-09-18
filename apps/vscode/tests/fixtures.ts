import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { SessionInfo } from "../../web/src/api";
import type { RunView } from "../../../plugins/ragents.orchestration/web/run-view";

export const SESSION_TOKEN = "a".repeat(43);

const at = "2026-09-17T10:00:00.000Z";

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
    id: "question-1", askedBy: "jon", kind: "question", question: { options: ["Ja", "Nein"], multi: false }, title: "Nachtbus einführen?",
    description: null, parameters: {}, input: null, status: "pending", proposedAt: at, resolvedAt: null, resolvedBy: null, response: null,
  }],
  artifacts: [{ id: "artifact-1", title: "protokoll.md", mediaType: "text/markdown", hash: "h", size: 120, previousVersionId: null, createdBy: "coordinator", createdAt: at }],
  ...overrides,
});

export const session = (overrides: Partial<SessionInfo> = {}): SessionInfo => ({
  id: "run-a", title: "Nachtbus-Runde", createdAt: 1, updatedAt: 2, revision: 12, running: true, ...overrides,
});

export interface StubServer {
  url: string;
  requests: Array<{ method: string; path: string; authorization: string | undefined }>;
  emit: (channel: string, data: unknown) => void;
  subscribed: () => ReadonlySet<string>;
  setSessions: (sessions: SessionInfo[]) => void;
  setView: (view: RunView) => void;
  close: () => Promise<void>;
}

const readBody = (request: IncomingMessage): Promise<string> => new Promise((resolve) => {
  let body = "";
  request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
  request.on("end", () => resolve(body));
});

/** Ein Server mit den Routen, die die Erweiterung braucht: Zugang, Liste, Laufansicht und Ereignisstrom. */
export const startStubServer = async (options: { loginRequired?: boolean; tokenGate?: boolean } = {}): Promise<StubServer> => {
  const requests: StubServer["requests"] = [];
  let sessions: SessionInfo[] = [session()];
  let view: RunView = runView();
  const streams = new Set<{ response: ServerResponse; channels: Set<string> }>();
  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const user = { id: "ronald", label: "Ronald", rights: ["runs.read", "runs.write", "runs.inspect"] };
  const authorized = (request: IncomingMessage) => request.headers.authorization === `Bearer ${SESSION_TOKEN}`;
  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    requests.push({ method: request.method ?? "", path: url.pathname, authorization: request.headers.authorization });
    if (options.tokenGate && !authorized(request)) return json(response, 401, { error: "Zugangstoken fehlt" });
    if (options.loginRequired && !authorized(request)) {
      if (url.pathname === "/api/access") return json(response, 200, { enabled: true, user: null });
      if (url.pathname === "/api/access/login") {
        const body = JSON.parse(await readBody(request)) as { id: string; password: string };
        if (body.id !== "ronald" || body.password !== "geheim") return json(response, 401, { error: "Benutzerkennung oder Passwort stimmen nicht" });
        response.setHeader("set-cookie", `ragents-test-user=${SESSION_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`);
        return json(response, 200, { enabled: true, user });
      }
      return json(response, 401, { error: "Bitte melde dich an.", code: "login-required" });
    }
    if (url.pathname === "/api/access") return json(response, 200, options.loginRequired ? { enabled: true, user } : { enabled: false, user: null });
    if (url.pathname === "/api/access/logout") return json(response, 200, { enabled: true, user: null });
    if (url.pathname === "/chat/sessions") return json(response, 200, sessions);
    if (url.pathname === `/chat/${view.id}/run`) return json(response, 200, view);
    if (url.pathname.startsWith("/chat/") && url.pathname.endsWith("/run")) return json(response, 200, null);
    if (url.pathname === "/api/events") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const stream = { response, channels: new Set<string>() };
      streams.add(stream);
      response.write(`event: hello\ndata: ${JSON.stringify({ connection: "c".repeat(32) })}\n\n`);
      request.on("close", () => streams.delete(stream));
      return;
    }
    const subscription = url.pathname.match(/^\/api\/events\/([a-f0-9]{32})\/subscriptions(?:\/(.+))?$/);
    if (subscription) {
      const stream = [...streams][0];
      if (!stream) return json(response, 404, { error: "Die Ereignisverbindung ist unbekannt oder beendet." });
      if (request.method === "POST") {
        const channel = (JSON.parse(await readBody(request)) as { channel: string }).channel;
        stream.channels.add(channel);
        return json(response, 200, { subscribed: true, channel });
      }
      stream.channels.delete(decodeURIComponent(subscription[2] ?? ""));
      return json(response, 200, { subscribed: false });
    }
    json(response, 404, { error: "Unbekannte Route" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    emit: (channel, data) => {
      for (const stream of streams) if (stream.channels.has(channel)) stream.response.write(`data: ${JSON.stringify({ channel, data })}\n\n`);
    },
    subscribed: () => new Set([...streams].flatMap((stream) => [...stream.channels])),
    setSessions: (next) => { sessions = next; },
    setView: (next) => { view = next; },
    close: async () => {
      for (const stream of streams) stream.response.end();
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
