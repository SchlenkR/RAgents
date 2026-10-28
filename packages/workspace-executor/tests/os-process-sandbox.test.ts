import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { ruleAllowsPath, type WorkspaceAccessRule } from "../src/access-rule.js";
import { prepareGrantedWritePaths } from "../src/granted-write-paths.js";
import { checkProcessSandboxDependencies, createUnrestrictedNetworkSandbox } from "../src/os-process-sandbox.js";

const execute = promisify(execFile);
const supported = process.platform === "darwin" || process.platform === "linux";

test("missing process sandbox prerequisites name the installation and the full access remedy", () => {
  assert.throws(() => checkProcessSandboxDependencies("linux", "Switch the run to Full access.", () => ({ errors: ["bubblewrap not installed", "socat not installed", "ripgrep not installed"] })),
    (error: unknown) => error instanceof Error && /apt-get install bubblewrap socat ripgrep/.test(error.message)
      && /Full access/.test(error.message) && /bubblewrap not installed/.test(error.message));
  assert.throws(() => checkProcessSandboxDependencies("freebsd", "Switch the run to Full access.", () => ({ errors: [] })), /macOS and Linux are supported.*Full access/);
});

test("the shared OS sandbox follows the access rule and reaches loopback without a proxy", {
  skip: supported ? false : "The OS process sandbox requires macOS or Linux.",
  timeout: 60_000,
}, async () => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-shared-sandbox-")));
  const root = path.join(base, "run");
  const temporary = path.join(root, "tmp");
  const readonly = path.join(root, "skills");
  const denied = path.join(base, "private.txt");
  const granted = path.join(base, "granted.txt");
  const missingGrant = path.join(base, "missing.txt");
  await Promise.all([temporary, readonly].map((directory) => mkdir(directory, { recursive: true })));
  await Promise.all([writeFile(denied, "private"), writeFile(granted, "grant"), writeFile(path.join(readonly, "example.md"), "skill")]);
  const server = createServer((_request, response) => response.end("loopback-ok"));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const rule: WorkspaceAccessRule = {
    blocked: [base],
    readable: [],
    writable: [root],
    readOnly: [readonly],
    grants: [{ path: granted, access: "read" }, { path: missingGrant, access: "write" }],
  };
  const sandbox = createUnrestrictedNetworkSandbox({ rule, temporary,
    ...process.platform === "linux" ? { validate: () => prepareGrantedWritePaths(rule.grants ?? []) } : {},
  });
  const run = async (source: string): Promise<unknown> => {
    const launch = await sandbox.wrap({ command: process.execPath, args: ["-e", source] });
    const result = await execute(launch.command, [...launch.args], { cwd: root, env: { PATH: process.env.PATH, HOME: root }, timeout: 30_000 });
    return JSON.parse(result.stdout);
  };
  try {
    const filenames = ["/etc/hosts", denied, granted, path.join(readonly, "example.md")];
    const result = await run(`const fs = require('node:fs');
const paths = ${JSON.stringify(filenames)};
console.log(JSON.stringify(paths.map((filename) => { try { fs.readFileSync(filename); return true; } catch { return false; } })));`);
    assert.deepEqual(result, filenames.map((filename) => ruleAllowsPath(rule, filename, "read")));
    const destinations = [path.join(root, "output.txt"), path.join(base, "outside.txt"), path.join(readonly, "output.txt")];
    const written = await run(`const fs = require('node:fs');
const paths = ${JSON.stringify(destinations)};
console.log(JSON.stringify(paths.map((filename) => { try { fs.writeFileSync(filename, 'output'); return true; } catch { return false; } })));`);
    assert.deepEqual(written, destinations.map((filename) => ruleAllowsPath(rule, filename, "write")));
    assert.equal(await readFile(destinations[0]!, "utf8"), "output");
    assert.equal(await run(`fetch('http://127.0.0.1:${address.port}').then((response) => response.text()).then((text) => console.log(JSON.stringify(text)));`), "loopback-ok");
    if (process.platform === "darwin") {
      const cloneTargets = [[granted, path.join(root, "clone.txt")], [denied, path.join(root, "private-clone.txt")], [granted, path.join(base, "outside-clone.txt")]];
      assert.deepEqual(await run(`const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
console.log(JSON.stringify(${JSON.stringify(cloneTargets)}.map(([source, destination]) => {
  try { execFileSync('/bin/cp', ['-c', source, destination], { stdio: 'pipe' }); return true; } catch { return false; }
})));`), [true, false, false]);
      assert.equal(await readFile(path.join(root, "clone.txt"), "utf8"), "grant");
      assert.equal(await run(`const fs = require('node:fs');
try { fs.mkdirSync(${JSON.stringify(missingGrant)}); fs.writeFileSync(${JSON.stringify(path.join(missingGrant, "child.txt"))}, 'outside'); console.log('true'); }
catch { console.log('false'); }`), false);
    }
  } finally {
    await sandbox.cleanup?.();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(base, { recursive: true, force: true });
  }
});


test("a short process temp alias keeps its target pinned and cannot expose another directory", {
  skip: process.platform === "darwin" ? false : "Seatbelt directory alias checks require macOS",
  timeout: 30_000,
}, async () => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-temp-alias-")));
  const temporary = path.join(base, "own");
  const protectedDirectory = path.join(base, "private");
  const aliasDirectory = await realpath(await mkdtemp("/tmp/ragents-alias-"));
  const alias = path.join(aliasDirectory, "tmp");
  await mkdir(temporary);
  await mkdir(protectedDirectory);
  await writeFile(path.join(protectedDirectory, "secret"), "private");
  await symlink(temporary, alias, "dir");
  const rule: WorkspaceAccessRule = { blocked: [base, "/private/tmp"], readable: [], writable: [temporary] };
  const sandbox = createUnrestrictedNetworkSandbox({ rule, temporary });
  try {
    const launch = await sandbox.wrap({ command: process.execPath, directoryAliases: [{ path: alias, target: temporary }], args: ["-e", `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(alias)} + '/written', 'own');
const unlink = (() => { try { fs.unlinkSync(${JSON.stringify(alias)}); return 'removed'; } catch (error) { return error.code; } })();
const rename = (() => { try { fs.renameSync(${JSON.stringify(alias)}, ${JSON.stringify(alias)} + '-moved'); return 'moved'; } catch (error) { return error.code; } })();
const retarget = (() => { try { fs.symlinkSync(${JSON.stringify(protectedDirectory)}, ${JSON.stringify(alias)}); return 'changed'; } catch (error) { return error.code; } })();
const secret = (() => { try { return fs.readFileSync(${JSON.stringify(alias)} + '/secret', 'utf8'); } catch (error) { return error.code; } })();
console.log(JSON.stringify({ unlink, rename, retarget, secret }));
`] });
    const result = await execute(launch.command, [...launch.args], { env: { PATH: process.env.PATH } });
    const values = JSON.parse(result.stdout) as Record<string, string>;
    assert.match(values.unlink, /EPERM|EACCES/);
    assert.match(values.rename, /EPERM|EACCES/);
    assert.notEqual(values.retarget, "changed");
    assert.notEqual(values.secret, "private");
    assert.equal(await readFile(path.join(temporary, "written"), "utf8"), "own");
    assert.equal(await realpath(alias), temporary);
    await assert.rejects(sandbox.wrap({ command: "true", args: [], directoryAliases: [{ path: alias, target: protectedDirectory }] }), /fixed permitted target/);
    const writableAlias = path.join(temporary, "alias");
    await symlink(temporary, writableAlias, "dir");
    await assert.rejects(sandbox.wrap({ command: "true", args: [], directoryAliases: [{ path: writableAlias, target: temporary }] }), /fixed permitted target/);
    const editorHost = createUnrestrictedNetworkSandbox({ rule: { ...rule, writeProtected: [{ root: "/", names: [".git/hooks"] }] }, temporary });
    await editorHost.wrap({ command: "true", args: [], directoryAliases: [{ path: alias, target: temporary }] });
  } finally {
    await sandbox.cleanup?.();
    await rm(aliasDirectory, { recursive: true, force: true });
    await rm(base, { recursive: true, force: true });
  }
});
