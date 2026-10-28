import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareGrantedWritePaths } from "../src/plugin-support/workspace-grants.ts";

test("Linux grant preparation creates only private write targets and never changes existing content", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-grant-writes-")));
  const target = path.join(root, "new", "target.txt");
  const readOnly = path.join(root, "read.txt");
  const folder = path.join(root, "folder");
  try {
    await mkdir(folder);
    await prepareGrantedWritePaths([{ path: target, access: "write" }, { path: readOnly, access: "read" }, { path: folder, access: "write" }]);
    assert.equal(await readFile(target, "utf8"), "");
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    await assert.rejects(stat(readOnly), /ENOENT/);
    assert.equal((await stat(folder)).isDirectory(), true);
    await writeFile(target, "kept");
    await prepareGrantedWritePaths([{ path: target, access: "write" }]);
    assert.equal(await readFile(target, "utf8"), "kept");
    const redirected = path.join(root, "redirected");
    await symlink(folder, redirected);
    await assert.rejects(prepareGrantedWritePaths([{ path: path.join(redirected, "file.txt"), access: "write" }]), /now resolves elsewhere/);
    await assert.rejects(stat(path.join(folder, "file.txt")), /ENOENT/);
    await assert.rejects(prepareGrantedWritePaths([{ path: path.join(root, "data", "file.txt"), access: "write" }], { dataDirectory: path.join(root, "data") }), /full access is required/);
    await assert.rejects(stat(path.join(root, "data")), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
