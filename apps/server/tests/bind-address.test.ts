import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { configuredBindAddress, localHttpUrl, parseBindAddress } from "../src/bind-address.ts";
import { env } from "../src/config-definition.ts";
import { readProfileTarget } from "../src/profile-target.ts";

const temporary = async (t: TestContext): Promise<string> => {
  const directory = await mkdtemp(path.join(process.platform === "darwin" ? "/private/tmp" : tmpdir(), "ragents-bind-address-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

test("a bind address is an IPv4 or IPv6 literal or localhost and nothing else", () => {
  for (const value of ["127.0.0.1", "0.0.0.0", "::1", "::", "192.0.2.10", "2001:db8::1"]) {
    assert.equal(parseBindAddress(value, "BIND_ADDRESS"), value);
  }
  assert.equal(parseBindAddress("LocalHost", "BIND_ADDRESS"), "localhost");
  for (const value of ["", " 127.0.0.1", "127.0.0.1:4710", "[::1]", "fe80::1%lo0", "example.com", "256.0.0.1", "127.1", undefined, 4710]) {
    assert.throws(() => parseBindAddress(value, "BIND_ADDRESS"), /^Error: BIND_ADDRESS needs an IPv4 or IPv6 address without brackets, port, or zone, or localhost, not /, String(value));
  }
});

test("the environment's bind address wins over the profile's, and a reference to a variable that is not set is an error", () => {
  assert.equal(configuredBindAddress(undefined, {}), undefined);
  assert.equal(configuredBindAddress("127.0.0.1", {}), "127.0.0.1");
  assert.equal(configuredBindAddress("127.0.0.1", { BIND_ADDRESS: "::1" }), "::1");
  assert.equal(configuredBindAddress(env("EXAMPLE_BIND"), { EXAMPLE_BIND: "localhost" }), "localhost");
  assert.throws(() => configuredBindAddress(env("EXAMPLE_BIND"), {}), /host\.BIND_ADDRESS refers to the unset environment variable EXAMPLE_BIND/);
  assert.throws(() => configuredBindAddress(env("EXAMPLE_BIND"), { EXAMPLE_BIND: "example.com" }), /host\.BIND_ADDRESS \(EXAMPLE_BIND\) needs an IPv4 or IPv6 address/);
  assert.throws(() => configuredBindAddress("example.com", {}), /host\.BIND_ADDRESS needs an IPv4 or IPv6 address/);
  assert.throws(() => configuredBindAddress(4710, {}), /host\.BIND_ADDRESS needs an IPv4 or IPv6 address/);
  assert.throws(() => configuredBindAddress("127.0.0.1", { BIND_ADDRESS: "" }), /^Error: BIND_ADDRESS needs an IPv4 or IPv6 address/, "an empty value in the environment is not a fallback to the profile");
});

test("the local address names the bound interface; only all interfaces are reached under the given host name", () => {
  assert.equal(localHttpUrl(undefined, 4710), "http://localhost:4710");
  assert.equal(localHttpUrl("::", 4710), "http://localhost:4710");
  assert.equal(localHttpUrl("::0", 4710), "http://localhost:4710");
  assert.equal(localHttpUrl("0.0.0.0", 4710, "127.0.0.1"), "http://127.0.0.1:4710");
  assert.equal(localHttpUrl("127.0.0.1", 4710), "http://127.0.0.1:4710");
  assert.equal(localHttpUrl("::1", 4710), "http://[::1]:4710");
  assert.equal(localHttpUrl("192.0.2.10", 4710, "127.0.0.1"), "http://192.0.2.10:4710");
  assert.equal(localHttpUrl("localhost", 4710, "127.0.0.1"), "http://localhost:4710");
});

test("the address of a profile target follows the bind address of environment and profile file", async (t) => {
  const directory = await temporary(t);
  await writeFile(path.join(directory, "package.json"), '{"type":"module"}');
  const profile = async (name: string, host: string): Promise<string> => {
    const file = path.join(directory, `ragents.config.${name}.ts`);
    await writeFile(file, `export const config = { host: { PORT: 4790${host} } };\n`);
    return file;
  };
  const plain = await profile("plain", "");
  assert.equal((await readProfileTarget("plain", plain, {})).baseUrl, "http://localhost:4790");
  assert.equal((await readProfileTarget("plain", plain, {})).bindAddress, undefined);
  assert.equal((await readProfileTarget("plain", plain, { BIND_ADDRESS: "127.0.0.1" })).baseUrl, "http://127.0.0.1:4790");
  const bound = await profile("bound", ', BIND_ADDRESS: "::1"');
  assert.equal((await readProfileTarget("bound", bound, {})).baseUrl, "http://[::1]:4790");
  assert.equal((await readProfileTarget("bound", bound, { BIND_ADDRESS: "192.0.2.10" })).baseUrl, "http://192.0.2.10:4790");
  const wide = await profile("wide", ', BIND_ADDRESS: "0.0.0.0"');
  assert.equal((await readProfileTarget("wide", wide, {})).baseUrl, "http://localhost:4790");
  const invalid = await profile("invalid", ', BIND_ADDRESS: "example.com"');
  await assert.rejects(readProfileTarget("invalid", invalid, {}), /host\.BIND_ADDRESS needs an IPv4 or IPv6 address/);
});
