import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PROCESS_RESOURCE_PATHS, ruleAllowsPath } from "../src/access-rule.js";
import { createSandboxTools } from "../src/sandbox-tools.js";
import { workspaceProcessContext } from "../src/context.js";
import { assertNarrowWorkspaceGrant } from "../src/grants.js";
import { prepareWorkstationFolders, workstationAccessRule } from "../src/workstation-rule.js";

test("workstation rules preserve nested data blocks, offered reads, exact grants and writable roots", async (t) => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-workstation-rule-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = path.join(base, "home");
  const root = path.join(home, "project");
  const offered = path.join(home, "reference");
  const data = path.join(offered, "data");
  const storage = path.join(data, "run-storage", "own");
  const grant = path.join(home, "grant.txt");
  await Promise.all([root, offered].map((entry) => mkdir(entry, { recursive: true })));
  await writeFile(grant, "grant");
  await writeFile(path.join(offered, "note.txt"), "reference");
  const folders = await prepareWorkstationFolders(storage);
  const rule = await workstationAccessRule({ root, offered: [root, offered], storage, data: [data], home, temporary: base, grants: [{ path: grant, access: "write" }], environment: {} });
  assert.equal(ruleAllowsPath(rule, path.join(home, "private.txt"), "read"), false);
  assert.equal(ruleAllowsPath(rule, path.join(offered, "note.txt"), "read"), true);
  assert.equal(ruleAllowsPath(rule, path.join(offered, "note.txt"), "write"), false);
  assert.equal(ruleAllowsPath(rule, path.join(data, "other", "note.txt"), "read"), false);
  assert.equal(ruleAllowsPath(rule, path.join(folders.home, "cache"), "write"), true);
  assert.equal(ruleAllowsPath(rule, grant, "write"), true);
  assert.equal(ruleAllowsPath(rule, path.join(grant, "child"), "write"), false);
  await assert.rejects(workstationAccessRule({ root: path.join(home, "project[1]"), offered: [], storage, data: [data], grants: [], environment: {} }), /Full access/);
});

test("recursive file reads cannot cross a blocked subtree and writable copies cannot cross a read-only root", async (t) => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-workstation-copy-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "project");
  const blocked = path.join(root, "private");
  const skills = path.join(root, "skills");
  await Promise.all([blocked, skills].map((entry) => mkdir(entry, { recursive: true })));
  await writeFile(path.join(blocked, "secret"), "private");
  const context = workspaceProcessContext({ runId: "copy-run", root, cwd: root, home: { home: root }, logDirectory: root, hostRoot: undefined,
    readOnlyRoots: [{ directory: skills, alias: "@skills" }], accessRule: { blocked: [blocked], readable: [], writable: [skills], readOnly: [skills] } });
  const tools = await createSandboxTools(context.runId, async () => context);
  t.after(() => tools.shutdown());
  await assert.rejects(tools.tools.get("bytes.read")!({ path: ".", recursive: true }, { toolCallId: "copy-read" }), /outside/);
  await assert.rejects(tools.tools.get("bytes.write")!({ path: "@skills/result", content: { kind: "file", content: "dGVzdA==" } }, { toolCallId: "copy-write" }), /outside/);
});

test("redirected workstation storage fails before creating home or temporary folders in its target", async (t) => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-workstation-storage-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const outside = path.join(base, "outside");
  const storage = path.join(base, "storage", "run");
  await Promise.all([mkdir(outside), mkdir(path.dirname(storage))]);
  await symlink(outside, storage, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(prepareWorkstationFolders(storage), /Remove the redirected directory/);
  await assert.rejects(access(path.join(outside, "home")), /ENOENT/);
  await assert.rejects(access(path.join(outside, "tmp")), /ENOENT/);
});

test("file tools and grants cannot expose the host process or device namespace", async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-process-resources-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = workspaceProcessContext({ runId: "resources-run", root, cwd: root, home: { home: root }, logDirectory: root, hostRoot: undefined,
    accessRule: { blocked: [], readable: [], writable: [root], processNamespaces: PROCESS_RESOURCE_PATHS } });
  const tools = await createSandboxTools(context.runId, async () => context);
  t.after(() => tools.shutdown());
  for (const resource of ["/proc/self/environ", "/proc/self/mem", "/dev/stdin", "/sys/kernel"]) {
    await assert.rejects(tools.tools.get("read")!({ file_path: resource }, { toolCallId: "resource-read" }), /Use a command to inspect/);
    await assert.rejects(tools.tools.get("bytes.read")!({ path: resource }, { toolCallId: "resource-bytes" }), /Use a command to inspect/);
    assert.throws(() => assertNarrowWorkspaceGrant(resource), /full access is required/);
  }
  if (process.platform !== "win32") {
    const link = path.join(root, "device");
    await symlink("/dev/null", link);
    await assert.rejects(tools.tools.get("read")!({ file_path: link }, { toolCallId: "resource-link" }), /Use a command to inspect/);
  }
});
