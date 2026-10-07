import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { connectionSecretKey, connectionSetting, connectionsLocation, credentialsSecretKey, describeConnection, isProfileFile, parseConnections, profileNameOf, extensionCheckout } from "../src/connections";

test("connections are validated: server or profile, unique names, profile file name, and server address", () => {
  const parsed = parseConnections([
    { name: "Workshop local", profileFile: "/tmp/ragents.config.workshop.ts" },
    { name: "Workshop", url: "https://workshop.example.com/" },
    { kind: "running", name: "core", url: "http://localhost:4710" },
  ]);
  assert.deepEqual(parsed, [
    { kind: "profile", name: "Workshop local", profileFile: "/tmp/ragents.config.workshop.ts" },
    { kind: "server", name: "Workshop", url: "https://workshop.example.com" },
    { kind: "server", name: "core", url: "http://localhost:4710" },
  ]);
  assert.deepEqual(parseConnections(undefined), []);
  assert.equal(profileNameOf("/x/ragents.config.workshop-client.ts"), "workshop-client");
  for (const bad of [
    "text", [null], [{ name: "a" }], [{ name: "a", profileFile: "/x/config.ts" }],
    [{ name: "a", url: "ftp://x" }], [{ name: "a", url: "http://x/path" }], [{ name: "", url: "http://x" }],
    [{ kind: "other", name: "a", url: "http://x" }], [{ name: "a", url: "http://x" }, { name: "a", url: "http://y" }],
    [{ name: "a", url: "http://x", profileFile: "/x/ragents.config.x.ts" }],
  ]) assert.throws(() => parseConnections(bad), /ragents\.connections/);
  assert.equal(parseConnections([{ name: "a", profileFile: "~/workshop/ragents.config.a.ts" }])[0]!.name, "a");
  assert.deepEqual(parseConnections([{ name: "a", profileFile: "~/workshop/ragents.config.a.ts" }]), [
    { kind: "profile", name: "a", profileFile: path.join(homedir(), "workshop/ragents.config.a.ts") },
  ]);
  // A relative path has no reference point in the setting; it counts from the working directory of the process.
  assert.deepEqual(parseConnections([{ name: "a", profileFile: "ragents.config.a.ts" }]), [
    { kind: "profile", name: "a", profileFile: path.resolve("ragents.config.a.ts") },
  ]);
  assert.equal(connectionSecretKey(parsed[0]!), undefined);
  assert.equal(connectionSecretKey(parsed[1]!), "ragents.token:https://workshop.example.com");
  assert.equal(credentialsSecretKey(parsed[0]!), undefined);
  assert.equal(credentialsSecretKey(parsed[1]!), "ragents.login:https://workshop.example.com");
  assert.equal(describeConnection(parsed[1]!), "https://workshop.example.com");
  assert.match(describeConnection(parsed[0]!), /Profile workshop/);
});

test("a server is written as an entry of the setting and is readable again afterwards", () => {
  const parsed = parseConnections([{ name: "Workshop", url: "https://workshop.example.com/" }, { name: "local", profileFile: "/tmp/ragents.config.workshop.ts" }]);
  const written = parsed.map(connectionSetting);
  assert.deepEqual(written, [
    { name: "Workshop", url: "https://workshop.example.com" },
    { name: "local", profileFile: "/tmp/ragents.config.workshop.ts" },
  ]);
  assert.deepEqual(parseConnections(written), parsed);
});

test("the extension's own repo is its host; without one it fetches the package", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ragents-host-"));
  mkdirSync(path.join(root, "apps/server/src"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), "{}\n");
  writeFileSync(path.join(root, "apps/server/src/main.ts"), "");
  assert.equal(extensionCheckout(path.join(root, "apps/vscode")), root);
  assert.equal(extensionCheckout("/nowhere/apps/vscode"), undefined, "without a checkout, the extension fetches the package itself");
});

test("a new server goes where the list already is; otherwise into the user setting", () => {
  const entry = { name: "a", url: "http://x" };
  assert.deepEqual(connectionsLocation(undefined), { scope: "global", entries: [] });
  assert.deepEqual(connectionsLocation({}), { scope: "global", entries: [] });
  assert.deepEqual(connectionsLocation({ globalValue: [entry] }), { scope: "global", entries: [entry] });
  assert.deepEqual(connectionsLocation({ globalValue: [entry], workspaceValue: [] }), { scope: "workspace", entries: [] });
  assert.deepEqual(connectionsLocation({ workspaceValue: [entry] }), { scope: "workspace", entries: [entry] });
});

test("a profile file that does not exist is recognized as such", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-profile-"));
  const file = path.join(directory, "ragents.config.check.ts");
  assert.equal(isProfileFile(file), false);
  writeFileSync(file, "");
  assert.equal(isProfileFile(file), true);
  assert.equal(isProfileFile(directory), false);
});
