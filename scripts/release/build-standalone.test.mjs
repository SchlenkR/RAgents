import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { archiveName, launcher, nodeRuntime, verifyHash } from "./build-standalone.mjs";

test("release assets and pinned runtimes cover the same six native targets", () => {
  for (const target of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]) {
    assert.match(nodeRuntime.sha256[target], /^[0-9a-f]{64}$/);
    assert.equal(archiveName("1.2.3", target), `ragents-1.2.3-${target}.${target.startsWith("win32-") ? "zip" : "tar.gz"}`);
  }
  assert.throws(() => archiveName("../../bad", "linux-x64"), /Invalid release version/);
  assert.throws(() => archiveName("1.2.3", "linux-ia32"), /Unsupported platform/);
});

test("a corrupt runtime is rejected before it can be unpacked or executed", () => {
  const content = Buffer.from("runtime");
  const hash = createHash("sha256").update(content).digest("hex");
  verifyHash(content, hash, "node.tar.gz");
  assert.throws(() => verifyHash(Buffer.from("other"), hash, "node.tar.gz"), /SHA-256 mismatch/);
});

test("the launcher uses its bundled Node and preserves arguments and the caller's directory", async (t) => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), "ragents launcher ")));
  t.after(() => rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const windows = process.platform === "win32";
  const directory = path.join(temporary, "bundle with spaces");
  const runtime = path.join(directory, "runtime", ...(windows ? [] : ["bin"]));
  await mkdir(runtime, { recursive: true });
  const node = path.join(runtime, windows ? "node.exe" : "node");
  await copyFile(process.execPath, node);
  const app = path.join(directory, "app/scripts/package");
  await mkdir(app, { recursive: true });
  await writeFile(path.join(app, "ragents.mjs"), 'console.log(JSON.stringify({ node: process.execPath, args: process.argv.slice(2), cwd: process.cwd(), path: process.env.PATH }));\n');
  await mkdir(path.join(directory, "bin"));
  const command = path.join(directory, "bin", windows ? "ragents.cmd" : "ragents");
  await writeFile(command, launcher(windows));
  if (!windows) await chmod(command, 0o755);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["path", "node_path", "node_options"].includes(key.toLowerCase())));
  env.PATH = windows ? path.join(process.env.SystemRoot, "System32") : "/usr/bin:/bin";
  const result = windows
    ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `""${command}" run "project folder" "task with spaces""`], { cwd: temporary, env, encoding: "utf8", windowsVerbatimArguments: true })
    : spawnSync(command, ["run", "project folder", "task with spaces"], { cwd: temporary, env, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stderr}`);
  const actual = JSON.parse(result.stdout);
  assert.equal(actual.node, node);
  assert.deepEqual(actual.args, ["run", "project folder", "task with spaces"]);
  assert.equal(actual.cwd, temporary);
  assert.equal(path.resolve(actual.path.split(path.delimiter)[0]), runtime);
  assert.equal(await readFile(command, "utf8"), launcher(windows));
});
