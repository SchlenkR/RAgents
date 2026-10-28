import assert from "node:assert/strict";
import test from "node:test";
import { ruleAllowsPath, type WorkspaceAccessRule } from "../src/access-rule.js";

const rule: WorkspaceAccessRule = {
  blocked: ["/home", "/tmp", "/data"],
  readable: ["/home/user/toolchain", "/data/own/skills"],
  writable: ["/home/user/project", "/data/own/home", "/data/own/tmp"],
  readOnly: ["/data/own/skills"],
  grants: [
    { path: "/home/user/example.txt", access: "read" },
    { path: "/tmp/source", access: "read", directory: true },
    { path: "/tmp/result.txt", access: "write" },
    { path: "/tmp/output", access: "write", directory: true },
  ],
};

test("the access rule reads the system outside blocked areas and reopens only named areas", () => {
  for (const filename of ["/etc/hosts", "/usr/bin/node", "/home/user/toolchain/bin/node", "/data/own/skills/example.md",
    "/home/user/project/src/index.ts", "/home/user/example.txt", "/tmp/source/input.txt"]) {
    assert.equal(ruleAllowsPath(rule, filename, "read"), true, filename);
  }
  for (const filename of ["/home/user/.ssh/id_key", "/home/other/file", "/data/foreign/journal", "/tmp/private",
    "/home/user/toolchain-other/file", "/home/user/example.txt/child", "/tmp/source-other/file"]) {
    assert.equal(ruleAllowsPath(rule, filename, "read"), false, filename);
  }
});

test("the access rule writes only its writable areas and write grants", () => {
  for (const filename of ["/home/user/project/src/index.ts", "/data/own/home/.cache/state", "/data/own/tmp/log",
    "/tmp/result.txt", "/tmp/output/result.txt"]) {
    assert.equal(ruleAllowsPath(rule, filename, "write"), true, filename);
    assert.equal(ruleAllowsPath(rule, filename, "read"), true, filename);
  }
  for (const filename of ["/etc/hosts", "/home/user/toolchain/node", "/data/own/skills/example.md", "/home/user/example.txt",
    "/tmp/source/input.txt", "/tmp/result.txt/child", "/tmp/output-other/file"]) {
    assert.equal(ruleAllowsPath(rule, filename, "write"), false, filename);
  }
});

test("read-only roots and executable configuration protection override writable ancestors and grants", () => {
  const protectedRule: WorkspaceAccessRule = {
    blocked: [],
    readable: [],
    writable: ["/project"],
    readOnly: ["/project/skills"],
    grants: [{ path: "/project/skills", access: "write", directory: true }],
    writeProtected: [{ root: "/project", names: [".vscode", ".git/hooks", ".bashrc"] }],
  };
  for (const filename of ["/project/skills/example", "/project/.vscode/settings.json", "/project/nested/.git/hooks/commit", "/project/.bashrc"]) {
    assert.equal(ruleAllowsPath(protectedRule, filename, "write"), false, filename);
    assert.equal(ruleAllowsPath(protectedRule, filename, "read"), true, filename);
  }
  for (const filename of ["/project/.git/config", "/project/src/vscode.ts", "/project/bashrc", "/project/nested/.git/hooks-other/file"]) {
    assert.equal(ruleAllowsPath(protectedRule, filename, "write"), true, filename);
  }
});

test("the access rule compares Windows drive and UNC paths by segments without case sensitivity", () => {
  const windows: WorkspaceAccessRule = {
    blocked: ["C:\\Users", "\\\\server\\data"],
    readable: ["C:\\Users\\alice\\tools"],
    writable: ["C:\\Users\\alice\\project", "\\\\server\\data\\own"],
  };
  assert.equal(ruleAllowsPath(windows, "c:/USERS/alice/PROJECT/file.txt", "write"), true);
  assert.equal(ruleAllowsPath(windows, "C:\\Users\\alice\\project-other\\file.txt", "read"), false);
  assert.equal(ruleAllowsPath(windows, "\\\\SERVER\\DATA\\OWN\\file.txt", "write"), true);
  assert.equal(ruleAllowsPath(windows, "\\\\server\\data\\foreign\\file.txt", "read"), false);
  assert.equal(ruleAllowsPath(windows, "C:\\Windows\\System32\\drivers\\etc\\hosts", "read"), true);
});

test("the access rule handles root blocks and the shared build socket prefix without adjacent paths", () => {
  const sockets: WorkspaceAccessRule = { blocked: ["/"], readable: ["/usr"], writable: ["/tmp/MSBuild*"] };
  assert.equal(ruleAllowsPath(sockets, "/etc/hosts", "read"), false);
  assert.equal(ruleAllowsPath(sockets, "/usr/bin/env", "read"), true);
  assert.equal(ruleAllowsPath(sockets, "/tmp/MSBuild123/socket", "write"), true);
  assert.equal(ruleAllowsPath(sockets, "/tmp/MSOther/socket", "write"), false);
});
