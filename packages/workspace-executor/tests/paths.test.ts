import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { allowedWorkspacePath, resolvedWorkspacePath } from "../src/paths.ts";

test("workspace paths resolve linked ancestors with spaces for existing and future files", async (t) => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-paths-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const target = path.join(base, "real folder with spaces");
  const alias = path.join(base, "folder-link");
  await mkdir(target);
  await symlink(target, alias, "junction");
  await writeFile(path.join(target, "existing.txt"), "existing");
  for (const relative of ["existing.txt", "new/folder/file.txt"]) {
    assert.equal(await resolvedWorkspacePath(path.join(alias, relative)), path.join(target, relative));
    assert.equal(await allowedWorkspacePath(path.join(target, relative), [alias]), path.join(target, relative));
    assert.equal(await allowedWorkspacePath(path.join(alias, relative), [target]), path.join(target, relative));
  }
  await assert.rejects(allowedWorkspacePath(path.join(base, "outside.txt"), [alias]), /outside the working directory/);
});

test("workspace path resolution rejects dangling and cyclic symlinks instead of retaining their names", { skip: process.platform === "win32" }, async (t) => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-invalid-paths-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const broken = path.join(base, "broken");
  const loop = path.join(base, "loop");
  await symlink(path.join(base, "missing"), broken);
  await symlink(loop, loop);
  await assert.rejects(resolvedWorkspacePath(path.join(broken, "file.txt")), /outside the working directory/);
  await assert.rejects(resolvedWorkspacePath(path.join(loop, "file.txt")), /ELOOP/);
});
