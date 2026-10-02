import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareAppDependencies } from "../src/plugin-support/actor-programs/app-project.js";

test("a library link of an earlier host version is relinked, a foreign folder stays an error", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ragents-relink-"));
  try {
    const workspace = path.join(root, "workspace");
    const earlier = path.join(root, "earlier-host", "react");
    await mkdir(earlier, { recursive: true });
    await mkdir(path.join(workspace, "node_modules"), { recursive: true });
    await symlink(earlier, path.join(workspace, "node_modules", "react"));
    await prepareAppDependencies(workspace);
    const relinked = path.join(workspace, "node_modules", "react");
    assert.ok((await lstat(relinked)).isSymbolicLink());
    assert.notEqual(await readlink(relinked), earlier, "the link now points to the current host's library");

    await rm(relinked);
    await mkdir(relinked);
    await assert.rejects(prepareAppDependencies(workspace), /has a different origin/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
