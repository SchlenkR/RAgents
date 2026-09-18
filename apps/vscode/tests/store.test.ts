import assert from "node:assert/strict";
import test from "node:test";
import { ServerClient } from "../src/server-client";
import { RunStore } from "../src/store";
import { runView, SESSION_TOKEN, session, startStubServer, waitFor } from "./fixtures";

test("without login the store loads runs and views and follows the run channel while a run is watched", async () => {
  const server = await startStubServer();
  const store = new RunStore(new ServerClient(server.url, undefined));
  try {
    await store.start();
    assert.deepEqual(store.status, { kind: "connected" });
    await waitFor(() => store.runs[0]?.loaded === true);
    assert.equal(store.runs[0]?.actors.length, 4);
    assert.equal(store.pendingQuestions, 1);
    const release = store.watch("run-a");
    await waitFor(() => server.subscribed().has("run:run-a"));
    server.setView(runView({ revision: 13, actions: [] }));
    server.emit("run:run-a", { kind: "run" });
    await waitFor(() => store.runs[0]?.events === 13);
    assert.equal(store.pendingQuestions, 0);
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
    await assert.rejects(client.login("ronald", "falsch"), /stimmen nicht/);
    const { token, snapshot } = await client.login("ronald", "geheim");
    assert.equal(token, SESSION_TOKEN);
    assert.equal(snapshot.user?.id, "ronald");
    client.useToken(token);
    await store.start();
    assert.deepEqual(store.status, { kind: "connected" });
    assert.equal(store.user?.id, "ronald");
    assert.ok(server.requests.filter((request) => request.path === "/chat/sessions").every((request) => request.authorization === `Bearer ${SESSION_TOKEN}`));
    await waitFor(() => store.runs[0]?.loaded === true);
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
    await waitFor(() => store.runs[0]?.loaded === true);
    server.setSessions([session({ id: "run-b", title: "Anderer" })]);
    await store.refresh();
    assert.deepEqual(store.runs.map((run) => [run.id, run.loaded]), [["run-b", false]]);
  } finally {
    store.dispose();
    await server.close();
  }
});
