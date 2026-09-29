import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readPackageVersion } from "../../server/src/host-version";
import { missingEnvironmentNotice, missingEnvironmentOf } from "../../server/src/missing-environment";
import { bundledBash, bundledRipgrep, ensureHostPackage, findExecutable, HOST_PACKAGE_NAME, hostPackageFolder, hostPackageSpecifier, inheritedEnvironment, installHostPackage, packagedHostVersion, startHost } from "../src/host-process";

const fakeHost = (body: string): { file: string; args: string[]; cwd: string } => {
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-fake-host-"));
  const script = path.join(directory, "host.mjs");
  writeFileSync(script, body);
  return { file: process.execPath, args: [script], cwd: directory };
};

const announcing = `
process.stderr.write("Configuration loaded\\n");
console.log("Profile " + process.env.PRODUCT_PROFILE + " from " + process.env.PRODUCT_PROFILE_FILE + " with data " + process.env.DATA_DIR);
console.log(JSON.stringify({ ragents: { url: "http://127.0.0.1:43210", token: "t0ken", pid: process.pid } }));
process.on("SIGTERM", () => { console.log("ended"); process.exit(0); });
setInterval(() => {}, 1000);
`;

test("the host is started with profile and data folder, the announcement is read, and the process is ended on disconnect", async () => {
  const lines: string[] = [];
  const host = await startHost({
    profile: "test", profileFile: "/x/ragents.config.test.ts", dataDirectory: "/tmp/data", environment: { ...process.env },
    log: (line) => lines.push(line), command: fakeHost(announcing), bash: undefined, rg: undefined,
  });
  assert.equal(host.url, "http://127.0.0.1:43210");
  assert.equal(host.token, "t0ken");
  assert.ok(lines.includes("Configuration loaded"));
  assert.ok(lines.includes("Profile test from /x/ragents.config.test.ts with data /tmp/data"));
  await host.stop();
  assert.equal(await host.exited, 0);
  await host.stop();
});

const announcingParent = `
console.log("Parent process " + process.env.RAGENTS_PARENT_PID);
console.log("Bash " + process.env.RAGENTS_BASH);
console.log("rg " + process.env.RAGENTS_RG);
console.log(JSON.stringify({ ragents: { url: "http://127.0.0.1:43211", token: null, pid: process.pid } }));
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
`;

test("the host knows the process id of the extension and therefore does not outlive it", async () => {
  const lines: string[] = [];
  const host = await startHost({
    profile: "test", profileFile: "/x/ragents.config.test.ts", dataDirectory: "/tmp/data", environment: { ...process.env },
    log: (line) => lines.push(line), command: fakeHost(announcingParent), bash: "C:/tools/ragents/usr/bin/bash.exe",
    rg: "C:/tools/ragents/rg/rg.exe",
  });
  assert.ok(lines.includes(`Parent process ${process.pid}`), lines.join("\n"));
  assert.ok(lines.includes("Bash C:/tools/ragents/usr/bin/bash.exe"), lines.join("\n"));
  assert.ok(lines.includes("rg C:/tools/ragents/rg/rg.exe"), lines.join("\n"));
  await host.stop();
  assert.equal(await host.exited, 0);
});

test("a host that ends before the announcement or stays silent is a named error with its last lines", async () => {
  await assert.rejects(startHost({
    profile: "test", profileFile: "/x", dataDirectory: "/tmp", environment: { ...process.env }, log: () => undefined,
    command: fakeHost(`console.error("RAgents does not start: port in use"); process.exit(1);`), bash: undefined, rg: undefined,
  }), /ended before its announcement with code 1[\s\S]*port in use/);
  await assert.rejects(startHost({
    profile: "test", profileFile: "/x", dataDirectory: "/tmp", environment: { ...process.env }, log: () => undefined,
    command: fakeHost(`setInterval(() => {}, 1000);`), startTimeoutMs: 300, bash: undefined, rg: undefined,
  }), /did not announce itself/);
  await assert.rejects(startHost({
    profile: "test", profileFile: "/x", dataDirectory: "/tmp", environment: { ...process.env }, log: () => undefined,
    command: { file: "/nowhere/node", args: [], cwd: tmpdir() }, bash: undefined, rg: undefined,
  }), /could not be started/);
});

test("if the host fails on an environment variable, its error carries its name, not just the sentence", async () => {
  const lines: string[] = [];
  const missing = { variable: "SERVICE_TOKEN", section: "ragents.example", key: "SERVICE_KEY" };
  const sentence = `RAgents does not start: ragents.config.test.ts: ${missing.section}.${missing.key} refers with env("${missing.variable}") to an unset environment variable.`;
  const command = fakeHost(`
console.error(${JSON.stringify(sentence)});
console.error(${JSON.stringify(missingEnvironmentNotice(missing))});
process.exit(1);
`);
  const cause = await startHost({
    profile: "test", profileFile: "/x", dataDirectory: "/tmp", environment: { ...process.env }, log: (line) => lines.push(line), command, bash: undefined, rg: undefined,
  }).then(() => undefined, (error: unknown) => error);
  assert.deepEqual(missingEnvironmentOf(cause), missing, `not a named error: ${String(cause)}`);
  assert.match((cause as Error).message, /ended before its announcement with code 1[\s\S]*SERVICE_TOKEN/);
  assert.ok(!lines.some((line) => line.startsWith("ragents:missing-environment")), "the log line does not appear in the output channel");
});

test("the Windows build brings its bash under dist/bash/<platform>, other platforms use the system one", () => {
  assert.equal(bundledBash("/ext", "win32", "x64"), path.join("/ext", "dist", "bash", "win32-x64", "usr", "bin", "bash.exe"));
  assert.equal(bundledBash("/ext", "win32", "arm64"), path.join("/ext", "dist", "bash", "win32-arm64", "usr", "bin", "bash.exe"));
  assert.equal(bundledBash("/ext", "darwin", "arm64"), undefined);
  assert.equal(bundledBash("/ext", "linux", "x64"), undefined);
});

test("the build of a platform brings its rg under dist/rg/<platform>, the universal one none", () => {
  const extension = mkdtempSync(path.join(tmpdir(), "ragents-extension-"));
  for (const [target, file] of [["darwin-arm64", "rg"], ["win32-x64", "rg.exe"]] as const) {
    mkdirSync(path.join(extension, "dist", "rg", target), { recursive: true });
    writeFileSync(path.join(extension, "dist", "rg", target, file), "");
  }
  assert.equal(bundledRipgrep(extension, "darwin", "arm64"), path.join(extension, "dist", "rg", "darwin-arm64", "rg"));
  assert.equal(bundledRipgrep(extension, "win32", "x64"), path.join(extension, "dist", "rg", "win32-x64", "rg.exe"));
  assert.equal(bundledRipgrep(extension, "linux", "x64"), undefined, "the universal build carries no rg");
  assert.equal(bundledRipgrep(extension, "win32", "arm64"), undefined);
});

test("the inherited environment omits only the variables of the surrounding VS Code", () => {
  const saved = { ...process.env };
  process.env.VSCODE_PID = "1";
  process.env.ELECTRON_RUN_AS_NODE = "1";
  process.env.BASH_ENV = "/home/user/.bashrc";
  try {
    const environment = inheritedEnvironment();
    assert.equal(environment.VSCODE_PID, undefined);
    assert.equal(environment.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(environment.BASH_ENV, "/home/user/.bashrc");
    assert.equal(environment.PATH, process.env.PATH);
  } finally {
    for (const name of ["VSCODE_PID", "ELECTRON_RUN_AS_NODE", "BASH_ENV"]) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test("findExecutable searches the PATH", () => {
  assert.equal(findExecutable("node", { PATH: path.dirname(process.execPath) }), process.execPath);
  assert.equal(findExecutable("does-not-exist", { PATH: path.dirname(process.execPath) }), undefined);
});

/** An npm that records the calls and leaves the host behind the way a real installation would. */
const fakeNpm = (body: string): { directory: string; environment: NodeJS.ProcessEnv; calls: () => string[] } => {
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-fake-npm-"));
  const calls = path.join(directory, "calls.txt");
  writeFileSync(path.join(directory, "npm"), `#!${process.execPath}\n${body}`, { mode: 0o755 });
  return {
    directory,
    environment: { PATH: directory, RAGENTS_FAKE_NPM_CALLS: calls },
    calls: () => existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter(Boolean) : [],
  };
};

const installing = `
const { appendFileSync, mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
appendFileSync(process.env.RAGENTS_FAKE_NPM_CALLS, process.argv.slice(2).join(" ") + "\\n");
const prefix = process.argv[process.argv.indexOf("--prefix") + 1];
const root = path.join(prefix, "node_modules", "@schlenkr", "ragents");
mkdirSync(path.join(root, "apps", "server", "src"), { recursive: true });
writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@schlenkr/ragents", version: "0.1.0" }));
writeFileSync(path.join(root, "apps", "server", "src", "main.ts"), "");
console.log("added 1 package");
`;

test("the extension fetches the host as an npm package exactly once per version into its storage", async () => {
  const npm = fakeNpm(installing);
  const storage = mkdtempSync(path.join(tmpdir(), "ragents-storage-"));
  const lines: string[] = [];
  const root = await ensureHostPackage(storage, "0.1.0", npm.environment, (line) => lines.push(line));
  assert.equal(root, path.join(hostPackageFolder(storage, "0.1.0"), "node_modules", "@schlenkr", "ragents"));
  assert.deepEqual(npm.calls(), [`install --prefix ${hostPackageFolder(storage, "0.1.0")} ${HOST_PACKAGE_NAME}@0.1.0`]);
  assert.ok(lines.some((line) => line.includes(`${HOST_PACKAGE_NAME}@0.1.0`)));
  assert.ok(lines.includes("added 1 package"), "the npm output appears in the channel");
  assert.equal(await ensureHostPackage(storage, "0.1.0", npm.environment, () => undefined), root);
  assert.equal(npm.calls().length, 1, "a fetched version stays");
  await ensureHostPackage(storage, "0.2.0", npm.environment, () => undefined);
  assert.equal(npm.calls().length, 2, "each version gets its own folder");
});

test("a local profile fetches the version that is in the package.json of the extension", () => {
  assert.equal(packagedHostVersion(path.resolve(import.meta.dirname, "..")), readPackageVersion(path.resolve(import.meta.dirname, "../../..")),
    "extension and host package belong together");
  const empty = mkdtempSync(path.join(tmpdir(), "ragents-manifest-"));
  writeFileSync(path.join(empty, "package.json"), JSON.stringify({ name: "ragents-vscode" }));
  assert.throws(() => packagedHostVersion(empty), /ragents\.packageVersion names the version of @schlenkr\/ragents/);
});

test("for a test, a local .tgz takes the place of the published package", async () => {
  assert.equal(hostPackageSpecifier("0.1.2", {}), `${HOST_PACKAGE_NAME}@0.1.2`);
  assert.equal(hostPackageSpecifier("0.1.2", { RAGENTS_HOST_PACKAGE_SPEC: "  /tmp/ragents.tgz  " }), "/tmp/ragents.tgz");
  const npm = fakeNpm(installing);
  const storage = mkdtempSync(path.join(tmpdir(), "ragents-storage-"));
  const lines: string[] = [];
  await ensureHostPackage(storage, "0.1.2", { ...npm.environment, RAGENTS_HOST_PACKAGE_SPEC: "/tmp/ragents.tgz" }, (line) => lines.push(line));
  assert.deepEqual(npm.calls(), [`install --prefix ${hostPackageFolder(storage, "0.1.2")} /tmp/ragents.tgz`]);
  assert.ok(lines.some((line) => line.includes("/tmp/ragents.tgz")));
});

test("without npm and without a host in the result, fetching is a named error", async () => {
  const storage = mkdtempSync(path.join(tmpdir(), "ragents-storage-"));
  await assert.rejects(() => ensureHostPackage(storage, "0.1.0", { PATH: "" }, () => undefined), /npm was not found in the PATH.*ragents\.hostPath/s);
  const empty = fakeNpm(`
require("node:fs").appendFileSync(process.env.RAGENTS_FAKE_NPM_CALLS, "empty\\n");
`);
  await assert.rejects(() => installHostPackage(path.join(storage, "empty"), "anything.tgz", empty.environment, () => undefined), /anything\.tgz did not leave a RAgents host/);
});
