import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { request } from "node:http";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import type { LaunchOptions } from "playwright-core";
import { executorMachine } from "@ragents/workspace-executor";
import { launchChromium } from "../../../plugins/ragents.browser/executor/playwright.ts";

const fixture = async (t: TestContext) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-browser-launch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "playwright.mjs");
  await writeFile(file, `import { EventEmitter } from "node:events";
export const launches = [];
export const profiles = [];
export const state = { fail: false, policy: "disable_non_proxied_udp", overrides: [] };
const launch = async (options) => {
  launches.push(options);
  if (state.fail) throw new Error("Chromium sandbox failed");
  const browser = new EventEmitter();
  browser.newContext = async () => { throw new Error("No page requested by this fixture"); };
  browser.close = async () => { browser.emit("disconnected"); };
  return browser;
};
export default { chromium: {
  executablePath: () => process.execPath,
  launch,
  launchPersistentContext: async (profile, options) => {
    profiles.push(profile);
    const browser = await launch(options);
    return {
      browser: () => browser,
      close: () => browser.close(),
      setHTTPCredentials: async (value) => { if (value !== null) throw new Error("Origin credentials must be cleared"); },
      newPage: async () => ({
        goto: async (url) => { if (url !== "chrome://prefs-internals") throw new Error("Unexpected navigation"); },
        locator: () => ({ innerText: async () => JSON.stringify({ webrtc: { ip_handling_policy: { value: state.policy }, ip_handling_url: { value: state.overrides } } }) }),
        close: async () => {},
      }),
    };
  },
} };
`);
  const loaded = await import(pathToFileURL(file).href) as { launches: LaunchOptions[]; profiles: string[]; state: { fail: boolean; policy: string; overrides: unknown[] } };
  return { machine: { ...executorMachine("/unused"), hostPackageFile: () => file }, ...loaded };
};
const proxyRequest = (url: string): Promise<number> => new Promise((resolve, reject) => {
  const parsed = new URL(url);
  const outgoing = request({ hostname: parsed.hostname, port: parsed.port, path: "http://example.com", agent: false }, (response) => { response.resume(); resolve(response.statusCode!); });
  outgoing.on("error", reject);
  outgoing.end();
});

test("Chromium's own sandbox is mandatory for unrestricted and restricted browser launches", async (t) => {
  const stub = await fixture(t);
  const unrestricted = await launchChromium(stub.machine, "/fixture", "admin", 1000);
  assert.equal(stub.launches[0]!.chromiumSandbox, true);
  assert.equal(stub.launches[0]!.proxy, undefined);
  await unrestricted.close();
  const environment = { RAGENTS_RUN_ID: "member", SAFE_FIXTURE_VALUE: "neutral" };
  const restricted = await launchChromium(stub.machine, "/fixture", "member", 1000, async () => ({ allowedOrigins: [] }), environment);
  assert.equal(stub.launches[1]!.chromiumSandbox, true);
  assert.equal(stub.launches[1]!.proxy?.bypass, "<-loopback>");
  assert.ok(stub.launches[1]!.proxy?.username && stub.launches[1]!.proxy?.password);
  assert.deepEqual(stub.launches[1]!.args, ["--disable-quic", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"]);
  assert.deepEqual(stub.launches[1]!.env, environment);
  const preferences = JSON.parse(await readFile(path.join(stub.profiles[0]!, "Default", "Preferences"), "utf8"));
  assert.equal(preferences.webrtc.ip_handling_policy, "disable_non_proxied_udp");
  const address = stub.launches[1]!.proxy!.server;
  assert.equal(await proxyRequest(address), 407);
  await restricted.close();
  await assert.rejects(proxyRequest(address), /ECONNREFUSED|socket hang up/);
  await assert.rejects(access(stub.profiles[0]!), /ENOENT/);
});

test("a failed Chromium launch closes its proxy and never retries without the sandbox", async (t) => {
  const stub = await fixture(t);
  stub.state.fail = true;
  await assert.rejects(launchChromium(stub.machine, "/fixture", "member", 1000, async () => ({ allowedOrigins: [] })), /Chromium sandbox failed/);
  assert.equal(stub.launches.length, 1);
  assert.equal(stub.launches[0]!.chromiumSandbox, true);
  await assert.rejects(proxyRequest(stub.launches[0]!.proxy!.server), /ECONNREFUSED|socket hang up/);
  await assert.rejects(access(stub.profiles[0]!), /ENOENT/);
});

test("restricted Chromium fails closed when WebRTC policy is ineffective or overridden", async (t) => {
  const stub = await fixture(t);
  for (const override of [false, true]) {
    stub.state.policy = override ? "disable_non_proxied_udp" : "default";
    stub.state.overrides = override ? [{ url: "https://example.com", policy: "default" }] : [];
    await assert.rejects(launchChromium(stub.machine, "/fixture", "member", 1000, async () => ({ allowedOrigins: [] })), /required WebRTC network policy/);
    const address = stub.launches.at(-1)!.proxy!.server;
    await assert.rejects(proxyRequest(address), /ECONNREFUSED|socket hang up/);
    await assert.rejects(access(stub.profiles.at(-1)!), /ENOENT/);
  }
});
