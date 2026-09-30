import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceClient } from "../../../plugins/ragents.workspace/client/workspace-client";
import { MissingEnvironmentError } from "../../server/src/missing-environment";
import type { Connection } from "../src/connections";
import { hostEnvironmentSecretKey, provideMissingSecret } from "../src/settings";
import { ConnectionSession, versionNotice, type LaunchedConnection, type SecretStore, type SessionServices } from "../src/sessions";
import { startStubServer, STUB_VERSION, stubProfile, waitFor, type StubServer } from "./fixtures";

const secrets = (initial: Record<string, string> = {}): SecretStore & { values: Map<string, string> } => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: (key) => Promise.resolve(values.get(key)),
    store: (key, value) => { values.set(key, value); return Promise.resolve(); },
    delete: (key) => { values.delete(key); return Promise.resolve(); },
  };
};

interface Harness {
  services: SessionServices;
  launches: string[];
  secrets: ReturnType<typeof secrets>;
}

const harness = (urls: Record<string, string>, stored: Record<string, string> = {}): Harness => {
  const launches: string[] = [];
  const store = secrets(stored);
  const services: SessionServices = {
    version: STUB_VERSION,
    workspaceClient: (transport) => new WorkspaceClient(transport, { id: "vscode-test", label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: [process.cwd()], runsDirectory: "/tmp/ragents-runs" }, { hostRoot: () => undefined }),
    secrets: store,
    launch: (connection: Connection): Promise<LaunchedConnection> => {
      launches.push(connection.name);
      const url = urls[connection.name];
      if (!url) throw new Error(`There is no stub for ${connection.name}`);
      return Promise.resolve({ url, token: undefined, host: undefined });
    },
    log: () => undefined,
    probe: () => undefined,
    onHostExit: () => undefined,
  };
  return { services, launches, secrets: store };
};

const serverConnection = (name: string, url: string): Connection => ({ kind: "server", name, url });

const profileConnection = (name: string): Connection => ({ kind: "profile", name, profileFile: `/x/ragents.config.${name}.ts` });

const closeAll = async (sessions: readonly ConnectionSession[], servers: readonly StubServer[]) => {
  for (const session of sessions) await session.disconnect();
  for (const server of servers) await server.close();
};

test("two servers work at the same time; disconnecting one leaves the other untouched", async () => {
  const first = await startStubServer();
  const second = await startStubServer();
  const { services } = harness({ A: first.url, B: second.url });
  const a = new ConnectionSession(serverConnection("A", first.url), services);
  const b = new ConnectionSession(serverConnection("B", second.url), services);
  try {
    await Promise.all([a.connect(), b.connect()]);
    assert.equal(a.snapshot().status.kind, "connected");
    assert.equal(b.snapshot().status.kind, "connected");
    await waitFor(() => first.workspaceClients().size === 1 && second.workspaceClients().size === 1);
    assert.deepEqual([...first.workspaceClients().keys()], ["vscode-test"]);
    assert.deepEqual([...second.workspaceClients().keys()], ["vscode-test"]);
    await waitFor(() => a.snapshot().runs[0]?.pendingActions === 1 && b.snapshot().runs[0]?.pendingActions === 1);
    assert.deepEqual(a.snapshot().entries.map((entry) => entry.id), ["ragents.reference.board", "ragents.reference.circle"]);
    assert.equal(a.snapshot().canCreate, true);

    await a.disconnect();
    assert.deepEqual(a.snapshot().status, { kind: "stopped" });
    assert.deepEqual(a.snapshot().runs, []);
    assert.equal(first.workspaceClients().size, 0);
    assert.equal(b.snapshot().status.kind, "connected");
    assert.equal(second.workspaceClients().size, 1);
    assert.equal(b.snapshot().runs.length, 1);
  } finally {
    await closeAll([a, b], [first, second]);
  }
});

test("a local profile stays not started until someone starts it", async () => {
  const server = await startStubServer();
  const { services, launches } = harness({ core: server.url });
  const session = new ConnectionSession(profileConnection("core"), services);
  try {
    assert.deepEqual(session.snapshot().status, { kind: "stopped" });
    assert.deepEqual(session.snapshot().entries, []);
    assert.equal(launches.length, 0);
    await session.connect();
    assert.equal(session.snapshot().status.kind, "connected");
    assert.deepEqual(launches, ["core"]);
    await waitFor(() => session.snapshot().entries.length === 2);
    await session.connect();
    assert.deepEqual(launches, ["core"], "a running server is not started a second time");
    await session.disconnect();
    assert.deepEqual(session.snapshot().status, { kind: "stopped" });
    await session.connect();
    assert.deepEqual(launches, ["core", "core"], "after stopping, it starts again");
  } finally {
    await closeAll([session], [server]);
  }
});

test("a server that requires sign-in does not block the others and signs in silently", async () => {
  const open = await startStubServer();
  const guarded = await startStubServer({ loginRequired: true });
  const { services, secrets: store } = harness({ A: open.url, B: guarded.url });
  const a = new ConnectionSession(serverConnection("A", open.url), services);
  const b = new ConnectionSession(serverConnection("B", guarded.url), services);
  try {
    await Promise.all([a.connect(), b.connect()]);
    assert.equal(a.snapshot().status.kind, "connected");
    assert.deepEqual(b.snapshot().status, { kind: "login-required", tokenGate: false });
    assert.equal(b.snapshot().savedLogin, false);

    await b.loginWith("alice", "wrong");
    assert.match(b.snapshot().problem ?? "", /is incorrect/);
    assert.equal(b.snapshot().status.kind, "login-required");
    assert.equal(a.snapshot().status.kind, "connected", "the failed sign-in affects only its server");

    await b.loginWith("alice", "secret");
    assert.equal(b.snapshot().status.kind, "connected");
    assert.equal(b.snapshot().user, "Alice");
    assert.equal(b.snapshot().savedLogin, true);
    assert.equal(store.values.get(`ragents.login:${guarded.url}`), JSON.stringify({ user: "alice", password: "secret" }));
    assert.equal(store.values.get(`ragents.token:${guarded.url}`), "a".repeat(43));

    await b.logout();
    assert.equal(store.values.has(`ragents.login:${guarded.url}`), false);
    assert.equal(store.values.has(`ragents.token:${guarded.url}`), false);
    assert.equal(b.snapshot().status.kind, "login-required");
  } finally {
    await closeAll([a, b], [open, guarded]);
  }
});

test("a server that rejects the sign-out still does not keep the stored credentials", async () => {
  const guarded = await startStubServer({ loginRequired: true, logoutFails: true });
  const { services, secrets: store } = harness({ B: guarded.url });
  const session = new ConnectionSession(serverConnection("B", guarded.url), services);
  try {
    await session.connect();
    await waitFor(() => session.snapshot().status.kind === "login-required");
    await session.loginWith("alice", "secret");
    assert.equal(session.snapshot().savedLogin, true);

    await session.logout();
    assert.equal(store.values.has(`ragents.login:${guarded.url}`), false);
    assert.equal(session.snapshot().savedLogin, false);
    assert.match(session.snapshot().problem ?? "", /Signing out/);
  } finally {
    await closeAll([session], [guarded]);
  }
});

test("stored credentials sign in to the server without a form", async (t) => {
  const guarded = await startStubServer({ loginRequired: true });
  const { services } = harness({ B: guarded.url }, { [`ragents.login:${guarded.url}`]: JSON.stringify({ user: "alice", password: "secret" }) });
  const log = t.mock.method(services, "log", () => undefined);
  const session = new ConnectionSession(serverConnection("B", guarded.url), services);
  try {
    await session.connect();
    await waitFor(() => session.snapshot().status.kind === "connected");
    assert.equal(session.snapshot().user, "Alice");
    assert.equal(session.snapshot().savedLogin, true);
    assert.deepEqual(log.mock.calls.map((call) => call.arguments), [[`== Signing in to ${guarded.url} with configured credentials`]]);
  } finally {
    await closeAll([session], [guarded]);
  }
});

test("without user management, a server allows new runs even without templates", async () => {
  const server = await startStubServer({ profile: stubProfile({ startEntries: [] }) });
  const { services } = harness({ A: server.url });
  const session = new ConnectionSession(serverConnection("A", server.url), services);
  try {
    await session.connect();
    await waitFor(() => session.snapshot().entries.length === 0 && session.snapshot().status.kind === "connected");
    assert.equal(session.snapshot().canCreate, true, "without user management, anonymous access may do everything");
    assert.equal(session.snapshot().defaultEntry, undefined);
  } finally {
    await closeAll([session], [server]);
  }
});

test("at a server without users over the network, the workspace does not register and the server names the reason", async () => {
  const server = await startStubServer();
  const remote = server.url.replace("127.0.0.1", "[::ffff:127.0.0.1]");
  const { services } = harness({ A: remote });
  const session = new ConnectionSession(serverConnection("A", remote), services);
  try {
    await session.connect();
    await waitFor(() => session.snapshot().status.kind === "connected");
    await session.registerWorkspaceClient();
    assert.equal(server.workspaceClients().size, 0);
    assert.equal(session.workspaceClient?.status.kind, "idle");
    assert.match(session.snapshot().problem ?? "", /Workspace not registered: .*loopback/);
  } finally {
    await closeAll([session], [server]);
  }
});

test("the default template of the server is in its snapshot", async () => {
  const server = await startStubServer({ profile: stubProfile({ defaultStartEntry: "ragents.reference.board" }) });
  const { services } = harness({ A: server.url });
  const session = new ConnectionSession(serverConnection("A", server.url), services);
  try {
    await session.connect();
    await waitFor(() => session.snapshot().defaultEntry === "ragents.reference.board");
    assert.equal(session.snapshot().entries.length, 2);
  } finally {
    await closeAll([session], [server]);
  }
});

test("a dead server reports as unreachable without losing the session", async () => {
  const { services } = harness({ A: "http://127.0.0.1:1" });
  const session = new ConnectionSession(serverConnection("A", "http://127.0.0.1:1"), services);
  try {
    await session.connect();
    assert.equal(session.snapshot().status.kind, "unreachable");
    assert.equal(session.snapshot().url, "http://127.0.0.1:1");
  } finally {
    await session.disconnect();
  }
});

test("if a profile is missing environment variables, each value leads to the next attempt until the start succeeds", async () => {
  const server = await startStubServer();
  const { services: base, secrets: store } = harness({});
  const required = [
    { variable: "SERVICE_URL", section: "ragents.example", key: "SERVICE_ENDPOINT" },
    { variable: "SERVICE_TOKEN", section: "ragents.example", key: "SERVICE_KEY" },
  ];
  const services: SessionServices = {
    ...base,
    launch: () => {
      const open = required.find((missing) => !store.values.has(hostEnvironmentSecretKey(missing.variable)));
      if (open) throw new MissingEnvironmentError(open, `ragents.config.core.ts: ${open.section}.${open.key} refers with env("${open.variable}") to an environment variable that is not set in this shell.`);
      return Promise.resolve({ url: server.url, token: undefined, host: undefined });
    },
  };
  const session = new ConnectionSession(profileConnection("core"), services);
  const names: string[] = [];
  const guided = (name: string) => provideMissingSecret(name, {
    names: () => names,
    writeNames: (next) => { names.splice(0, names.length, ...next); return Promise.resolve(); },
    askValue: () => Promise.resolve(`value-${name}`),
    store: (value) => Promise.resolve(store.store(hostEnvironmentSecretKey(name), value)),
    retry: () => session.retry(),
  });
  try {
    await session.connect();
    assert.equal(session.snapshot().status.kind, "failed");
    assert.deepEqual(session.snapshot().missingEnvironment, required[0], "the server names the first missing variable");

    await guided(session.snapshot().missingEnvironment!.variable);
    assert.deepEqual(names, ["SERVICE_URL"], "the name is then in ragents.hostEnvironment");
    assert.equal(session.snapshot().status.kind, "failed");
    assert.deepEqual(session.snapshot().missingEnvironment, required[1], "the second attempt leads to the next missing variable");

    await guided(session.snapshot().missingEnvironment!.variable);
    assert.deepEqual(names, ["SERVICE_URL", "SERVICE_TOKEN"]);
    await waitFor(() => session.snapshot().status.kind === "connected");
    assert.equal(session.snapshot().missingEnvironment, undefined, "with all values, no finding remains");
  } finally {
    await closeAll([session], [server]);
  }
});

test("if applying a distributed profile fails on an environment variable, the finding shows at the server", async () => {
  const server = await startStubServer();
  const { services } = harness({ A: server.url });
  const session = new ConnectionSession(serverConnection("A", server.url), services);
  const missing = { variable: "SERVICE_TOKEN", section: "ragents.example", key: "SERVICE_KEY" };
  try {
    await session.connect();
    await waitFor(() => session.snapshot().status.kind === "connected");
    session.reportProblem(new MissingEnvironmentError(missing, "ragents.config.core.ts: SERVICE_KEY refers to SERVICE_TOKEN"));
    assert.deepEqual(session.snapshot().missingEnvironment, missing);
    assert.match(session.snapshot().problem ?? "", /SERVICE_TOKEN/);
    await session.retry();
    await waitFor(() => session.snapshot().status.kind === "connected");
    assert.equal(session.snapshot().missingEnvironment, undefined, "the new attempt starts without the old finding");
  } finally {
    await closeAll([session], [server]);
  }
});

test("same version and accepted workspace: no notice", async () => {
  const server = await startStubServer();
  const { services } = harness({ A: server.url });
  const session = new ConnectionSession(serverConnection("A", server.url), services);
  try {
    await session.connect();
    await waitFor(() => session.workspaceClient?.status.kind === "registered");
    assert.equal(session.snapshot().versionNotice, undefined);
  } finally {
    await closeAll([session], [server]);
  }
});

test("a different server version is a warning with what needs updating; the workspace stays registered", async () => {
  const server = await startStubServer({ version: "0.1.7" });
  const { services } = harness({ A: server.url });
  const session = new ConnectionSession(serverConnection("A", server.url), services);
  try {
    await session.connect();
    await waitFor(() => session.workspaceClient?.status.kind === "registered" && session.snapshot().versionNotice !== undefined);
    assert.deepEqual(session.snapshot().versionNotice, {
      level: "warning",
      text: "RAgents version does not match: extension 0.1.8, server 0.1.7 - update the server to 0.1.8.",
      update: "server",
    });
    assert.equal(session.snapshot().problem, undefined);
    assert.equal(server.workspaceClients().size, 1);
  } finally {
    await closeAll([session], [server]);
  }
});

test("if the server rejects the workspace because of its revision, the different version is an error and not a second problem", async () => {
  const refusal = "The workspace Notebook brings executor 7, the server requires 8. Update the RAgents extension in VS Code or the package @schlenkr/ragents on the workspace.";
  const server = await startStubServer({ version: "0.1.9", refuseRegistration: { code: "workspace-executor-version", message: refusal } });
  const { services } = harness({ A: server.url });
  const session = new ConnectionSession(serverConnection("A", server.url), services);
  try {
    await session.connect();
    await waitFor(() => session.workspaceClient?.status.kind === "failed" && session.snapshot().versionNotice?.level === "error");
    assert.deepEqual(session.snapshot().versionNotice, {
      level: "error",
      text: `RAgents version does not match: extension 0.1.8, server 0.1.9 - update the RAgents extension to 0.1.9. The workspace is therefore not registered: ${refusal}`,
      update: "extension",
    });
    assert.equal(session.snapshot().problem, undefined, "the refusal appears only in the version notice");
    assert.equal(server.workspaceClients().size, 0);
  } finally {
    await closeAll([session], [server]);
  }
});

test("with the same version, a rejected revision is an error; another refusal stays a problem of the workspace", async () => {
  const refusing = await startStubServer({ refuseRegistration: { code: "workspace-executor-contributions", message: "The workspace Notebook brings none of the executor contributions." } });
  const other = await startStubServer({ refuseRegistration: { code: "workspace-client-busy", message: "Not right now." } });
  const { services } = harness({ A: refusing.url, B: other.url });
  const a = new ConnectionSession(serverConnection("A", refusing.url), services);
  const b = new ConnectionSession(serverConnection("B", other.url), services);
  try {
    await Promise.all([a.connect(), b.connect()]);
    await waitFor(() => a.workspaceClient?.status.kind === "failed" && b.workspaceClient?.status.kind === "failed");
    assert.deepEqual(a.snapshot().versionNotice, {
      level: "error",
      text: "RAgents revision does not match the server, the workspace is not registered: The workspace Notebook brings none of the executor contributions.",
      update: undefined,
    });
    assert.equal(a.snapshot().problem, undefined);
    assert.equal(b.snapshot().versionNotice, undefined);
    assert.equal(b.snapshot().problem, "Workspace not registered: Not right now.");
  } finally {
    await closeAll([a, b], [refusing, other]);
  }
});

test("a server without a version is older than this extension", async () => {
  const server = await startStubServer({ version: null });
  const { services } = harness({ A: server.url });
  const session = new ConnectionSession(serverConnection("A", server.url), services);
  try {
    await session.connect();
    await waitFor(() => session.snapshot().versionNotice !== undefined);
    assert.deepEqual(session.snapshot().versionNotice, {
      level: "warning",
      text: "RAgents version does not match: extension 0.1.8, server without version - update the server to 0.1.8.",
      update: "server",
    });
  } finally {
    await closeAll([session], [server]);
  }
});

test("the order of versions counts per position; a local profile brings the host at ragents.hostPath to the extension version", () => {
  const registered = { kind: "registered" } as const;
  assert.equal(versionNotice({ extension: "0.1.10", server: "0.1.9", connection: "server", workspace: registered })?.update, "server");
  assert.equal(versionNotice({ extension: "0.1.9", server: "0.1.10", connection: "server", workspace: registered })?.update, "extension");
  assert.equal(versionNotice({ extension: "0.1.9", server: "0.1.9", connection: "server", workspace: registered }), undefined);
  assert.equal(versionNotice({ extension: "0.1.9", server: undefined, connection: "server", workspace: registered }), undefined, "without an answer from the server, there is nothing to compare");
  assert.equal(versionNotice({ extension: "0.2.0", server: "0.1.9", connection: "profile", workspace: undefined })?.text,
    "RAgents version does not match: extension 0.2.0, server 0.1.9 - bring the host at ragents.hostPath to 0.2.0.");
  assert.deepEqual(versionNotice({ extension: "dev", server: "0.1.9", connection: "server", workspace: registered }), {
    level: "warning", text: "RAgents version does not match: extension dev, server 0.1.9 - bring extension and server to the same version.", update: undefined,
  });
});

test("stored credentials do not attempt silent login through an access-token gate", async (t) => {
  const url = "http://example.test";
  const requested: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
    requested.push(String(input));
    return Response.json({ error: "Access token missing" }, { status: 401 });
  });
  const { services } = harness({ B: url }, { [`ragents.login:${url}`]: JSON.stringify({ user: "alice", password: "secret" }) });
  const log = t.mock.method(services, "log", () => undefined);
  const session = new ConnectionSession(serverConnection("B", url), services);
  t.after(() => session.disconnect());
  await session.connect();
  assert.deepEqual(session.snapshot().status, { kind: "login-required", tokenGate: true });
  assert.deepEqual(requested, [`${url}/api/access`]);
  assert.equal(log.mock.callCount(), 0);
});
