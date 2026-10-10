import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createAccessContext, DomainError, MethodContributionRegistry, RpcError, RPC_ERROR_CODES, unrestrictedAccess, type AccessContext } from "@ragents/engine";
import { coreContracts } from "../src/api/contracts.ts";
import { preferenceMethods } from "../src/api/preference-methods.ts";
import { PREFERENCE_VALUE_LIMIT, type PreferenceKey } from "../src/preferences-contract.ts";
import { preferenceFileName, UserPreferences } from "../src/user-preferences.ts";
import { dispatchMethod } from "./rpc-fixture.ts";

const root = await mkdtemp(path.join(tmpdir(), "ragents-preferences-"));
after(() => rm(root, { recursive: true, force: true }));

const folders = { count: 0 };
const store = async () => {
  folders.count += 1;
  const directory = path.join(root, `store-${folders.count}`);
  return { directory, preferences: new UserPreferences(directory) };
};

const KEY: PreferenceKey = "start.layout";
const layout = { version: 1, order: ["start.continue", "start.new"], spans: { "start.continue": "narrow" }, removed: [] };

const domainError = (code: string, status: number, message?: RegExp) => (error: unknown) =>
  error instanceof DomainError && error.code === code && error.status === status && (message === undefined || message.test(error.message));

test("each user reads only their own values, the user without sign-in included, and IDs that differ in case stay apart", async () => {
  const { directory, preferences } = await store();
  await preferences.write("alice", KEY, layout);
  await preferences.write(null, KEY, { version: 1, order: [], spans: {}, removed: ["start.new"] });
  assert.deepEqual(await preferences.read("alice", KEY), layout);
  assert.equal(await preferences.read("bob", KEY), null, "another user has nothing stored");
  assert.equal(await preferences.read("Alice", KEY), null, "a user ID that differs only in case is another user");
  assert.deepEqual(await preferences.read(null, KEY), { version: 1, order: [], spans: {}, removed: ["start.new"] });
  assert.deepEqual((await readdir(directory)).sort(), ["anonymous.json", preferenceFileName("alice")].sort());
  assert.equal(preferenceFileName("alice"), "user-616c696365.json");
  assert.notEqual(preferenceFileName("Alice"), preferenceFileName("alice"));
  const file = path.join(directory, preferenceFileName("alice"));
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 1, userId: "alice", values: { [KEY]: layout } });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);

  await preferences.write("alice", KEY, null);
  assert.equal(await preferences.read("alice", KEY), null, "null removes the value");
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).values, {});
});

test("a value above the limit, a value that is not JSON, and an unknown key are refused without touching the file", async () => {
  const { directory, preferences } = await store();
  const fits = "x".repeat(PREFERENCE_VALUE_LIMIT - 2);
  await preferences.write("alice", KEY, fits);
  assert.equal(await preferences.read("alice", KEY), fits, "a value of exactly the limit is stored");
  await assert.rejects(preferences.write("alice", KEY, `${fits}x`), domainError("preference-too-large", 413, new RegExp(`at most ${PREFERENCE_VALUE_LIMIT}`)));
  await assert.rejects(preferences.write("alice", KEY, { count: Number.NaN }), domainError("preference-invalid", 400));
  await assert.rejects(preferences.write("alice", KEY, undefined), domainError("preference-invalid", 400));
  await assert.rejects(preferences.write("alice", "start.other" as PreferenceKey, 1), domainError("preference-unknown", 400, /known are start\.layout/));
  await assert.rejects(preferences.read("alice", "start.other" as PreferenceKey), domainError("preference-unknown", 400));
  assert.equal(await preferences.read("alice", KEY), fits, "a refused write keeps the stored value");
  assert.deepEqual(await readdir(directory), [preferenceFileName("alice")], "no temporary file remains");
});

test("a damaged file fails only its user's reads and writes and stays as it is, and stored keys this host does not know are kept", async () => {
  const { directory, preferences } = await store();
  await preferences.write("bob", KEY, layout);
  const file = path.join(directory, preferenceFileName("alice"));
  const damaged = async (content: string, cause: RegExp) => {
    await writeFile(file, content);
    await assert.rejects(preferences.read("alice", KEY), domainError("preferences-unreadable", 500, cause));
    await assert.rejects(preferences.write("alice", KEY, layout), domainError("preferences-unreadable", 500, cause));
    assert.equal(await readFile(file, "utf8"), content, "the damaged file stays untouched");
  };
  await damaged("{", new RegExp(`preferences/${preferenceFileName("alice")} cannot be read .*repair or delete`));
  await damaged(JSON.stringify({ version: 2, userId: "alice", values: {} }), /expected version 1, found 2/);
  await damaged(JSON.stringify({ version: 1, userId: "mallory", values: {} }), /belongs to the user "mallory"/);
  await damaged(JSON.stringify({ version: 1, userId: "alice", values: [] }), /values must be an object/);
  await damaged(JSON.stringify({ version: 1, userId: "alice" }), /expected the fields userId, values, version/);
  assert.deepEqual(await preferences.read("bob", KEY), layout, "another user's preferences stay readable");

  await writeFile(file, JSON.stringify({ version: 1, userId: "alice", values: { "later.key": { kept: true } } }));
  assert.equal(await preferences.read("alice", KEY), null);
  await preferences.write("alice", KEY, layout);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).values, { "later.key": { kept: true }, [KEY]: layout }, "a key from another version survives a write");
});

test("writes of one user follow each other, so the last one wins and the file stays valid", async () => {
  const { preferences } = await store();
  await Promise.all(Array.from({ length: 12 }, (_, index) => preferences.write("alice", KEY, { index })));
  assert.deepEqual(await preferences.read("alice", KEY), { index: 11 });
});

const user = (id: string, rights: readonly string[] = []): AccessContext => createAccessContext({ enabled: true, user: { id, label: id, rights: [...rights] } });

test("the methods reach only the caller's own preferences, need no right, and check key and sign-in", async () => {
  const { preferences } = await store();
  const methods = new MethodContributionRegistry();
  methods.register("test", preferenceMethods(preferences));
  const read = (access: AccessContext) => dispatchMethod(methods, coreContracts.preferences.read.id, { key: KEY }, access);
  const write = (access: AccessContext, value: unknown) => dispatchMethod(methods, coreContracts.preferences.write.id, { key: KEY, value }, access);
  assert.equal(await write(user("alice"), layout), null, "a user without any right keeps preferences");
  assert.deepEqual(await read(user("alice")), layout);
  assert.equal(await read(user("bob")), null);
  assert.equal(await read(user("admin", ["*"])), null, "administrators also reach only their own");
  assert.equal(await read(unrestrictedAccess), null, "the access without sign-in has its own user");
  await write(unrestrictedAccess, { version: 1, order: [], spans: {}, removed: [] });
  assert.deepEqual(await read(createAccessContext({ enabled: false, user: { id: "alice", label: "Alice", rights: [] } })), layout, "the configured user without sign-in is the user it names");
  await assert.rejects(read(createAccessContext({ enabled: true, user: null })), domainError("login-required", 401));
  await assert.rejects(dispatchMethod(methods, coreContracts.preferences.read.id, { key: "start.other" }, user("alice")),
    (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.invalidParams);
  await assert.rejects(dispatchMethod(methods, coreContracts.preferences.write.id, { key: KEY }, user("alice")),
    (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.invalidParams, "removing a value names null explicitly");
  await assert.rejects(write(user("alice"), "x".repeat(PREFERENCE_VALUE_LIMIT)), domainError("preference-too-large", 413));
  assert.deepEqual(await read(user("alice")), layout);
});
