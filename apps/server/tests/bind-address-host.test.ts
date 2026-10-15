import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { announcement, isolatedDirectory, stopChild } from "./foreign-plugin-fixture.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

const writeProfile = (directory: string, host: Readonly<Record<string, unknown>> = {}): string => {
  const file = path.join(directory, "ragents.config.bind-check.ts");
  const base = { PRODUCT_PROFILE: "bind-check", PRODUCT_ID: "acme", PRODUCT_TITLE: "Acme", PLUGINS: ["ragents.orchestration", "ragents.workspace", "ragents.product"] };
  writeFileSync(file, `import { env } from "@ragents/host/config-definition.js";
export const config = {
  host: ${JSON.stringify({ ...base, ...host })},
  "ragents.product": { OPENROUTER_API_KEY: env("ACME_MODEL_KEY"), AGENT_MODEL: "z-ai/glm-5.3-flash", AGENT_COORDINATOR_MODEL: "z-ai/glm-5.3-flash" },
};
`);
  return file;
};

// Development mode skips the check of the built web, which the host tests run before.
const environment = (directory: string, profile: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  ACME_MODEL_KEY: "not-a-real-key",
  RAGENTS_DEV: "1",
  PRODUCT_PROFILE: "bind-check",
  PRODUCT_PROFILE_FILE: profile,
  DATA_DIR: path.join(directory, "data"),
  PORT: undefined,
  BIND_ADDRESS: undefined,
  ...extra,
});

const startHost = (directory: string, profile: string, args: readonly string[], extra: NodeJS.ProcessEnv = {}): ChildProcess =>
  spawn(process.execPath, ["--import", "tsx", "src/main.ts", ...args], {
    cwd: path.join(root, "apps/server"),
    env: environment(directory, profile, extra),
    stdio: ["ignore", "pipe", "pipe"],
  });

const failedStart = (directory: string, profile: string, args: readonly string[], extra: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, ["--import", "tsx", "src/main.ts", ...args], {
    cwd: path.join(root, "apps/server"), encoding: "utf8", timeout: 60_000,
    env: environment(directory, profile, extra),
  });

/** Waits for the start message of a host on a fixed port and returns the address it names. */
const listeningAt = (child: ChildProcess, output: string[]): Promise<string> => new Promise((resolve, reject) => {
  for (const stream of [child.stdout!, child.stderr!]) {
    createInterface({ input: stream }).on("line", (line) => {
      output.push(line);
      const address = /Acme server: (http:\/\/\S+) \(workspace mode/.exec(line)?.[1];
      if (address) resolve(address);
    });
  }
  child.once("exit", (code) => reject(new Error(`The process exited with ${code} before it listened:\n${output.slice(-25).join("\n")}`)));
});

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address() as { port: number };
    probe.close(() => resolve(port));
  });
});

/** Whether something accepts connections on that address; undefined when this machine cannot be reached there at all. */
const accepts = (port: number, address: string): Promise<boolean | undefined> => new Promise((resolve) => {
  const probe = connect({ port, host: address, timeout: 2_000 });
  probe.once("connect", () => { probe.destroy(); resolve(true); });
  probe.once("timeout", () => { probe.destroy(); resolve(undefined); });
  probe.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "ECONNREFUSED" ? false : undefined));
});

const externalIPv4 = (): readonly string[] => Object.values(networkInterfaces())
  .flatMap((entries) => entries ?? [])
  .filter((entry) => entry.family === "IPv4" && !entry.internal)
  .map((entry) => entry.address);

/** Of the given addresses that this machine has, those where the port accepts connections and those where it refuses them. */
const probePort = async (port: number, addresses: readonly string[]): Promise<{ reached: readonly string[]; refused: readonly string[] }> => {
  const results = await Promise.all(addresses.map(async (address) => ({ address, accepted: await accepts(port, address) })));
  return {
    reached: results.filter((result) => result.accepted === true).map((result) => result.address),
    refused: results.filter((result) => result.accepted === false).map((result) => result.address),
  };
};

test("a host without BIND_ADDRESS listens on all interfaces and names localhost", { timeout: 120_000 }, async () => {
  const directory = isolatedDirectory("ragents-bind-address-");
  const output: string[] = [];
  const port = await freePort();
  const server = startHost(directory, writeProfile(directory), [], { PORT: String(port) });
  try {
    assert.equal(await listeningAt(server, output), `http://localhost:${port}`);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
    const probed = await probePort(port, ["127.0.0.1", ...externalIPv4()]);
    assert.deepEqual(probed.refused, [], "the host answers on every address of the machine");
    assert.ok(probed.reached.includes("127.0.0.1"));
  } finally {
    await stopChild(server);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a host with host.BIND_ADDRESS 127.0.0.1 listens there only and names that address", { timeout: 120_000 }, async () => {
  const directory = isolatedDirectory("ragents-bind-address-");
  const output: string[] = [];
  const port = await freePort();
  const server = startHost(directory, writeProfile(directory, { BIND_ADDRESS: "127.0.0.1" }), [], { PORT: String(port) });
  try {
    assert.equal(await listeningAt(server, output), `http://127.0.0.1:${port}`);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
    const probed = await probePort(port, ["127.0.0.1", "::1", ...externalIPv4()]);
    assert.deepEqual(probed.reached, ["127.0.0.1"], "the host answers on no other address of the machine");
  } finally {
    await stopChild(server);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the environment and the flag win over host.BIND_ADDRESS of the profile", { timeout: 120_000 }, async () => {
  const directory = isolatedDirectory("ragents-bind-address-");
  const profile = writeProfile(directory, { BIND_ADDRESS: "0.0.0.0" });
  const outputs: string[][] = [[], []];
  const [first, second] = [await freePort(), await freePort()];
  const fromEnvironment = startHost(directory, profile, [], { PORT: String(first), BIND_ADDRESS: "127.0.0.1" });
  const fromFlag = startHost(path.join(directory, "second"), profile, ["--bind-address", "127.0.0.1"], { PORT: String(second) });
  try {
    assert.equal(await listeningAt(fromEnvironment, outputs[0]!), `http://127.0.0.1:${first}`);
    assert.equal(await listeningAt(fromFlag, outputs[1]!), `http://127.0.0.1:${second}`);
  } finally {
    await stopChild(fromEnvironment);
    await stopChild(fromFlag);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("port 0 stays on 127.0.0.1 unless an address is named, then the announcement still names a reachable address", { timeout: 120_000 }, async () => {
  const directory = isolatedDirectory("ragents-bind-address-");
  const profile = writeProfile(directory);
  const privateHost = startHost(directory, profile, ["--port", "0"]);
  const wideHost = startHost(path.join(directory, "wide"), profile, ["--port", "0", "--bind-address", "0.0.0.0"]);
  try {
    const priv = await announcement(privateHost, []);
    const privatePort = Number(new URL(priv.url).port);
    assert.equal(priv.url, `http://127.0.0.1:${privatePort}`);
    const probed = await probePort(privatePort, ["127.0.0.1", "::1", ...externalIPv4()]);
    assert.deepEqual(probed.reached, ["127.0.0.1"], "the private port is on loopback only");

    const wide = await announcement(wideHost, []);
    const widePort = Number(new URL(wide.url).port);
    assert.equal(wide.url, `http://127.0.0.1:${widePort}`);
    assert.equal((await fetch(`${wide.url}/health`)).status, 200);
    assert.deepEqual((await probePort(widePort, externalIPv4())).refused, [], "an address named explicitly replaces the loopback default");
  } finally {
    await stopChild(privateHost);
    await stopChild(wideHost);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an invalid or unusable bind address stops the start with a message that names it", { timeout: 120_000 }, async () => {
  const directory = isolatedDirectory("ragents-bind-address-");
  try {
    const profile = writeProfile(directory);
    const port = String(await freePort());
    const fromEnvironment = failedStart(directory, profile, [], { PORT: port, BIND_ADDRESS: "example.com" });
    assert.equal(fromEnvironment.status, 1, fromEnvironment.stderr);
    assert.match(fromEnvironment.stderr, /RAgents does not start: BIND_ADDRESS needs an IPv4 or IPv6 address.*not "example\.com"/);

    const fromProfile = failedStart(directory, writeProfile(directory, { BIND_ADDRESS: "[::1]" }), [], { PORT: port });
    assert.equal(fromProfile.status, 1, fromProfile.stderr);
    assert.match(fromProfile.stderr, /RAgents does not start: BIND_ADDRESS needs an IPv4 or IPv6 address.*not "\[::1\]"/);

    const fromFlag = failedStart(directory, profile, ["--bind-address", "127.0.0.1:4710"], { PORT: port });
    assert.equal(fromFlag.status, 1, fromFlag.stderr);
    assert.match(fromFlag.stderr, /RAgents does not start: BIND_ADDRESS needs an IPv4 or IPv6 address.*not "127\.0\.0\.1:4710"/);

    const missing = failedStart(directory, profile, ["--bind-address"], { PORT: port });
    assert.equal(missing.status, 1, missing.stderr);
    assert.match(missing.stderr, /RAgents does not start: --bind-address needs an address/);

    const foreign = failedStart(directory, profile, [], { PORT: port, BIND_ADDRESS: "192.0.2.1" });
    assert.equal(foreign.status, 1, foreign.stderr);
    assert.match(foreign.stderr, new RegExp(`RAgents does not start: BIND_ADDRESS 192\\.0\\.2\\.1 cannot be opened on port ${port}`));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
