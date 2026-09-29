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

test("every window has its own identifier that stays the same across a restart of the same window", () => {
  let counter = 0;
  const create = () => `window-${++counter}-0000`;
  const first = store();
  const second = store();
  const firstId = windowClientId(first, create);
  const secondId = windowClientId(second, create);
  assert.notEqual(firstId, secondId, "two windows do not displace each other at the server");
  assert.equal(windowClientId(first, create), firstId);
  assert.match(firstId, /^[A-Za-z0-9_-]{8,64}$/);
  assert.match(windowClientId(store()), /^[A-Za-z0-9_-]{8,64}$/);
});

test("without user sign-in, the workspace registers only over loopback and otherwise names the reason", () => {
  const anonymous = { enabled: false, user: null };
  const signedIn = { enabled: true, user: { id: "alice", label: "Alice", rights: ["*"] } };
  for (const url of ["http://127.0.0.1:4710", "http://localhost:4710", "http://[::1]:4710"]) {
    assert.equal(workspaceRegistrationRefusal(anonymous, url), undefined, url);
  }
  assert.match(workspaceRegistrationRefusal(anonymous, "https://ragents.example.com") ?? "", /only over a loopback connection/);
  assert.equal(workspaceRegistrationRefusal(signedIn, "https://ragents.example.com"), undefined);
});
