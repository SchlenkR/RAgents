import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { ACCESS_OPERATIONS, RUN_MARKER_ENV, hostDataDirectory, ragentsDataRoot, type WorkspaceGrant } from "@ragents/workspace-executor";
import { workspaceClientContracts } from "../../../plugins/ragents.workspace/contract";
import { WorkspaceClient } from "../../../plugins/ragents.workspace/client/workspace-client";
import { FullAccessConfirmations } from "../../../plugins/ragents.workspace/client/full-access";
import { ServerClient } from "../src/server-client";
import { startStubServer } from "./fixtures";

const CLIENT = "grant-workstation";
const RUN = "grant-run";

const textOf = (value: unknown): string => ((value as { content?: Array<{ type: string; text?: string }> }).content ?? [])
  .filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");

const fixture = async (t: TestContext, allowFullAccess = false) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "ragents-workstation-grants-")));
  const project = join(directory, "project");
  const otherProject = join(directory, "other-project");
  const outside = join(directory, "outside");
  const runs = join(directory, "storage", "runs");
  await Promise.all([project, otherProject, outside, runs].map((folder) => mkdir(folder, { recursive: true })));
  const file = join(outside, "note.txt");
  await writeFile(file, "External reference\n");
  await writeFile(join(outside, "other.txt"), "Other reference\n");
  const server = await startStubServer();
  const client = new ServerClient(server.url, undefined);
  const workspace = new WorkspaceClient(client, {
    id: CLIENT, label: "Workstation", hostname: "workstation", platform: process.platform,
    folders: [project, otherProject], runsDirectory: runs,
  }, { hostRoot: () => undefined, protectedPaths: () => [join(directory, "editor-config")], confirmFullAccess: async () => { if (allowFullAccess) return true; assert.fail("Narrow grants need no full-access confirmation."); } });
  await workspace.register();
  assert.deepEqual(workspace.status, { kind: "registered" });
  const execute = (operation: string, input: unknown, grants: readonly WorkspaceGrant[] = [], options: { runId?: string; cwd?: string; level?: "isolated" | "full" } = {}) =>
    server.workspaceConnection(CLIENT)!.call(workspaceClientContracts.execute, {
      runId: options.runId ?? RUN, access: { level: options.level ?? "isolated", grants: grants.map((grant) => ({ ...grant })) },
      operation, toolCallId: `grant-${operation}`, cwd: options.cwd ?? project,
      env: { [RUN_MARKER_ENV]: options.runId ?? RUN }, input,
    });
  t.after(async () => {
    await workspace.unregister();
    client.rpc.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, project, otherProject, outside, runs, file, server, workspace, execute };
};

test("workstation dispatch applies exact read and write grants without exposing siblings", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.execute("read", { file_path: f.file }), /outside/);
  const read = [{ path: f.file, access: "read" }] as const;
  assert.match(textOf((await f.execute("read", { file_path: f.file }, read)).value), /External reference/);
  await assert.rejects(f.execute("read", { file_path: join(f.outside, "other.txt") }, read), /outside/);
  await assert.rejects(f.execute("write", { file_path: f.file, content: "No\n" }, read), /outside/);
  const write = [{ path: f.file, access: "write" }] as const;
  await f.execute("write", { file_path: f.file, content: "Changed reference\n" }, write);
  await f.execute("edit", { file_path: f.file, old_string: "Changed", new_string: "Edited" }, write);
  assert.equal(await readFile(f.file, "utf8"), "Edited reference\n");
  assert.match(textOf((await f.execute("read", { file_path: f.file }, write)).value), /Edited reference/);
  await assert.rejects(f.execute("read", { file_path: f.file }), /outside/);
});

test("workstation folder grants cover descendants and keep access modes distinct", async (t) => {
  const f = await fixture(t);
  const read = [{ path: f.outside, access: "read" }] as const;
  assert.match(textOf((await f.execute("read", { file_path: join(f.outside, "other.txt") }, read)).value), /Other reference/);
  await assert.rejects(f.execute("write", { file_path: join(f.outside, "created.txt"), content: "No\n" }, read), /outside/);
  const write = [{ path: f.outside, access: "write" }] as const;
  await f.execute("write", { file_path: join(f.outside, "nested", "created.txt"), content: "Created\n" }, write);
  assert.equal(await readFile(join(f.outside, "nested", "created.txt"), "utf8"), "Created\n");
  await assert.rejects(f.execute("write", { file_path: join(f.directory, "sibling.txt"), content: "No\n" }, write), /outside/);
});

test("workstation write grants permit new files while read grants require an existing path", async (t) => {
  const f = await fixture(t);
  const missing = join(f.outside, "new", "file.txt");
  await assert.rejects(f.execute("read", { file_path: missing }, [{ path: missing, access: "read" }]), /ENOENT/);
  await f.execute("write", { file_path: missing, content: "New reference\n" }, [{ path: missing, access: "write" }]);
  assert.equal(await readFile(missing, "utf8"), "New reference\n");
  await assert.rejects(f.execute("read", { file_path: join(f.outside, "other.txt") }, [{ path: missing, access: "write" }]), /outside/);
});

test("every workstation dispatch rejects malicious broad, secret and data grants before executing", async (t) => {
  const f = await fixture(t);
  const protectedPaths = [
    "/", homedir(), join(homedir(), ".ssh"), join(homedir(), ".config", "gh"),
    join(homedir(), ".zshrc"), ragentsDataRoot(), hostDataDirectory(), f.runs,
    join(f.runs, "other-run", "private.txt"), join(f.runs, "..", "full-access"),
    join(tmpdir(), "ragents-workspace-logs"),
  ];
  for (const target of protectedPaths) {
    await assert.rejects(f.execute("operation-without-context", {}, [{ path: target, access: "write" }]), /full access is required/, target);
    await assert.rejects(f.execute("read", { file_path: f.file }, [{ path: target, access: "write" }]), /full access is required/, target);
  }
  await assert.rejects(f.execute("read", { file_path: f.file }), /outside/);
});

test("workstation dispatch rechecks the real path of an approved grant every time", async (t) => {
  const f = await fixture(t);
  const grants = [{ path: f.file, access: "read" }] as const;
  assert.match(textOf((await f.execute("read", { file_path: f.file }, grants)).value), /External reference/);
  await rm(f.file);
  await symlink(join(f.outside, "other.txt"), f.file);
  await assert.rejects(f.execute("read", { file_path: f.file }, grants), /now resolves elsewhere/);
  await assert.rejects(f.execute("operation-without-context", {}, grants), /now resolves elsewhere/);
});

test("locally confirmed full access needs no grant and is not blocked by an obsolete narrow grant", async (t) => {
  const f = await fixture(t, true);
  const grants = [{ path: f.file, access: "read" }] as const;
  await rm(f.file);
  await symlink(join(f.outside, "other.txt"), f.file);
  await assert.rejects(f.execute("read", { file_path: f.file }, grants), /now resolves elsewhere/);
  assert.match(textOf((await f.execute("read", { file_path: f.file }, grants, { level: "full" })).value), /Other reference/);
  await assert.rejects(f.execute("read", { file_path: f.file }, grants), /now resolves elsewhere/);
});

test("another active workstation run's offered folder cannot receive a grant", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.otherProject, "private.txt"), "Other run\n");
  await f.execute("read", { file_path: "private.txt" }, [], { runId: "other-run", cwd: f.otherProject });
  await assert.rejects(f.execute("read", { file_path: join(f.otherProject, "private.txt") }, [{ path: f.otherProject, access: "read" }]), /full access is required/);
});

test("access inspection resolves paths on the workstation and uses its local checks", async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.execute(ACCESS_OPERATIONS.inspect, { path: "../outside/note.txt", access: "read" })).value,
    { path: f.file, kind: "file", reachable: false });
  assert.deepEqual((await f.execute(ACCESS_OPERATIONS.inspect, { path: "../outside/note.txt", access: "read" }, [{ path: f.file, access: "read" }])).value,
    { path: f.file, kind: "file", reachable: true });
  const missing = join(f.outside, "fresh.txt");
  assert.deepEqual((await f.execute(ACCESS_OPERATIONS.inspect, { path: missing, access: "write" })).value,
    { path: missing, kind: "missing", reachable: false });
  await assert.rejects(f.execute(ACCESS_OPERATIONS.inspect, { path: "~", access: "read" }), /full access is required/);
});


test("custom workstation storage keeps consent and other run logs outside grants", async (t) => {
  const f = await fixture(t);
  const consentRoot = join(f.runs, "..", "full-access");
  const serverScope = createHash("sha256").update(f.server.url).digest("hex");
  const consentFile = join(consentRoot, serverScope, `${RUN}.txt`);
  const otherLog = join(tmpdir(), "ragents-workspace-logs", "other-run", "private.log");
  for (const target of [consentRoot, consentFile, join(tmpdir(), "ragents-workspace-logs"), otherLog]) {
    await assert.rejects(f.execute("operation-without-context", {}, [{ path: target, access: "write" }]), /full access is required/);
    await assert.rejects(f.execute("write", { file_path: target, content: "confirmed\n" }, [{ path: target, access: "write" }]), /full access is required/);
  }
  await assert.rejects(readFile(consentFile), /ENOENT/);
  await assert.rejects(new FullAccessConfirmations(f.runs, f.server.url, {}).accept({ runId: RUN, name: "Reference review" }), /has not allowed full access/);
});

test("a server grant cannot rewrite the local editor's full access policy", async (t) => {
  const f = await fixture(t);
  const settings = join(f.directory, "editor-config", "settings.json");
  await mkdir(join(f.directory, "editor-config"));
  await writeFile(settings, '{"workstation.fullAccess":"ask"}\n');
  await assert.rejects(f.execute("write", { file_path: settings, content: '{"workstation.fullAccess":"allow"}\n' }, [{ path: settings, access: "write" }]), /full access is required/);
  assert.equal(await readFile(settings, "utf8"), '{"workstation.fullAccess":"ask"}\n');
});
