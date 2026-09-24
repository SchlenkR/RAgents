import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { connectionSecretKey, connectionSetting, connectionsLocation, credentialsSecretKey, describeConnection, isProfileFile, parseConnections, profileNameOf, resolveHostPath } from "../src/connections";

test("Verbindungen werden geprüft: Server oder Profil, eindeutige Namen, Profildateiname und Serveradresse", () => {
  const parsed = parseConnections([
    { name: "Werkstatt lokal", profileFile: "/tmp/ragents.config.werkstatt.ts" },
    { name: "Werkstatt", url: "https://werkstatt.example.com/" },
    { kind: "running", name: "core", url: "http://localhost:4710" },
  ]);
  assert.deepEqual(parsed, [
    { kind: "profile", name: "Werkstatt lokal", profileFile: "/tmp/ragents.config.werkstatt.ts" },
    { kind: "server", name: "Werkstatt", url: "https://werkstatt.example.com" },
    { kind: "server", name: "core", url: "http://localhost:4710" },
  ]);
  assert.deepEqual(parseConnections(undefined), []);
  assert.equal(profileNameOf("/x/ragents.config.werkstatt-client.ts"), "werkstatt-client");
  for (const bad of [
    "text", [null], [{ name: "a" }], [{ name: "a", profileFile: "/x/config.ts" }],
    [{ name: "a", url: "ftp://x" }], [{ name: "a", url: "http://x/pfad" }], [{ name: "", url: "http://x" }],
    [{ kind: "other", name: "a", url: "http://x" }], [{ name: "a", url: "http://x" }, { name: "a", url: "http://y" }],
    [{ name: "a", url: "http://x", profileFile: "/x/ragents.config.x.ts" }],
  ]) assert.throws(() => parseConnections(bad), /ragents\.connections/);
  assert.equal(parseConnections([{ name: "a", profileFile: "~/werkstatt/ragents.config.a.ts" }])[0]!.name, "a");
  assert.deepEqual(parseConnections([{ name: "a", profileFile: "~/werkstatt/ragents.config.a.ts" }]), [
    { kind: "profile", name: "a", profileFile: path.join(homedir(), "werkstatt/ragents.config.a.ts") },
  ]);
  // Ein relativer Pfad hat keinen Bezugspunkt in der Einstellung; er zählt ab dem Arbeitsverzeichnis des Prozesses.
  assert.deepEqual(parseConnections([{ name: "a", profileFile: "ragents.config.a.ts" }]), [
    { kind: "profile", name: "a", profileFile: path.resolve("ragents.config.a.ts") },
  ]);
  assert.equal(connectionSecretKey(parsed[0]!), undefined);
  assert.equal(connectionSecretKey(parsed[1]!), "ragents.token:https://werkstatt.example.com");
  assert.equal(credentialsSecretKey(parsed[0]!), undefined);
  assert.equal(credentialsSecretKey(parsed[1]!), "ragents.login:https://werkstatt.example.com");
  assert.equal(describeConnection(parsed[1]!), "https://werkstatt.example.com");
  assert.match(describeConnection(parsed[0]!), /Profil werkstatt/);
});

test("ein Ziel wird als Eintrag der Einstellung geschrieben und ist danach wieder lesbar", () => {
  const parsed = parseConnections([{ name: "Werkstatt", url: "https://werkstatt.example.com/" }, { name: "lokal", profileFile: "/tmp/ragents.config.werkstatt.ts" }]);
  const written = parsed.map(connectionSetting);
  assert.deepEqual(written, [
    { name: "Werkstatt", url: "https://werkstatt.example.com" },
    { name: "lokal", profileFile: "/tmp/ragents.config.werkstatt.ts" },
  ]);
  assert.deepEqual(parseConnections(written), parsed);
});

test("der Host kommt aus der Einstellung oder aus dem Repo der Erweiterung und darf ein Checkout oder das Paket sein", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ragents-host-"));
  mkdirSync(path.join(root, "apps/server/src"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), "{}\n");
  writeFileSync(path.join(root, "apps/server/src/main.ts"), "");
  assert.equal(resolveHostPath(undefined, path.join(root, "apps/vscode")), root);
  assert.equal(resolveHostPath("", path.join(root, "apps/vscode")), root);
  assert.equal(resolveHostPath(root, "/nirgendwo/apps/vscode"), root);
  assert.equal(resolveHostPath(undefined, "/nirgendwo/apps/vscode"), undefined, "ohne Checkout holt die Erweiterung das Paket selbst");
  assert.throws(() => resolveHostPath("/nirgendwo", "/nirgendwo/apps/vscode"), /kein RAgents-Host .* ragents\.hostPath/s);
  assert.throws(() => resolveHostPath(42, root), /ragents\.hostPath muss ein Pfad sein/);
});

test("ein neues Ziel geht dorthin, wo die Liste schon steht; sonst in die Benutzereinstellung", () => {
  const entry = { name: "a", url: "http://x" };
  assert.deepEqual(connectionsLocation(undefined), { scope: "global", entries: [] });
  assert.deepEqual(connectionsLocation({}), { scope: "global", entries: [] });
  assert.deepEqual(connectionsLocation({ globalValue: [entry] }), { scope: "global", entries: [entry] });
  assert.deepEqual(connectionsLocation({ globalValue: [entry], workspaceValue: [] }), { scope: "workspace", entries: [] });
  assert.deepEqual(connectionsLocation({ workspaceValue: [entry] }), { scope: "workspace", entries: [entry] });
});

test("eine Profildatei, die es nicht gibt, ist als solche zu erkennen", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-profil-"));
  const file = path.join(directory, "ragents.config.pruef.ts");
  assert.equal(isProfileFile(file), false);
  writeFileSync(file, "");
  assert.equal(isProfileFile(file), true);
  assert.equal(isProfileFile(directory), false);
});
