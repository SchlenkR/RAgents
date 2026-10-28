import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ACCESS_OPERATIONS,
  BYTE_OPERATIONS,
  FILE_OPERATIONS,
  WorkspaceOperationExecutor,
  assertNarrowWorkspaceGrant,
  validateWorkspaceGrants,
  workspaceExecutorModules,
  workspaceProcessContext,
  type WorkspaceAccessInspection,
  type WorkspaceGrant,
} from "../src/index.ts";

const rejectsGrant = (filename: string, policy = {}): void =>
  assert.throws(() => assertNarrowWorkspaceGrant(filename, policy), /full access is required/, filename);

test("grants reject roots, home folders and their ancestors on either platform", () => {
  for (const filename of [
    "/", "/home", "/home/alice", "/Users", "/Users/alice", "/root", "/var", "/var/home/alice",
    "/private", "/private/var", "/private/var/root", "/System/Volumes/Data/Users/alice", "/export/home/alice", "C:\\", "C:/", "C:/Users", "c:/users/ALICE",
    "D:/Documents and Settings/alice", "\\\\server\\share\\", "//server/share/", "\\\\?\\C:\\Users\\alice\\project", "relative", "",
  ]) rejectsGrant(filename);
  for (const filename of ["/mnt", "/mnt/accounts", "/mnt/accounts/alice"]) rejectsGrant(filename, { homeDirectories: ["/mnt/accounts/alice"] });
  for (const filename of ["/home/alice/project", "/Users/alice/project", "/root/project", "C:/Users/alice/project", "D:/projects"]) {
    assert.doesNotThrow(() => assertNarrowWorkspaceGrant(filename), filename);
  }
});

test("known home secrets and folders that contain them require full access", () => {
  const secrets = [
    ".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".config/gh", ".config/gcloud", ".netrc", ".npmrc",
    ".pypirc", ".git-credentials", "Library/Keychains", ".profile", ".bashrc", ".bash_profile", ".bash_login",
    ".bash_logout", ".zshenv", ".zprofile", ".zshrc", ".zlogin", ".zlogout", ".config/fish/config.fish",
    ".config/zsh/.zshrc", ".config/powershell/Microsoft.PowerShell_profile.ps1", ".config/nushell/config.nu",
  ];
  for (const secret of secrets) {
    for (const home of ["/home/alice", "/Users/alice", "/root", "C:/Users/alice"]) {
      rejectsGrant(`${home}/${secret}`);
      rejectsGrant(`${home}/${secret}/child`);
    }
    rejectsGrant(`/mnt/accounts/alice/${secret}`, { homeDirectories: ["/mnt/accounts/alice"] });
  }
  rejectsGrant("/Users/alice/Library");
  rejectsGrant("/home/alice/.config");
  rejectsGrant("C:/Users/alice/.SSH/id_ed25519");
  rejectsGrant("C:/Users/alice/Documents/PowerShell/Microsoft.PowerShell_profile.ps1");
  rejectsGrant("C:/Users/alice/Documents/WindowsPowerShell/profile.ps1");
  rejectsGrant("//server/share/Users/alice/.ssh/id_ed25519");
  rejectsGrant("//home/alice/.ssh/id_ed25519");
  rejectsGrant("/var/root/.ssh/id_ed25519");
  rejectsGrant("/private/var/root/.zprofile");
  rejectsGrant("/System/Volumes/Data/Users/alice/.ssh/id_ed25519");
  rejectsGrant("/System/Volumes/Data/private/var/root/.zshrc");
  for (const filename of ["/home/alice/.ssh-copy", "/home/alice/.config/demo", "/home/alice/Library/Notes", "/work/.ssh", "/work/.npmrc"]) {
    assert.doesNotThrow(() => assertNarrowWorkspaceGrant(filename), filename);
  }
});

test("data and another run's folders stay protected including their ancestors", () => {
  const policy = { dataDirectory: "/srv/data", protectedPaths: ["/work/other-run", "/archive/other-run"] };
  for (const filename of ["/srv", "/srv/data", "/srv/data/runs/current", "/work", "/work/other-run", "/work/other-run/file", "/archive/other-run"]) {
    rejectsGrant(filename, policy);
  }
  for (const filename of ["/srv/data-copy", "/work/current", "/archive/current"]) assert.doesNotThrow(() => assertNarrowWorkspaceGrant(filename, policy));
  rejectsGrant("C:/DATA/Runs/another", { dataDirectory: "c:\\data" });
  rejectsGrant("C:/work/OTHER", { protectedPaths: ["c:\\work\\other"] });
});

test("a grant is a literal path and cannot become a sandbox glob", () => {
  for (const filename of ["/work/file*", "/work/file?", "/work/file[1]", "/work/file]", "/work/line\nbreak", "/work/line\rbreak"]) rejectsGrant(filename);
  assert.doesNotThrow(() => assertNarrowWorkspaceGrant("/work/a file (copy).txt"));
});

const fixture = async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-grants-")));
  const workspace = path.join(directory, "workspace");
  const outside = path.join(directory, "outside");
  const home = path.join(directory, "account");
  const data = path.join(directory, "data");
  await Promise.all([workspace, outside, home, data].map((folder) => mkdir(folder)));
  const file = path.join(outside, "note.txt");
  await writeFile(file, "hello\n");
  await writeFile(path.join(outside, "other.txt"), "other\n");
  let grants: readonly WorkspaceGrant[] = [];
  const policy = { homeDirectories: [home, homedir()], dataDirectory: data };
  const executor = new WorkspaceOperationExecutor({
    contextFor: (runId) => Promise.resolve(workspaceProcessContext({
      runId,
      cwd: workspace,
      root: workspace,
      home: { home: workspace },
      logDirectory: workspace,
      hostRoot: undefined,
      access: { level: "isolated", grants },
      grantPolicy: policy,
      readOnlyRoots: [{ directory: outside, alias: "@reference", environmentVariable: "RAGENTS_REFERENCE_DIR" }],
    })),
    modules: workspaceExecutorModules({ contributions: [] }),
  });
  return {
    directory, workspace, outside, home, data, file, policy, executor,
    use: (value: readonly WorkspaceGrant[]) => { grants = value; },
    inspect: (filename: string, access: "read" | "write") => executor.execute("run", ACCESS_OPERATIONS.inspect, { path: filename, access }) as Promise<WorkspaceAccessInspection>,
    close: async () => { await executor.shutdown(); await rm(directory, { recursive: true, force: true }); },
  };
};

test("inspection resolves relative paths, aliases, home notation and variables like file tools", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.inspect("../outside/note.txt", "read"), { path: f.file, kind: "file", reachable: true });
    assert.deepEqual(await f.inspect("@reference/note.txt", "read"), { path: f.file, kind: "file", reachable: true });
    assert.deepEqual(await f.inspect("$RAGENTS_REFERENCE_DIR/note.txt", "read"), { path: f.file, kind: "file", reachable: true });
    assert.deepEqual(await f.inspect("${RAGENTS_REFERENCE_DIR}/note.txt", "write"), { path: f.file, kind: "file", reachable: false });
    await assert.rejects(f.inspect("~", "read"), /full access is required/);
    await assert.rejects(f.inspect("@unknown/note.txt", "read"), /Unknown working directory alias/);
    await assert.rejects(f.inspect("\0", "write"), /Give a path/);
    await assert.rejects(f.inspect(path.join(f.outside, "missing.txt"), "read"), /ENOENT/);
    assert.deepEqual(await f.inspect(path.join(f.outside, "missing.txt"), "write"), { path: path.join(f.outside, "missing.txt"), kind: "missing", reachable: false });
    assert.deepEqual(await f.inspect(".", "write"), { path: f.workspace, kind: "directory", reachable: true });
    await assert.rejects(f.inspect(f.home, "write"), /full access is required/);
    await assert.rejects(f.inspect(f.data, "read"), /full access is required/);
  } finally { await f.close(); }
});

test("read and write grants enforce file boundaries and allow new writable paths", async () => {
  const f = await fixture();
  try {
    const exact = path.join(f.directory, "exact.txt");
    const sibling = path.join(f.directory, "sibling.txt");
    await writeFile(exact, "first\n");
    await writeFile(sibling, "sibling\n");
    f.use([{ path: exact, access: "read" }]);
    const read = await f.executor.execute("run", "read", { file_path: exact });
    assert.match(JSON.stringify(read), /first/);
    assert.match(JSON.stringify(await f.executor.execute("run", FILE_OPERATIONS.text, { path: exact })), /first/);
    assert.match(JSON.stringify(await f.executor.execute("run", BYTE_OPERATIONS.read, { path: exact })), /Zmlyc3QK/);
    await assert.rejects(f.executor.execute("run", "read", { file_path: sibling }), /outside/);
    await assert.rejects(f.executor.execute("run", "write", { file_path: exact, content: "changed\n" }), /outside/);
    await assert.rejects(f.executor.execute("run", BYTE_OPERATIONS.write, { path: exact, content: { kind: "file", content: "eA==" } }), /outside/);
    f.use([{ path: exact, access: "write" }]);
    await f.executor.execute("run", "write", { file_path: exact, content: "changed\n" });
    await f.executor.execute("run", "edit", { file_path: exact, old_string: "changed", new_string: "edited" });
    assert.equal(await readFile(exact, "utf8"), "edited\n");
    const fresh = path.join(f.directory, "new", "nested", "created.txt");
    f.use([{ path: fresh, access: "write" }]);
    await assert.rejects(f.executor.execute("run", "write", { file_path: path.join(fresh, "child.txt"), content: "x" }), /outside/);
    await f.executor.execute("run", "write", { file_path: fresh, content: "created\n" });
    assert.equal(await readFile(fresh, "utf8"), "created\n");
    await assert.rejects(f.executor.execute("run", "write", { file_path: `${fresh}.sibling`, content: "x" }), /outside/);
    f.use([{ path: path.dirname(fresh), access: "write" }]);
    await f.executor.execute("run", "write", { file_path: `${fresh}.sibling`, content: "x" });
  } finally { await f.close(); }
});

test("grants are checked with real local boundaries and cannot follow a replaced symlink", async () => {
  const f = await fixture();
  try {
    const granted = path.join(f.directory, "granted.txt");
    const secret = path.join(f.home, ".npmrc");
    await writeFile(secret, "secret\n");
    await writeFile(granted, "public\n");
    f.use([{ path: granted, access: "read" }]);
    await f.executor.execute("run", "read", { file_path: granted });
    await rm(granted);
    await symlink(secret, granted);
    await assert.rejects(f.executor.execute("run", "read", { file_path: granted }), /now resolves elsewhere/);
    f.use([{ path: secret, access: "read" }]);
    await assert.rejects(f.executor.execute("run", "read", { file_path: secret }), /full access is required/);
    f.use([]);
    await assert.rejects(f.inspect(granted, "read"), /full access is required/);
    const alias = path.join(f.directory, "data-link");
    await symlink(f.data, alias);
    await assert.rejects(validateWorkspaceGrants([{ path: f.data, access: "write" }], { dataDirectory: alias }), /full access is required/);
    await validateWorkspaceGrants([{ path: path.join(f.directory, "missing.txt"), access: "read" }], f.policy);
    await validateWorkspaceGrants([{ path: path.join(f.directory, "missing.txt"), access: "write" }], f.policy);
  } finally { await f.close(); }
});

test("a removed read grant does not block unrelated operations", async () => {
  const f = await fixture();
  try {
    const granted = path.join(f.directory, "removed.txt");
    await writeFile(granted, "public\n");
    f.use([{ path: granted, access: "read" }]);
    await f.executor.execute("run", "read", { file_path: granted });
    await rm(granted);
    await f.executor.execute("run", "write", { file_path: "local.txt", content: "local\n" });
    assert.equal(await readFile(path.join(f.workspace, "local.txt"), "utf8"), "local\n");
    await assert.rejects(f.inspect(granted, "read"), /ENOENT/);
    await assert.rejects(f.executor.execute("run", "read", { file_path: granted }), /ENOENT/);
  } finally { await f.close(); }
});
