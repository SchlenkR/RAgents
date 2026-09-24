import assert from "node:assert/strict";
import test from "node:test";
import { ServerClient } from "../src/server-client";
import { RunStore } from "../src/store";
import { runView, SESSION_TOKEN, session, startStubServer, stubProfile, waitFor } from "./fixtures";

test("without login the store loads runs and views and follows the run channel while a run is watched", async () => {
  const server = await startStubServer();
  const store = new RunStore(new ServerClient(server.url, undefined));
  try {
    await store.start();
    assert.deepEqual(store.status, { kind: "connected" });
    await waitFor(() => store.pendingActions === 1);
    const release = store.watch("run-a");
    await waitFor(() => server.subscribed().has("run:run-a"));
    server.setView(runView({ revision: 13, actions: [] }));
    server.emit("run:run-a");
    await waitFor(() => store.pendingActions === 0);
    release();
    await waitFor(() => !server.subscribed().has("run:run-a"));
  } finally {
    store.dispose();
    await server.close();
  }
});

test("a login-protected server yields login-required until a session token is used as bearer", async () => {
  const server = await startStubServer({ loginRequired: true });
  const client = new ServerClient(server.url, undefined);
  const store = new RunStore(client);
  try {
    await store.start();
    assert.deepEqual(store.status, { kind: "login-required", tokenGate: false });
    await assert.rejects(client.login("alice", "falsch"), /stimmen nicht/);
    const { token, snapshot } = await client.login("alice", "geheim");
    assert.equal(token, SESSION_TOKEN);
    assert.equal(snapshot.user?.id, "alice");
    client.useToken(token);
    await store.start();
    assert.deepEqual(store.status, { kind: "connected" });
    assert.equal(store.user?.id, "alice");
    assert.ok(server.requests.filter((request) => request.path === "/rpc").every((request) => request.authorization === `Bearer ${SESSION_TOKEN}`));
    await waitFor(() => store.pendingActions === 1);
  } finally {
    store.dispose();
    await server.close();
  }
});

test("a token gate is recognised by its 401 without login code and an unreachable server is reported", async () => {
  const server = await startStubServer({ tokenGate: true });
  const store = new RunStore(new ServerClient(server.url, undefined));
  try {
    await store.start();
    assert.deepEqual(store.status, { kind: "login-required", tokenGate: true });
    const gated = new RunStore(new ServerClient(server.url, SESSION_TOKEN));
    await gated.start();
    assert.deepEqual(gated.status, { kind: "connected" });
    gated.dispose();
  } finally {
    store.dispose();
    await server.close();
  }
  const offline = new RunStore(new ServerClient("http://127.0.0.1:1", undefined));
  await offline.start();
  assert.equal(offline.status.kind, "unreachable");
  offline.dispose();
});

test("a session list that loses a run drops its cached view", async () => {
  const server = await startStubServer();
  const store = new RunStore(new ServerClient(server.url, undefined));
  try {
    await store.start();
    await waitFor(() => store.pendingActions === 1);
    server.setSessions([session({ id: "run-b", title: "Anderer" })]);
    await store.refresh();
    assert.deepEqual(store.runs.map((run) => [run.id, run.pendingActions]), [["run-b", 0]]);
  } finally {
    store.dispose();
    await server.close();
  }
});

test("an unreadable run view is isolated: the other runs, the counts and the problem stay readable", async () => {
  const server = await startStubServer();
  const store = new RunStore(new ServerClient(server.url, undefined));
  try {
    server.setSessions([session(), session({ id: "run-b", title: "Anderer", updatedAt: 1 })]);
    server.setView(runView({ inputs: [{ actorId: "coordinator" }] as never }));
    await store.start();
    await waitFor(() => store.runs.some((run) => run.problem !== undefined));
    assert.deepEqual(store.runs.map((run) => [run.id, run.problem === undefined]), [["run-a", false], ["run-b", true]]);
    assert.equal(store.pendingActions, 0);
    server.setView(runView({ revision: 13 }));
    server.setSessions([session({ revision: 13 }), session({ id: "run-b", title: "Anderer", updatedAt: 1 })]);
    await store.refresh();
    await waitFor(() => store.run("run-a")?.problem === undefined && store.pendingActions === 1);
  } finally {
    store.dispose();
    await server.close();
  }
});

test("a start entry keeps the start options it fixes, so a new run preselects none of them", async () => {
  const fixed = { "ragents.workspace.binding": { kind: "fresh" } };
  const profile = stubProfile();
  const server = await startStubServer({ profile: { ...profile, startEntries: profile.startEntries.map((entry) => entry.action === "script" ? { ...entry, fixedStartOptions: fixed } : entry) } });
  const store = new RunStore(new ServerClient(server.url, undefined));
  try {
    await store.start();
    assert.deepEqual(store.startEntries.find((entry) => entry.action === "script")?.fixedStartOptions, fixed);
    assert.equal(store.startEntries.find((entry) => entry.action === "skill")?.fixedStartOptions, undefined);
  } finally {
    store.dispose();
    await server.close();
  }
});

test("a start entry keeps its guide, so the panel can ask before the start", async () => {
  const profile = stubProfile();
  const server = await startStubServer({ profile: { ...profile, startEntries: profile.startEntries.map((entry) => entry.action === "script" ? { ...entry, guide: "ragents.reference.circle-guide" } : entry) } });
  const store = new RunStore(new ServerClient(server.url, undefined));
  try {
    await store.start();
    assert.equal(store.startEntries.find((entry) => entry.action === "script")?.guide, "ragents.reference.circle-guide");
    assert.equal(store.startEntries.find((entry) => entry.action === "skill")?.guide, undefined);
  } finally {
    store.dispose();
    await server.close();
  }
});

test("the profile's default entry is kept only when it is one of the served start entries; otherwise the bootstrap fails", async () => {
  const server = await startStubServer({ profile: stubProfile({ defaultStartEntry: "ragents.reference.circle" }) });
  const store = new RunStore(new ServerClient(server.url, undefined));
  try {
    await store.start();
    assert.equal(store.defaultEntry, "ragents.reference.circle");
    assert.equal(store.startEntries.length, 2);
  } finally {
    store.dispose();
    await server.close();
  }
  const broken = await startStubServer({ profile: stubProfile({ defaultStartEntry: "ragents.reference.missing" }) });
  const brokenStore = new RunStore(new ServerClient(broken.url, undefined));
  const reported: string[] = [];
  brokenStore.onChange(() => { if (brokenStore.status.kind === "unreachable") reported.push(brokenStore.status.message); });
  try {
    await brokenStore.start();
    assert.match(reported.join("\n"), /ragents\.reference\.missing/);
    assert.equal(brokenStore.defaultEntry, undefined);
    assert.deepEqual(brokenStore.startEntries, []);
  } finally {
    brokenStore.dispose();
    await broken.close();
  }
});
