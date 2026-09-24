import assert from "node:assert/strict";
import test from "node:test";
import { windowClientId, workspaceRegistrationRefusal, type IdentityStore } from "../src/workspace-identity";

const store = (): IdentityStore & { values: Map<string, unknown> } => {
  const values = new Map<string, unknown>();
  return {
    values,
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: (key, value) => { values.set(key, value); return Promise.resolve(); },
  };
};

test("jedes Fenster hat seine eigene Kennung, die über einen Neustart desselben Fensters gleich bleibt", () => {
  let counter = 0;
  const create = () => `fenster-${++counter}-0000`;
  const first = store();
  const second = store();
  const firstId = windowClientId(first, create);
  const secondId = windowClientId(second, create);
  assert.notEqual(firstId, secondId, "zwei Fenster verdrängen sich beim Server nicht");
  assert.equal(windowClientId(first, create), firstId);
  assert.match(firstId, /^[A-Za-z0-9_-]{8,64}$/);
  assert.match(windowClientId(store()), /^[A-Za-z0-9_-]{8,64}$/);
});

test("ohne Benutzeranmeldung meldet sich der Arbeitsplatz nur über Loopback an und nennt sonst den Grund", () => {
  const anonymous = { enabled: false, user: null };
  const signedIn = { enabled: true, user: { id: "alice", label: "Alice", rights: ["*"] } };
  for (const url of ["http://127.0.0.1:4710", "http://localhost:4710", "http://[::1]:4710"]) {
    assert.equal(workspaceRegistrationRefusal(anonymous, url), undefined, url);
  }
  assert.match(workspaceRegistrationRefusal(anonymous, "https://ragents.example.com") ?? "", /nur über eine Loopback-Verbindung/);
  assert.equal(workspaceRegistrationRefusal(signedIn, "https://ragents.example.com"), undefined);
});
