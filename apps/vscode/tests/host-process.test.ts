import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readPackageVersion } from "../../server/src/host-version";
import { missingEnvironmentNotice, missingEnvironmentOf } from "../../server/src/missing-environment";
import { bundledBash, bundledRipgrep, ensureHostPackage, findExecutable, HOST_PACKAGE_NAME, hostPackageFolder, hostPackageSpecifier, inheritedEnvironment, installHostPackage, packagedHostVersion, startHost } from "../src/host-process";
import { packageManagerInvocation } from "../../../scripts/package/package-manager.ts";

test("Windows installs npm and server tarballs with spaces as literal Node arguments", () => {
  const npm = "C:\\Program Files\\nodejs\\npm.cmd";
  const cli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
  const node = "C:\\Program Files\\nodejs\\node.exe";
  const folder = "C:\\Users\\Demo User\\AppData\\Local\\ragents\\hosts\\0.1.40-local.abc";
  for (const specifier of ["@schlenkr/ragents@0.1.40", `${folder}\\host.tgz`]) {
    const args = ["install", "--prefix", folder, specifier];
    assert.deepEqual(packageManagerInvocation("npm", args, { platform: "win32", node, npmExecpath: "", locations: () => [npm], exists: (file) => file === cli }),
      { command: node, args: [cli, ...args] });
  }
});

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

/** stderr and stdout are separate pipes; a stderr line may arrive after the announcement on stdout. */
const logged = async (lines: readonly string[], line: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (!lines.includes(line)) {
    if (Date.now() > deadline) throw new Error(`The host did not log "${line}": ${lines.join(" | ")}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test("the host is started with profile and data folder, the announcement is read, and the process is ended on disconnect", async (t) => {
  const lines: string[] = [];
  const host = await startHost({
    profile: "test", profileFile: "/x/ragents.config.test.ts", dataDirectory: "/tmp/data", environment: { ...process.env },
    log: (line) => lines.push(line), command: fakeHost(announcing), bash: undefined, rg: undefined,
  });
  t.after(() => host.stop());
  assert.equal(host.url, "http://127.0.0.1:43210");
  assert.equal(host.token, "t0ken");
  await logged(lines, "Configuration loaded");
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

test("the host knows the process id of the extension and therefore does not outlive it", async (t) => {
  const lines: string[] = [];
  const host = await startHost({
    profile: "test", profileFile: "/x/ragents.config.test.ts", dataDirectory: "/tmp/data", environment: { ...process.env },
    log: (line) => lines.push(line), command: fakeHost(announcingParent), bash: "C:/tools/ragents/usr/bin/bash.exe",
    rg: "C:/tools/ragents/rg/rg.exe",
  });
  t.after(() => host.stop());
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
  if (process.platform === "win32") {
    const cli = path.join(directory, "node_modules", "npm", "bin", "npm-cli.js");
    mkdirSync(path.dirname(cli), { recursive: true });
    writeFileSync(cli, body);
    writeFileSync(path.join(directory, "npm.cmd"), "");
  }
  return {
    directory,
    environment: { PATH: process.platform === "win32" ? `${directory}${path.delimiter}${path.dirname(process.execPath)}` : directory, RAGENTS_FAKE_NPM_CALLS: calls },
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
writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@schlenkr/ragents", version: path.basename(prefix) }));
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

test("concurrent requests for one host version share the installation", async () => {
  const npm = fakeNpm(installing);
  const storage = mkdtempSync(path.join(tmpdir(), "ragents-storage-"));
  const roots = await Promise.all([
    ensureHostPackage(storage, "0.1.0", npm.environment, () => undefined),
    ensureHostPackage(storage, "0.1.0", npm.environment, () => undefined),
  ]);
  assert.equal(roots[0], roots[1]);
  assert.equal(npm.calls().length, 1);
});

test("a fetched or cached package with the wrong version is refused", async () => {
  const npm = fakeNpm(installing.replace("version: path.basename(prefix)", 'version: "0.0.1"'));
  const storage = mkdtempSync(path.join(tmpdir(), "ragents-storage-"));
  await assert.rejects(ensureHostPackage(storage, "0.1.0", npm.environment, () => undefined), /version 0\.0\.1, the server requires 0\.1\.0/);
  await assert.rejects(ensureHostPackage(storage, "0.1.0", { PATH: "" }, () => undefined), /version 0\.0\.1, the server requires 0\.1\.0/);
  assert.equal(npm.calls().length, 1);
  await assert.rejects(ensureHostPackage(storage, "../other", npm.environment, () => undefined), /not an exact npm version/);
});

const archive = Buffer.from("the exact host package archive");
const archiveIntegrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
const download = { path: "/api/host-package", integrity: archiveIntegrity };

const installingServerArchive = installing.replace('const root = path.join(prefix, "node_modules", "@schlenkr", "ragents");', `
const { existsSync, readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
if (process.argv.at(-1).startsWith("@schlenkr/ragents@")) {
  writeFileSync(path.join(prefix, "partial-install"), "incomplete");
  console.error("npm ERR! E404 unpublished host version");
  process.exit(1);
}
if (existsSync(path.join(prefix, "partial-install"))) throw new Error("the partial npm installation was retained");
const integrity = "sha512-" + createHash("sha512").update(readFileSync(process.argv.at(-1))).digest("base64");
if (integrity !== process.env.RAGENTS_FAKE_ARCHIVE_INTEGRITY) throw new Error("npm received different archive bytes");
const root = path.join(prefix, "node_modules", "@schlenkr", "ragents");`);

test("a published workstation host is installed from npm without downloading the server archive", async (t) => {
  const npm = fakeNpm(installing);
  const storage = mkdtempSync(path.join(tmpdir(), "ragents-storage-"));
  t.after(() => { rmSync(npm.directory, { recursive: true, force: true }); rmSync(storage, { recursive: true, force: true }); });
  const fetch = t.mock.fn(async () => { throw new Error("the server archive must not be requested"); });
  const root = await ensureHostPackage(storage, "0.1.40", npm.environment, () => undefined, { download, fetch });
  assert.equal(readPackageVersion(root), "0.1.40");
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(npm.calls(), [`install --prefix ${hostPackageFolder(storage, "0.1.40")} @schlenkr/ragents@0.1.40`]);
});

test("an unpublished workstation host uses the verified server archive after npm fails and reuses the installed cache", async (t) => {
  const npm = fakeNpm(installingServerArchive);
  const storage = mkdtempSync(path.join(tmpdir(), "ragents-storage-"));
  t.after(() => { rmSync(npm.directory, { recursive: true, force: true }); rmSync(storage, { recursive: true, force: true }); });
  const version = "0.1.40-local.abcdef";
  const folder = hostPackageFolder(storage, version);
  const fetch = t.mock.fn(async (_path: string, _init?: RequestInit) => new Response(archive));
  const environment = { ...npm.environment, RAGENTS_FAKE_ARCHIVE_INTEGRITY: archiveIntegrity };
  const root = await ensureHostPackage(storage, version, environment, () => undefined, { download, fetch });
  assert.equal(readPackageVersion(root), version);
  assert.deepEqual(npm.calls(), [
    `install --prefix ${folder} @schlenkr/ragents@${version}`,
    `install --prefix ${folder} ${path.join(folder, "host.tgz")}`,
  ]);
  assert.deepEqual(fetch.mock.calls[0]?.arguments, ["/api/host-package", { redirect: "error" }]);
  assert.equal(existsSync(path.join(folder, "host.tgz")), false);
  assert.equal(existsSync(path.join(folder, "partial-install")), false);
  assert.equal(await ensureHostPackage(storage, version, { PATH: "" }, () => undefined, { download, fetch }), root);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(npm.calls().length, 2);
});

test("an archive integrity mismatch prevents a tarball installation and removes the failed version cache", async (t) => {
  const npm = fakeNpm(installingServerArchive);
  const storage = mkdtempSync(path.join(tmpdir(), "ragents-storage-"));
  t.after(() => { rmSync(npm.directory, { recursive: true, force: true }); rmSync(storage, { recursive: true, force: true }); });
  const version = "0.1.40-local.abcdef";
  const fetch = t.mock.fn(async () => new Response("a modified archive"));
  await assert.rejects(ensureHostPackage(storage, version, npm.environment, () => undefined, { download, fetch }),
    /npm failed:.*E404 unpublished host version.*Server download failed:.*integrity does not match/s);
  assert.equal(npm.calls().length, 1);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(existsSync(hostPackageFolder(storage, version)), false);
});

test("when neither source supplies the workstation host the error names npm and the absent server download", async (t) => {
  const npm = fakeNpm(installingServerArchive);
  const storage = mkdtempSync(path.join(tmpdir(), "ragents-storage-"));
  t.after(() => { rmSync(npm.directory, { recursive: true, force: true }); rmSync(storage, { recursive: true, force: true }); });
  const version = "0.1.40-local.abcdef";
  const fetch = t.mock.fn(async () => { throw new Error("no download was advertised"); });
  await assert.rejects(ensureHostPackage(storage, version, npm.environment, () => undefined, { download: null, fetch }),
    /Host 0\.1\.40-local\.abcdef is unavailable: npm failed:.*E404 unpublished host version.*The server offers no host package download/s);
  assert.equal(npm.calls().length, 1);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(existsSync(hostPackageFolder(storage, version)), false);
});

test("a refused server archive download reports its HTTP cause and leaves no version cache", async (t) => {
  const npm = fakeNpm(installingServerArchive);
  const storage = mkdtempSync(path.join(tmpdir(), "ragents-storage-"));
  t.after(() => { rmSync(npm.directory, { recursive: true, force: true }); rmSync(storage, { recursive: true, force: true }); });
  const version = "0.1.40-local.abcdef";
  const fetch = t.mock.fn(async () => new Response("workstation registration denied", { status: 403 }));
  await assert.rejects(ensureHostPackage(storage, version, npm.environment, () => undefined, { download, fetch }),
    /npm failed:.*E404 unpublished host version.*Server download failed:.*HTTP 403 workstation registration denied/s);
  assert.equal(npm.calls().length, 1);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(existsSync(hostPackageFolder(storage, version)), false);
});
