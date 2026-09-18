import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { syncWorkspaceOwnership } from "../src/plugin-support/workspace-ownership.ts";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";

test("private workspace files get writable owner permissions without following installed dependency symlinks", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "ragents-workspace-owner-")));
  const storageRoot = path.join(directory, "run");
  const workspace = path.join(storageRoot, "plugins/mini-apps/app-workspace");
  const source = path.join(workspace, "apps/counter/src/client.tsx");
  const sdk = path.join(workspace, "apps/counter/node_modules/@ragents/client/index.d.ts");
  const library = path.join(directory, "installed-library");
  const sibling = path.join(storageRoot, "private-journal");
  try {
    await Promise.all([path.dirname(source), path.dirname(sdk), library, sibling].map((entry) => mkdir(entry, { recursive: true })));
    await Promise.all([source, sdk, path.join(library, "index.js")].map((file) => writeFile(file, "source", { mode: 0o400 })));
    await chmod(library, 0o500);
    await chmod(sibling, 0o700);
    await chmod(path.join(storageRoot, "plugins"), 0o700);
    await symlink(library, path.join(workspace, "apps/counter/node_modules/library"));
    const identity = { uid: process.getuid!(), gid: process.getgid!(), storageRoot };
    await syncWorkspaceOwnership(workspace, identity);
    assert.equal((await stat(source)).mode & 0o777, 0o600);
    assert.equal((await stat(sdk)).mode & 0o777, 0o600);
    assert.equal((await stat(workspace)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(storageRoot, "plugins"))).mode & 0o111, 0o111);
    assert.equal((await stat(sibling)).mode & 0o777, 0o700);
    assert.equal((await stat(library)).mode & 0o777, 0o500);
    assert.equal((await stat(path.join(library, "index.js"))).mode & 0o777, 0o400);
    const generated = path.join(workspace, "apps/counter/node_modules/@ragents/client/new.d.ts");
    await writeFile(generated, "new generated", { mode: 0o400 });
    await syncWorkspaceOwnership(workspace, identity);
    assert.equal((await stat(generated)).mode & 0o777, 0o600);
    await assert.rejects(syncWorkspaceOwnership(library, identity), /Speichergrenze/);
  } finally { await chmod(library, 0o700).catch(() => undefined); await rm(directory, { recursive: true, force: true }); }
});

test("the sandbox refreshes ownership for host-generated app files before subsequent process access", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "ragents-root-owner-")));
  const storageRoot = path.join(directory, "run");
  const root = path.join(storageRoot, "workspace");
  const appWorkspace = path.join(storageRoot, "plugins/mini-apps/app-workspace");
  const apps = path.join(appWorkspace, "apps");
  await Promise.all([root, apps].map((entry) => mkdir(entry, { recursive: true })));
  const sandbox = new WorkspaceSandboxHost({
    contributorName: "test", storageRootFor: () => storageRoot,
    workspaceFor: async () => ({ cwd: root, currentRoot: async () => root, ensureWritable: async () => root, runOperation: (operation) => operation() }),
    identFor: async () => ({ uid: process.getuid!(), gid: process.getgid!(), name: "current-test-user" }),
    skillPaths: async () => [], homeFor: async () => ({ home: root }), filesFor: async () => undefined,
  });
  sandbox.registerWorkspaceRoot({ id: "apps", alias: "@apps", directoryFor: () => apps, ownershipDirectoryFor: () => appWorkspace });
  try {
    const context = await sandbox.processContextFor("run");
    assert.equal(context.storageRoot, storageRoot);
    const generated = path.join(apps, "new.ts");
    await writeFile(generated, "host generated", { mode: 0o400 });
    await sandbox.processContextFor("run");
    assert.equal((await stat(generated)).mode & 0o777, 0o600);
    await writeFile(generated, "editable");
    assert.equal(await readFile(generated, "utf8"), "editable");
  } finally { await sandbox.shutdownAll(); await rm(directory, { recursive: true, force: true }); }
});
