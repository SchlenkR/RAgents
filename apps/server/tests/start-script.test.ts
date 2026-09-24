import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { config as coreConfig } from "../../../ragents.config.core.ts";
import { config as developerConfig } from "../../../ragents.config.developer.ts";
import { config as showcaseConfig } from "../../../ragents.config.showcase.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

interface StartCall {
  args: string[];
  profile: string;
  profileFile: string;
  port: string;
  target: string;
  dataDirectory: string;
  dev?: string;
  launch?: string;
}

interface StartOptions {
  profile?: "core" | "other" | "external" | "misnamed";
  configuredPort: number;
  port?: number;
  dev?: boolean;
  selection?: string;
  dataMode?: "default" | "configured" | "override" | "unsafe" | "reference" | "missing-reference";
  webProblem?: string;
}

const probe = async (t: TestContext, options: StartOptions) => {
  const directory = await mkdtemp(path.join(process.platform === "darwin" ? "/private/tmp" : tmpdir(), "ragents-start-tests-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = path.join(directory, "project");
  const home = path.join(directory, "home");
  const configuredDataDirectory = path.join(directory, "configured-data");
  const explicitDataDirectory = path.join(directory, "explicit-data");
  await mkdir(project);
  await mkdir(home);
  const bin = path.join(project, "bin");
  const log = path.join(directory, "calls.jsonl");
  const scripts = path.join(project, "scripts");
  const server = path.join(project, "apps/server");
  await mkdir(bin);
  await mkdir(scripts);
  await mkdir(path.join(server, "src"), { recursive: true });
  await symlink(path.join(root, "apps/server/node_modules"), path.join(server, "node_modules"));
  await copyFile(path.join(root, "scripts/start.sh"), path.join(scripts, "start.sh"));
  await writeFile(path.join(project, "package.json"), '{"type":"module"}');
  await writeFile(path.join(server, "src/startup.ts"), `export * from ${JSON.stringify(new URL("../src/startup.ts", import.meta.url).href)};`);
  await writeFile(path.join(server, "src/host-resolution.ts"), `import ${JSON.stringify(new URL("../src/host-resolution.ts", import.meta.url).href)};`);
  await writeFile(path.join(server, "src/host-version.ts"), `export * from ${JSON.stringify(new URL("../src/host-version.ts", import.meta.url).href)};`);
  // Der Befund über das Web ist hier ein Stub: er schreibt seinen Aufruf wie das gefälschte pnpm mit und meldet ein veraltetes Web, wenn der Test es verlangt.
  await writeFile(path.join(server, "src/host-web.ts"), `import { appendFileSync } from "node:fs";
export const hostWebDirectory = (root) => root + "/apps/web/dist";
export const isCheckout = () => true;
export const hostWebProblem = () => {
  appendFileSync(process.env.RAGENTS_START_PROBE, JSON.stringify({ args: ["web-check"], profile: process.env.PRODUCT_PROFILE, profileFile: process.env.PRODUCT_PROFILE_FILE, port: process.env.PORT, dataDirectory: process.env.DATA_DIR }) + "\\n");
  return process.env.RAGENTS_TEST_WEB_PROBLEM || undefined;
};
`);
  const configuredData = options.dataMode === "reference" || options.dataMode === "missing-reference"
    ? { kind: "environment", name: "RAGENTS_TEST_REFERENCED_DATA" }
    : options.dataMode === "configured" || options.dataMode === "override" ? configuredDataDirectory : undefined;
  const profileSource = `export const config = { host: { PORT: ${options.configuredPort}, DATA_DIR: ${JSON.stringify(configuredData)} } };`;
  for (const profile of ["core", "other"]) {
    await writeFile(path.join(project, `ragents.config.${profile}.ts`), profileSource);
  }
  const external = path.join(directory, "elsewhere");
  await mkdir(external);
  await writeFile(path.join(external, "package.json"), '{"type":"module"}');
  await writeFile(path.join(external, "ragents.config.external.ts"), profileSource);
  await writeFile(path.join(external, "misnamed.ts"), profileSource);
  const selection = options.profile === "external" ? path.join(external, "ragents.config.external.ts")
    : options.profile === "misnamed" ? path.join(external, "misnamed.ts") : options.profile ?? "core";
  await writeFile(path.join(bin, "pnpm"), `#!/usr/bin/env node
import {appendFileSync} from "node:fs";
appendFileSync(process.env.RAGENTS_START_PROBE, JSON.stringify({args:process.argv.slice(2),profile:process.env.PRODUCT_PROFILE,profileFile:process.env.PRODUCT_PROFILE_FILE,port:process.env.PORT,target:process.env.API_TARGET,dataDirectory:process.env.DATA_DIR,dev:process.env.RAGENTS_DEV,launch:process.env.RAGENTS_LAUNCH}) + "\\n");
`, { mode: 0o700 });
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PRODUCT_PROFILE: "",
    PRODUCT_PROFILE_FILE: "",
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    HOME: home,
    DATA_DIR: options.dataMode === "unsafe" ? path.join(project, "data") : explicitDataDirectory,
    API_TARGET: "http://localhost:1",
    RAGENTS_START_PROBE: log,
    RAGENTS_TEST_WEB_PROBLEM: options.webProblem ?? "",
  };
  delete environment.RAGENTS_DEV;
  delete environment.RAGENTS_LAUNCH;
  if (options.dataMode === "default" || options.dataMode === "configured" || options.dataMode === "reference" || options.dataMode === "missing-reference") delete environment.DATA_DIR;
  if (options.dataMode === "reference") environment.RAGENTS_TEST_REFERENCED_DATA = configuredDataDirectory;
  else delete environment.RAGENTS_TEST_REFERENCED_DATA;
  if (options.port === undefined) delete environment.PORT;
  else environment.PORT = String(options.port);
  const child = spawn("bash", [path.join(scripts, "start.sh"),
    ...(options.selection ? [] : [selection]), ...(options.dev ? ["--dev"] : []),
  ], { cwd: project, detached: true, env: environment, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(options.selection ? `${options.selection}\n` : undefined);
  const stop = (): void => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
  };
  t.signal.addEventListener("abort", stop, { once: true });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    const content = await readFile(log, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    const calls = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as StartCall);
    return { ...result, output, calls, home, configuredDataDirectory, explicitDataDirectory, external };
  } finally {
    t.signal.removeEventListener("abort", stop);
    stop();
  }
};

const assertDevRouting = (result: Awaited<ReturnType<typeof probe>>, backendPort: number, webPort: number) => {
  assert.ok(result.code === 0 || result.signal === "SIGTERM", result.output);
  assert.equal(result.calls.length, 4, result.output);
  assert.deepEqual(result.calls[0]!.args, ["build:plugins"]);
  assert.ok(result.calls.some((call) => call.args.join(" ") === "build:plugins --watch"), result.output);
  const backend = result.calls.find((call) => call.args[0] === "dev:server")!;
  const frontend = result.calls.find((call) => call.args[0] === "dev:web")!;
  assert.ok(backend && frontend, result.output);
  assert.equal(backend.port, String(backendPort));
  assert.equal(frontend.target, `http://localhost:${backendPort}`);
  assert.deepEqual(backend.args, ["dev:server"]);
  assert.equal(backend.dev, "1", "der Server weiß vom Dev-Modus und prüft sein gebautes Web nicht");
  assert.equal(backend.launch, undefined);
  assert.deepEqual(frontend.args, ["dev:web", "--port", String(webPort), "--strictPort"]);
};

const listen = (server: Server, port = 0): Promise<number> => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    resolve(address.port);
  });
});

const close = (server: Server): Promise<void> => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

// Der Dev-Modus belegt Port plus 1000; ein Port oberhalb von 64535 taugt deshalb nicht.
const freePort = async (): Promise<number> => {
  for (;;) {
    const reservation = createServer();
    const port = await listen(reservation);
    await close(reservation);
    if (port + 1000 <= 65535) return port;
  }
};

test("the repository profiles declare their fixed backend ports in their configuration", () => {
  assert.equal(coreConfig.host.PORT, 4710);
  assert.equal(showcaseConfig.host.PORT, 4713);
  assert.equal(developerConfig.host.PORT, 4715);
});

test("das Profil showcase ist core samt der mitgelieferten Beispiele", () => {
  const corePlugins: readonly string[] = coreConfig.host.PLUGINS;
  const showcasePlugins: readonly string[] = showcaseConfig.host.PLUGINS;
  assert.equal(corePlugins.includes("ragents.reference"), false, "core bleibt die schlanke Vorlage ohne Lehrmaterial");
  assert.equal(showcasePlugins.includes("ragents.reference"), true);
  assert.deepEqual(showcasePlugins.filter((id) => id !== "ragents.reference"), [...corePlugins]);
});

test("normal startup reads the configured port and honors an explicit PORT", { timeout: 15_000 }, async (t) => {
  const configuredPort = await freePort();
  for (const profile of ["core", "other"] as const) {
    for (const port of [undefined, await freePort()]) {
      const result = await probe(t, { profile, configuredPort, port });
      assert.equal(result.code, 0, result.output);
      assert.deepEqual(result.calls.map(({ args, profile: actualProfile, port: actualPort }) => ({ args, profile: actualProfile, port: actualPort })), [
        { args: ["build:plugins"], profile, port: String(port ?? configuredPort) },
        { args: ["web-check"], profile, port: String(port ?? configuredPort) },
        { args: ["start"], profile, port: String(port ?? configuredPort) },
      ]);
    }
  }
});

test("a missing or stale host web is built once before the server starts, a current one is left alone", { timeout: 15_000 }, async (t) => {
  const stale = await probe(t, { configuredPort: await freePort(), webProblem: "Das Web des Hosts passt nicht mehr zu seinen Quellen" });
  assert.equal(stale.code, 0, stale.output);
  assert.deepEqual(stale.calls.map((call) => call.args.join(" ")), ["build:plugins", "web-check", "build:web", "start"]);
  assert.match(stale.output, /passt nicht mehr zu seinen Quellen; Web bauen/);
  assert.equal(stale.calls.at(-1)!.launch, "start.sh");
  assert.equal(stale.calls.at(-1)!.dev, undefined);
  const current = await probe(t, { configuredPort: await freePort() });
  assert.deepEqual(current.calls.map((call) => call.args.join(" ")), ["build:plugins", "web-check", "start"]);
});

test("occupied backend ports stop normal and dev startup before any build and preserve the existing service", { timeout: 15_000 }, async (t) => {
  const occupied = createServer();
  const port = await listen(occupied);
  t.after(() => close(occupied));
  for (const dev of [false, true]) {
    const result = await probe(t, { configuredPort: port, dev });
    assert.equal(result.code, 1, result.output);
    assert.deepEqual(result.calls, []);
    assert.match(result.output, new RegExp(`Port ${port}.*belegt`));
    assert.equal(occupied.listening, true);
  }
});

test("dev startup uses the backend port plus 1000 for Vite and routes it to the configured or explicit backend port", { timeout: 15_000 }, async (t) => {
  for (const profile of ["core", "other"] as const) {
    const configuredPort = await freePort();
    assertDevRouting(await probe(t, { profile, configuredPort, dev: true }), configuredPort, configuredPort + 1000);
    const port = await freePort();
    assertDevRouting(await probe(t, { profile, configuredPort, port, dev: true }), port, port + 1000);
  }
});

test("an occupied Vite port aborts before starting the backend or build", { timeout: 15_000 }, async (t) => {
  const configuredPort = await freePort();
  const occupied = createServer();
  await listen(occupied, configuredPort + 1000);
  t.after(() => close(occupied));
  const result = await probe(t, { configuredPort, dev: true });
  assert.equal(result.code, 1, result.output);
  assert.deepEqual(result.calls, []);
  assert.match(result.output, new RegExp(`Port ${configuredPort + 1000}.*belegt`));
  assert.equal(occupied.listening, true);
});

test("a profile file outside the repository is named by its path and keeps its name", { timeout: 15_000 }, async (t) => {
  const result = await probe(t, { profile: "external", configuredPort: await freePort() });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(result.calls.map(({ args, profile, profileFile }) => ({ args, profile, profileFile })), [
    { args: ["build:plugins"], profile: "external", profileFile: path.join(result.external, "ragents.config.external.ts") },
    { args: ["web-check"], profile: "external", profileFile: path.join(result.external, "ragents.config.external.ts") },
    { args: ["start"], profile: "external", profileFile: path.join(result.external, "ragents.config.external.ts") },
  ]);
  const misnamed = await probe(t, { profile: "misnamed", configuredPort: await freePort() });
  assert.equal(misnamed.code, 1, misnamed.output);
  assert.deepEqual(misnamed.calls, []);
  assert.match(misnamed.output, /ragents\.config\.<profil>\.ts/);
});

test("port zero is rejected before any normal or dev process starts", { timeout: 15_000 }, async (t) => {
  for (const dev of [false, true]) {
    const result = await probe(t, { configuredPort: 4710, port: 0, dev });
    assert.equal(result.code, 1, result.output);
    assert.deepEqual(result.calls, []);
    assert.match(result.output, /PORT.*1.*65535/);
  }
});

test("the start menu lists the repository profiles and accepts a name or a path", { timeout: 15_000 }, async (t) => {
  const result = await probe(t, { configuredPort: await freePort(), selection: "other" });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(result.calls.map(({ args, profile }) => ({ args, profile })), [
    { args: ["build:plugins"], profile: "other" },
    { args: ["web-check"], profile: "other" },
    { args: ["start"], profile: "other" },
  ]);
  const entries = [...result.output.matchAll(/^\s+\d+\) ([^ ]+)$/gm)];
  assert.deepEqual(entries.map((entry) => entry[1]), ["core", "other"]);
  const byPath = await probe(t, { configuredPort: await freePort(), selection: path.join(result.external, "ragents.config.external.ts") });
  assert.equal(byPath.code, 0, byPath.output);
  assert.deepEqual(byPath.calls.map(({ profile }) => profile), ["external", "external", "external"]);
  const repositoryProfiles = (await readdir(root)).filter((name) => /^ragents\.config\.(?!example\.)[^.]+\.ts$/.test(name))
    .map((name) => name.slice("ragents.config.".length, -".ts".length)).sort();
  assert.deepEqual(repositoryProfiles, ["core", "developer", "showcase"], "die Profile des öffentlichen Repos sind neutral: core die schlanke Werkstatt, developer das Programmierprofil, showcase core samt mitgelieferten Beispielen");
});

test("startup defaults to external per-profile data and preserves configured and explicit overrides", { timeout: 15_000 }, async (t) => {
  for (const dataMode of ["default", "configured", "override"] as const) {
    const result = await probe(t, { configuredPort: await freePort(), dataMode });
    assert.equal(result.code, 0, result.output);
    const expected = dataMode === "default"
      ? path.join(result.home, ".local/share/ragents/core")
      : dataMode === "configured" ? result.configuredDataDirectory : result.explicitDataDirectory;
    assert.equal(result.calls.length, 3, result.output);
    assert.ok(result.calls.every((call) => call.dataDirectory === expected), result.output);
  }
});

test("runtime data inside a project aborts normal and dev startup before any build", { timeout: 15_000 }, async (t) => {
  for (const dev of [false, true]) {
    const result = await probe(t, { configuredPort: await freePort(), dev, dataMode: "unsafe" });
    assert.equal(result.code, 1, result.output);
    assert.deepEqual(result.calls, []);
    assert.match(result.output, /DATA_DIR|Datenverzeichnis|Laufzeitdaten/);
    assert.match(result.output, /package\.json/);
  }
});

test("startup resolves a profile DATA_DIR environment reference", { timeout: 15_000 }, async (t) => {
  const result = await probe(t, { configuredPort: await freePort(), dataMode: "reference" });
  assert.equal(result.code, 0, result.output);
  assert.equal(result.calls.length, 3, result.output);
  assert.ok(result.calls.every((call) => call.dataDirectory === result.configuredDataDirectory), result.output);
});

test("a missing profile DATA_DIR environment reference aborts before any build", { timeout: 15_000 }, async (t) => {
  const result = await probe(t, { configuredPort: await freePort(), dataMode: "missing-reference" });
  assert.equal(result.code, 1, result.output);
  assert.deepEqual(result.calls, []);
  assert.match(result.output, /host\.DATA_DIR.*nicht gesetzte Umgebungsvariable RAGENTS_TEST_REFERENCED_DATA/);
});
