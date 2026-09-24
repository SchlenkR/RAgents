import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { env } from "../src/config-definition.ts";
import { resolveAnonymousUser, resolveDefaultStartEntry, resolveProfileUsers } from "../src/config-file.ts";

const source = "example-profile.ts";
const environment = { TEST_LOGIN_PASSWORD: "a-secret" };
const reader = { id: "reader", password: env("TEST_LOGIN_PASSWORD"), rights: ["runs.read"] };

test("fehlende Benutzer lassen das Profil offen, zwei Benutzer werden aus Secret-Referenzen aufgelöst", () => {
  assert.equal(resolveProfileUsers(source, undefined), undefined);
  assert.deepEqual(resolveProfileUsers(source, [reader, { ...reader, id: "admin", label: "Administration", rights: ["*"] }], environment), [
    { id: "reader", label: "reader", password: "a-secret", rights: ["runs.read"] },
    { id: "admin", label: "Administration", password: "a-secret", rights: ["*"] },
  ]);
  assert.deepEqual(resolveProfileUsers(source, [{ ...reader, rights: [] }], environment)?.[0]?.rights, []);
});

test("leere, doppelte oder missgebildete Benutzerkonfiguration scheitert hart", () => {
  for (const raw of [[], null, {}, [null], [reader, reader], [{ ...reader, id: "../reader" }],
    [{ ...reader, label: " " }], [{ ...reader, unknown: true }], [{ ...reader, rights: ["runs.*"] }],
    [{ ...reader, rights: ["runs.read", "runs.read"] }], [{ ...reader, rights: "*" }]]) {
    assert.throws(() => resolveProfileUsers(source, raw, environment));
  }
});

test("Fehlende und leere Passwörter scheitern ohne Secret-Ausgabe", () => {
  for (const [raw, variables] of [
    [[{ ...reader, password: "" }], environment],
    [[{ ...reader, password: { kind: "environment" } }], environment],
    [[reader], {}], [[reader], { TEST_LOGIN_PASSWORD: "" }],
  ] as const) {
    assert.throws(() => resolveProfileUsers(source, raw, variables), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes("never-print-this"), false);
      assert.match(error.message, /password/);
      return true;
    });
  }
});

test("der Profillader hält Benutzer getrennt von materialisierten Konfigurationswerten", () => {
  mkdirSync("/private/tmp/ragents-access-tests", { recursive: true });
  const root = mkdtempSync("/private/tmp/ragents-access-tests/profile-");
  try {
    writeFileSync(path.join(root, "ragents.config.login-test.ts"), `
export const config = {host:{RAGENTS_TEST_MATERIALIZED:"yes"}};
export const users = [{id:"reader",password:{kind:"environment",name:"RAGENTS_TEST_LOGIN_PASSWORD"},rights:["runs.read"]}];
export const defaultStartEntry = "example.setup";
`);
    const loader = fileURLToPath(new URL("../src/config-file.ts", import.meta.url));
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
const {loadConfigFile,configuredUsers,configuredDefaultStartEntry}=await import(${JSON.stringify(loader)});
const before=new Set(Object.keys(process.env));
await loadConfigFile(${JSON.stringify(root)});
const added=Object.keys(process.env).filter(key=>!before.has(key));
console.log(JSON.stringify({added,users:configuredUsers().map(({password,...user})=>user),defaultStartEntry:configuredDefaultStartEntry()}));
`], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, PRODUCT_PROFILE: "login-test", RAGENTS_TEST_LOGIN_PASSWORD: "isolated-password" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((result.stdout + result.stderr).includes("isolated-password"), false);
    const resultLine = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
    assert.deepEqual(resultLine, {
      added: ["RAGENTS_TEST_MATERIALIZED"], users: [{ id: "reader", label: "reader", rights: ["runs.read"] }], defaultStartEntry: "example.setup",
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test("Klartextpasswörter und erlaubte Setups bleiben getrennt von anonymen Rechten", () => {
  const startEntries = ["example.setup"];
  const user = { id: "operator", rights: ["runs.read", "runs.write"], startEntries };
  assert.deepEqual(resolveProfileUsers(source, [{ ...user, password: "configured-password" }])?.[0], { ...user, label: "operator", password: "configured-password" });
  assert.deepEqual(resolveAnonymousUser(source, user), { ...user, label: "operator" });
  assert.throws(() => resolveAnonymousUser(source, { ...user, password: "must-not-be-accepted" }), /erlaubt nur/);
  for (const invalid of [null, ["example.setup", "example.setup"], ["../escape"], [1], "example.setup"]) {
    assert.throws(() => resolveAnonymousUser(source, { ...user, startEntries: invalid }), /startEntries/);
    assert.throws(() => resolveProfileUsers(source, [{ ...user, password: "secret", startEntries: invalid }]), /startEntries/);
  }
});

test("der Default-Einstieg ist optional und sonst eine Einstiegkennung als String", () => {
  assert.equal(resolveDefaultStartEntry(source, undefined), undefined);
  assert.equal(resolveDefaultStartEntry(source, "ragents.reference.word-game"), "ragents.reference.word-game");
  for (const invalid of ["", " ", "../escape", 1, null, ["example.setup"], { id: "example.setup" }]) {
    assert.throws(() => resolveDefaultStartEntry(source, invalid), /defaultStartEntry/);
  }
});

test("persönliche Token kommen nur aus der Umgebung, sind eindeutig und mindestens 16 Zeichen lang", () => {
  const variables = { ...environment, TEST_DEV_TOKEN: "dev-token-0123456789", TEST_OTHER_TOKEN: "other-token-0123456789" };
  const dev = { ...reader, id: "dev", token: env("TEST_DEV_TOKEN") };
  assert.equal(resolveProfileUsers(source, [dev], variables)?.[0]?.token, "dev-token-0123456789");
  assert.equal("token" in (resolveProfileUsers(source, [reader], variables)?.[0] ?? {}), false);
  assert.deepEqual(resolveProfileUsers(source, [dev, { ...reader, id: "other", token: env("TEST_OTHER_TOKEN") }], variables)?.map((user) => user.token),
    ["dev-token-0123456789", "other-token-0123456789"]);
  assert.throws(() => resolveProfileUsers(source, [{ ...dev, token: "im-klartext-0123456789" }], variables), /token braucht env/);
  assert.equal("token" in (resolveProfileUsers(source, [dev], environment)?.[0] ?? {}), false, "ohne gesetzte Variable bleibt die Anmeldung per Passwort, der Start bricht nicht ab");
  assert.throws(() => resolveProfileUsers(source, [dev], { ...variables, TEST_DEV_TOKEN: "kurz" }), /16 bis 512/);
  assert.throws(() => resolveProfileUsers(source, [dev], { ...variables, TEST_DEV_TOKEN: "mit leerzeichen 0123456789" }), /16 bis 512/);
  assert.throws(() => resolveProfileUsers(source, [dev], { ...variables, TEST_DEV_TOKEN: "mit$dollar0123456789" }), /ohne Leerzeichen, \$ und !/);
  assert.throws(() => resolveProfileUsers(source, [dev, { ...reader, id: "twin", token: env("TEST_DEV_TOKEN") }], variables), /derselbe wie bei Benutzer dev/);
});
