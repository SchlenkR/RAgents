import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { request } from "node:http";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import type { LaunchOptions } from "playwright-core";
import type { PluginHost, PluginRegistration } from "@ragents/engine";
import { executorMachine, workspaceProcessContext } from "@ragents/workspace-executor";
import { BROWSER_CHROMIUM_SANDBOX_VARIABLE } from "../../../plugins/ragents.browser/executor/contract.ts";
import { assertBrowserSocketPath, chromiumSandbox, launchChromium } from "../../../plugins/ragents.browser/executor/playwright.ts";
import { plugin } from "../../../plugins/ragents.browser/server/index.ts";

const sandboxCrash = [
  "browserType.launchPersistentContext: Target page, context or browser has been closed",
  "Browser logs:",
  "",
  "<launching> /fixture/chrome --headless --user-data-dir=/tmp/fixture-profile",
  "<launched> pid=4242",
  "[pid=4242][err] [1007/101500.000000:FATAL:credentials.cc(132)] Check failed: sys_chroot(\"/proc/self/fdinfo/\") == 0. : Operation not permitted (1)",
  "[pid=4242] <process did exit: exitCode=null, signal=SIGABRT>",
].join("\n");

/** The machine's setting for one test; the previous value returns afterwards. */
const sandboxSetting = (t: TestContext, value: string | undefined): void => {
  const previous = process.env[BROWSER_CHROMIUM_SANDBOX_VARIABLE];
  t.after(() => { if (previous === undefined) delete process.env[BROWSER_CHROMIUM_SANDBOX_VARIABLE]; else process.env[BROWSER_CHROMIUM_SANDBOX_VARIABLE] = previous; });
  if (value === undefined) delete process.env[BROWSER_CHROMIUM_SANDBOX_VARIABLE]; else process.env[BROWSER_CHROMIUM_SANDBOX_VARIABLE] = value;
};

const fixture = async (t: TestContext) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-browser-launch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "playwright.mjs");
  await writeFile(file, `import { EventEmitter } from "node:events";
export const launches = [];
export const profiles = [];
export const state = { failure: undefined, policy: "disable_non_proxied_udp", overrides: [] };
const launch = async (options) => {
  launches.push(options);
  if (state.failure !== undefined) throw new Error(state.failure);
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
  const loaded = await import(pathToFileURL(file).href) as { launches: LaunchOptions[]; profiles: string[]; state: { failure: string | undefined; policy: string; overrides: unknown[] } };
  return { machine: { ...executorMachine("/unused"), hostPackageFile: () => file }, ...loaded };
};
const proxyRequest = (url: string): Promise<number> => new Promise((resolve, reject) => {
  const parsed = new URL(url);
  const outgoing = request({ hostname: parsed.hostname, port: parsed.port, path: "http://example.com", agent: false }, (response) => { response.resume(); resolve(response.statusCode!); });
  outgoing.on("error", reject);
  outgoing.end();
});

test("BROWSER_CHROMIUM_SANDBOX keeps Chromium's sandbox unless it is explicitly false", () => {
  for (const configured of [undefined, "", "1"]) assert.equal(chromiumSandbox({ [BROWSER_CHROMIUM_SANDBOX_VARIABLE]: configured }), true);
  assert.equal(chromiumSandbox({ [BROWSER_CHROMIUM_SANDBOX_VARIABLE]: "0" }), false);
  for (const configured of ["false", "true", "off", "no", " 0"]) {
    assert.throws(() => chromiumSandbox({ [BROWSER_CHROMIUM_SANDBOX_VARIABLE]: configured }), /BROWSER_CHROMIUM_SANDBOX is true or false in the profile section ragents\.browser and "1" or "0" in an environment/);
  }
});

test("singleton socket paths count UTF-8 bytes and reserve the Unix socket terminator", () => {
  for (const [platform, limit] of [["linux", 108], ["darwin", 104]] as const) {
    const socket = "/tmp/" + "x".repeat(limit - 6);
    assertBrowserSocketPath(socket, platform);
    assert.throws(() => assertBrowserSocketPath(socket + "x", platform), (error: Error) =>
      error.message.includes(`"${socket}x"`) && error.message.includes(`${limit} bytes including the terminator`));
    assert.throws(() => assertBrowserSocketPath(socket.slice(0, -1) + "ä", platform), /Unix socket limit/);
  }
  assertBrowserSocketPath("x".repeat(300), "win32");
});

test("each browser launch owns a short private temporary folder regardless of the run's data path", async (t) => {
  const stub = await fixture(t);
  const inherited = path.join(tmpdir(), "acme", ".local", "share", "ragents", "example-profile", "sessions", "00000000-0000-0000-0000-000000000000", "tmp");
  const environment = { TMPDIR: inherited, TMP: inherited, TEMP: inherited, RAGENTS_RUN_ID: "one" };
  const first = await launchChromium(stub.machine, "/fixture", "one", 1000, undefined, environment);
  t.after(() => first.close());
  const second = await launchChromium(stub.machine, "/fixture", "two", 1000, async () => ({ allowedOrigins: [] }), environment);
  t.after(() => second.close());
  const directories = stub.launches.map((launch) => launch.env!.TMPDIR!);
  assert.notEqual(directories[0], directories[1]);
  for (const [index, directory] of directories.entries()) {
    assert.equal(path.dirname(directory), await realpath(process.platform === "win32" ? tmpdir() : "/tmp"));
    assert.notEqual(directory, inherited);
    if (process.platform !== "win32") assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal(stub.launches[index]!.env!.TMP, directory);
    assert.equal(stub.launches[index]!.env!.TEMP, directory);
    assertBrowserSocketPath(path.join(directory, "org.chromium.Chromium.XXXXXX", "SingletonSocket"));
    await writeFile(path.join(directory, "fixture"), "private");
  }
  assert.equal(stub.profiles[0], path.join(directories[1]!, "profile"));
  assert.equal(environment.TMPDIR, inherited);
  await first.close();
  await assert.rejects(access(directories[0]!), /ENOENT/);
  await access(directories[1]!);
  await second.close();
  await assert.rejects(access(directories[1]!), /ENOENT/);
});

test("an invalid BROWSER_CHROMIUM_SANDBOX aborts the server's startup and starts no browser", async (t) => {
  sandboxSetting(t, "off");
  const registration = { service: () => { throw new Error("The plugin must check its setting first"); } } as unknown as PluginRegistration;
  assert.throws(() => plugin.create({} as PluginHost).register(registration), /BROWSER_CHROMIUM_SANDBOX is true or false/);
  const stub = await fixture(t);
  await assert.rejects(launchChromium(stub.machine, "/fixture", "member", 1000, async () => ({ allowedOrigins: [] })), /BROWSER_CHROMIUM_SANDBOX is true or false/);
  assert.equal(stub.launches.length, 0);
  assert.equal(stub.profiles.length, 0);
});

test("Chromium's own sandbox is on by default for unrestricted and restricted browser launches", async (t) => {
  sandboxSetting(t, undefined);
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
  const temporary = stub.launches[1]!.env!.TMPDIR!;
  assert.deepEqual(stub.launches[1]!.env, { ...environment, TMPDIR: temporary, TMP: temporary, TEMP: temporary });
  const preferences = JSON.parse(await readFile(path.join(stub.profiles[0]!, "Default", "Preferences"), "utf8"));
  assert.equal(preferences.webrtc.ip_handling_policy, "disable_non_proxied_udp");
  const address = stub.launches[1]!.proxy!.server;
  assert.equal(await proxyRequest(address), 407);
  await restricted.close();
  await assert.rejects(proxyRequest(address), /ECONNREFUSED|socket hang up/);
  await assert.rejects(access(stub.profiles[0]!), /ENOENT/);
  await assert.rejects(access(temporary), /ENOENT/);
});

test("a remaining socket path failure names its path and limit and removes launch storage", async (t) => {
  sandboxSetting(t, "0");
  const stub = await fixture(t);
  const socket = "/tmp/" + "x".repeat(140) + "/SingletonSocket";
  stub.state.failure = `browserType.launch: Target page, context or browser has been closed\n[err] FATAL: Socket path too long: ${socket}`;
  await assert.rejects(launchChromium(stub.machine, "/fixture", "one", 1000), (error: Error) =>
    error.message.includes(socket) && error.message.includes("Unix socket limit") && (error.cause as Error).message === stub.state.failure);
  assert.equal(stub.launches.length, 1);
  await assert.rejects(access(stub.launches[0]!.env!.TMPDIR!), /ENOENT/);
});

test("a sandbox crash names its cause and the setting, closes the proxy, and never retries without the sandbox", async (t) => {
  sandboxSetting(t, undefined);
  const stub = await fixture(t);
  stub.state.failure = sandboxCrash;
  const failure = await launchChromium(stub.machine, "/fixture", "member", 1000, async () => ({ allowedOrigins: [] })).then(() => undefined, (error: unknown) => error);
  assert.ok(failure instanceof Error);
  assert.equal(failure.message, "Chromium's sandbox cannot start on this machine ([1007/101500.000000:FATAL:credentials.cc(132)] Check failed: "
    + "sys_chroot(\"/proc/self/fdinfo/\") == 0. : Operation not permitted (1)). Set BROWSER_CHROMIUM_SANDBOX to false only when this machine "
    + "runs in an isolated container: a server takes it from the profile section ragents.browser, a workstation as \"0\" from its own environment.");
  assert.equal((failure.cause as Error).message, sandboxCrash);
  assert.equal(stub.launches.length, 1);
  assert.equal(stub.launches[0]!.chromiumSandbox, true);
  await assert.rejects(proxyRequest(stub.launches[0]!.proxy!.server), /ECONNREFUSED|socket hang up/);
  await assert.rejects(access(stub.profiles[0]!), /ENOENT/);
  stub.state.failure = "browserType.launch: Failed to launch the browser process.\nBrowser logs:\n\nChromium sandboxing failed!\n================================";
  await assert.rejects(launchChromium(stub.machine, "/fixture", "admin", 1000), /^Error: Chromium's sandbox cannot start on this machine \(Chromium sandboxing failed!\)\. Set BROWSER_CHROMIUM_SANDBOX to false/);
  stub.state.failure = "browserType.launch: Failed to launch the browser process.\nBrowser logs:\n\nerror while loading shared libraries: libnss3.so";
  await assert.rejects(launchChromium(stub.machine, "/fixture", "admin", 1000), (error: Error) => error.message === stub.state.failure);
  assert.equal(stub.launches.length, 3);
});

test("BROWSER_CHROMIUM_SANDBOX false launches Chromium without its sandbox and keeps the network policy", async (t) => {
  sandboxSetting(t, "0");
  const stub = await fixture(t);
  const unrestricted = await launchChromium(stub.machine, "/fixture", "admin", 1000);
  assert.equal(stub.launches[0]!.chromiumSandbox, false);
  await unrestricted.close();
  const restricted = await launchChromium(stub.machine, "/fixture", "member", 1000, async () => ({ allowedOrigins: [] }));
  assert.equal(stub.launches[1]!.chromiumSandbox, false);
  assert.equal(stub.launches[1]!.proxy?.bypass, "<-loopback>");
  assert.deepEqual(stub.launches[1]!.args, ["--disable-quic", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"]);
  await restricted.close();
  stub.state.failure = sandboxCrash;
  await assert.rejects(launchChromium(stub.machine, "/fixture", "admin", 1000), (error: Error) => error.message === sandboxCrash);
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


test("an Electron workstation runs its trusted browser launcher as Node and removes that mode before the browser", async (t) => {
  const stub = await fixture(t);
  const directory = await realpath(await mkdtemp("/tmp/ragents-browser-bootstrap-"));
  const home = path.join(directory, "home");
  const temporary = path.join(directory, "tmp");
  await Promise.all([home, temporary].map((entry) => mkdir(entry)));
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const electron = Object.getOwnPropertyDescriptor(process.versions, "electron");
  Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
  Object.defineProperty(process.versions, "electron", { configurable: true, value: "test" });
  t.after(async () => {
    Object.defineProperty(process, "platform", platform);
    if (electron) Object.defineProperty(process.versions, "electron", electron);
    else delete process.versions.electron;
    await rm(directory, { recursive: true, force: true });
  });
  const context = workspaceProcessContext({
    runId: "bootstrap", root: directory, cwd: directory, home: { home }, logDirectory: temporary, hostRoot: "/fixture",
    externalAgentEnvironment: {}, sandbox: { wrap: async (launch) => launch },
  });
  const browser = await launchChromium(stub.machine, "/fixture", context.runId, 1000, undefined, context.env, context);
  const options = stub.launches[0]!;
  assert.equal(options.env?.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(options.chromiumSandbox, false);
  try {
    const child = spawn(options.executablePath!, ["-e", "console.log('INNER_MODE=' + (process.env.ELECTRON_RUN_AS_NODE ?? 'unset'))"], {
      cwd: directory, env: options.env, stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(code, 0);
    assert.match(output, /INNER_MODE=unset/);
  } finally {
    await browser.close();
    if (options.env?.TMPDIR) await rm(options.env.TMPDIR, { force: true });
  }
});
