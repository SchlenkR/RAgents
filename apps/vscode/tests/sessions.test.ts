import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceClient } from "../../../plugins/ragents.workspace/client/workspace-client";
import { MissingEnvironmentError } from "../../server/src/missing-environment";
import type { Connection } from "../src/connections";
import { hostEnvironmentSecretKey, provideMissingSecret } from "../src/settings";
import { TargetSession, type LaunchedTarget, type SecretStore, type SessionServices } from "../src/sessions";
import { startStubServer, stubProfile, waitFor, type StubServer } from "./fixtures";

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
    workspaceClient: (transport) => new WorkspaceClient(transport, { id: "vscode-test", label: "Notebook", hostname: "notebook.local", platform: process.platform, folders: [process.cwd()] }, { hostRoot: () => undefined }),
    secrets: store,
    launch: (connection: Connection): Promise<LaunchedTarget> => {
      launches.push(connection.name);
      const url = urls[connection.name];
      if (!url) throw new Error(`Für ${connection.name} gibt es keinen Stub`);
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

const closeAll = async (sessions: readonly TargetSession[], servers: readonly StubServer[]) => {
  for (const session of sessions) await session.disconnect();
  for (const server of servers) await server.close();
};

test("zwei Ziele arbeiten gleichzeitig; Trennen des einen lässt das andere unberührt", async () => {
  const first = await startStubServer();
  const second = await startStubServer();
  const { services } = harness({ A: first.url, B: second.url });
  const a = new TargetSession(serverConnection("A", first.url), services);
  const b = new TargetSession(serverConnection("B", second.url), services);
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

test("ein lokales Profil bleibt nicht gestartet, bis jemand es startet", async () => {
  const server = await startStubServer();
  const { services, launches } = harness({ core: server.url });
  const session = new TargetSession(profileConnection("core"), services);
  try {
    assert.deepEqual(session.snapshot().status, { kind: "stopped" });
    assert.deepEqual(session.snapshot().entries, []);
    assert.equal(launches.length, 0);
    await session.connect();
    assert.equal(session.snapshot().status.kind, "connected");
    assert.deepEqual(launches, ["core"]);
    await waitFor(() => session.snapshot().entries.length === 2);
    await session.connect();
    assert.deepEqual(launches, ["core"], "ein laufendes Ziel wird nicht ein zweites Mal gestartet");
    await session.disconnect();
    assert.deepEqual(session.snapshot().status, { kind: "stopped" });
    await session.connect();
    assert.deepEqual(launches, ["core", "core"], "nach dem Stoppen startet es wieder");
  } finally {
    await closeAll([session], [server]);
  }
});

test("ein Ziel, das eine Anmeldung verlangt, blockiert die anderen nicht und meldet sich still an", async () => {
  const open = await startStubServer();
  const guarded = await startStubServer({ loginRequired: true });
  const { services, secrets: store } = harness({ A: open.url, B: guarded.url });
  const a = new TargetSession(serverConnection("A", open.url), services);
  const b = new TargetSession(serverConnection("B", guarded.url), services);
  try {
    await Promise.all([a.connect(), b.connect()]);
    assert.equal(a.snapshot().status.kind, "connected");
    assert.deepEqual(b.snapshot().status, { kind: "login-required", tokenGate: false });
    assert.equal(b.snapshot().savedLogin, false);

    await b.loginWith("alice", "falsch");
    assert.match(b.snapshot().problem ?? "", /stimmen nicht/);
    assert.equal(b.snapshot().status.kind, "login-required");
    assert.equal(a.snapshot().status.kind, "connected", "die fehlgeschlagene Anmeldung betrifft nur ihr Ziel");

    await b.loginWith("alice", "geheim");
    assert.equal(b.snapshot().status.kind, "connected");
    assert.equal(b.snapshot().user, "Alice");
    assert.equal(b.snapshot().savedLogin, true);
    assert.equal(store.values.get(`ragents.login:${guarded.url}`), JSON.stringify({ user: "alice", password: "geheim" }));
    assert.equal(store.values.get(`ragents.token:${guarded.url}`), "a".repeat(43));

    await b.logout();
    assert.equal(store.values.has(`ragents.login:${guarded.url}`), false);
    assert.equal(store.values.has(`ragents.token:${guarded.url}`), false);
    assert.equal(b.snapshot().status.kind, "login-required");
  } finally {
    await closeAll([a, b], [open, guarded]);
  }
});

test("ein Server, der das Abmelden ablehnt, behält die gespeicherten Anmeldedaten trotzdem nicht", async () => {
  const guarded = await startStubServer({ loginRequired: true, logoutFails: true });
  const { services, secrets: store } = harness({ B: guarded.url });
  const session = new TargetSession(serverConnection("B", guarded.url), services);
  try {
    await session.connect();
    await waitFor(() => session.snapshot().status.kind === "login-required");
    await session.loginWith("alice", "geheim");
    assert.equal(session.snapshot().savedLogin, true);

    await session.logout();
    assert.equal(store.values.has(`ragents.login:${guarded.url}`), false);
    assert.equal(session.snapshot().savedLogin, false);
    assert.match(session.snapshot().problem ?? "", /Abmelden/);
  } finally {
    await closeAll([session], [guarded]);
  }
});

test("gespeicherte Anmeldedaten melden das Ziel ohne Formular an", async () => {
  const guarded = await startStubServer({ loginRequired: true });
  const { services } = harness({ B: guarded.url }, { [`ragents.login:${guarded.url}`]: JSON.stringify({ user: "alice", password: "geheim" }) });
  const session = new TargetSession(serverConnection("B", guarded.url), services);
  try {
    await session.connect();
    await waitFor(() => session.snapshot().status.kind === "connected");
    assert.equal(session.snapshot().user, "Alice");
    assert.equal(session.snapshot().savedLogin, true);
  } finally {
    await closeAll([session], [guarded]);
  }
});

test("ohne Benutzerverwaltung erlaubt ein Ziel neue Runs auch ohne Vorlagen", async () => {
  const server = await startStubServer({ profile: stubProfile({ startEntries: [] }) });
  const { services } = harness({ A: server.url });
  const session = new TargetSession(serverConnection("A", server.url), services);
  try {
    await session.connect();
    await waitFor(() => session.snapshot().entries.length === 0 && session.snapshot().status.kind === "connected");
    assert.equal(session.snapshot().canCreate, true, "ohne Benutzerverwaltung darf der anonyme Zugang alles");
    assert.equal(session.snapshot().defaultEntry, undefined);
  } finally {
    await closeAll([session], [server]);
  }
});

test("an einem Server ohne Benutzer über das Netz meldet sich der Arbeitsplatz nicht an und die Umgebung nennt den Grund", async () => {
  const server = await startStubServer();
  const remote = server.url.replace("127.0.0.1", "[::ffff:127.0.0.1]");
  const { services } = harness({ A: remote });
  const session = new TargetSession(serverConnection("A", remote), services);
  try {
    await session.connect();
    await waitFor(() => session.snapshot().status.kind === "connected");
    await session.registerWorkspaceClient();
    assert.equal(server.workspaceClients().size, 0);
    assert.equal(session.workspaceClient?.status.kind, "idle");
    assert.match(session.snapshot().problem ?? "", /Arbeitsplatz nicht angemeldet: .*Loopback/);
  } finally {
    await closeAll([session], [server]);
  }
});

test("der Default-Einstieg des Servers steht im Schnappschuss der Umgebung", async () => {
  const server = await startStubServer({ profile: stubProfile({ defaultStartEntry: "ragents.reference.board" }) });
  const { services } = harness({ A: server.url });
  const session = new TargetSession(serverConnection("A", server.url), services);
  try {
    await session.connect();
    await waitFor(() => session.snapshot().defaultEntry === "ragents.reference.board");
    assert.equal(session.snapshot().entries.length, 2);
  } finally {
    await closeAll([session], [server]);
  }
});

test("ein totes Ziel meldet sich als nicht erreichbar, ohne die Sitzung zu verlieren", async () => {
  const { services } = harness({ A: "http://127.0.0.1:1" });
  const session = new TargetSession(serverConnection("A", "http://127.0.0.1:1"), services);
  try {
    await session.connect();
    assert.equal(session.snapshot().status.kind, "unreachable");
    assert.equal(session.snapshot().url, "http://127.0.0.1:1");
  } finally {
    await session.disconnect();
  }
});

test("fehlen einem Profil Umgebungsvariablen, führt jeder Wert zum nächsten Versuch, bis der Start durchläuft", async () => {
  const server = await startStubServer();
  const { services: base, secrets: store } = harness({});
  const verlangt = [
    { variable: "SERVICE_URL", section: "ragents.example", key: "SERVICE_ENDPOINT" },
    { variable: "SERVICE_TOKEN", section: "ragents.example", key: "SERVICE_KEY" },
  ];
  const services: SessionServices = {
    ...base,
    launch: () => {
      const offen = verlangt.find((missing) => !store.values.has(hostEnvironmentSecretKey(missing.variable)));
      if (offen) throw new MissingEnvironmentError(offen, `ragents.config.core.ts: ${offen.section}.${offen.key} verweist mit env("${offen.variable}") auf eine Umgebungsvariable, die in dieser Shell nicht gesetzt ist.`);
      return Promise.resolve({ url: server.url, token: undefined, host: undefined });
    },
  };
  const session = new TargetSession(profileConnection("core"), services);
  const names: string[] = [];
  const gefuehrt = (name: string) => provideMissingSecret(name, {
    names: () => names,
    writeNames: (next) => { names.splice(0, names.length, ...next); return Promise.resolve(); },
    askValue: () => Promise.resolve(`wert-${name}`),
    store: (value) => Promise.resolve(store.store(hostEnvironmentSecretKey(name), value)),
    retry: () => session.retry(),
  });
  try {
    await session.connect();
    assert.equal(session.snapshot().status.kind, "failed");
    assert.deepEqual(session.snapshot().missingEnvironment, verlangt[0], "die Umgebung nennt die erste fehlende Variable");

    await gefuehrt(session.snapshot().missingEnvironment!.variable);
    assert.deepEqual(names, ["SERVICE_URL"], "der Name steht danach in ragents.hostEnvironment");
    assert.equal(session.snapshot().status.kind, "failed");
    assert.deepEqual(session.snapshot().missingEnvironment, verlangt[1], "der zweite Versuch führt zur nächsten fehlenden Variablen");

    await gefuehrt(session.snapshot().missingEnvironment!.variable);
    assert.deepEqual(names, ["SERVICE_URL", "SERVICE_TOKEN"]);
    await waitFor(() => session.snapshot().status.kind === "connected");
    assert.equal(session.snapshot().missingEnvironment, undefined, "mit allen Werten bleibt kein Befund stehen");
  } finally {
    await closeAll([session], [server]);
  }
});

test("scheitert die Übernahme eines verteilten Profils an einer Umgebungsvariablen, steht der Befund an der Umgebung", async () => {
  const server = await startStubServer();
  const { services } = harness({ A: server.url });
  const session = new TargetSession(serverConnection("A", server.url), services);
  const missing = { variable: "SERVICE_TOKEN", section: "ragents.example", key: "SERVICE_KEY" };
  try {
    await session.connect();
    await waitFor(() => session.snapshot().status.kind === "connected");
    session.reportProblem(new MissingEnvironmentError(missing, "ragents.config.core.ts: SERVICE_KEY verweist auf SERVICE_TOKEN"));
    assert.deepEqual(session.snapshot().missingEnvironment, missing);
    assert.match(session.snapshot().problem ?? "", /SERVICE_TOKEN/);
    await session.retry();
    await waitFor(() => session.snapshot().status.kind === "connected");
    assert.equal(session.snapshot().missingEnvironment, undefined, "der neue Versuch beginnt ohne den alten Befund");
  } finally {
    await closeAll([session], [server]);
  }
});
