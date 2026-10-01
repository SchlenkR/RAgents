import assert from "node:assert/strict";
import test from "node:test";
import { packageManagerInvocation } from "./package-manager.ts";

const node = "C:\\Program Files\\nodejs\\node.exe";
const args = ["view", "@example/package", "--json", "value with spaces & punctuation"];

test("Windows npm and global pnpm use their JavaScript entries without a command shell", () => {
  for (const name of ["npm", "pnpm"] as const) {
    const directory = "C:\\Program Files\\nodejs";
    const entry = `${directory}\\node_modules\\${name}\\bin\\${name === "npm" ? "npm-cli.js" : "pnpm.cjs"}`;
    const invocation = packageManagerInvocation(name, args, {
      platform: "win32", node, npmExecpath: "", locations: () => [`${directory}\\${name}.cmd`], exists: (file) => file === entry,
    });
    assert.deepEqual(invocation, { command: node, args: [entry, ...args] });
  }
});

test("Windows pnpm recognizes Corepack, its current JavaScript entry, and standalone executables", () => {
  const entry = "C:\\node\\node_modules\\corepack\\dist\\pnpm.js";
  for (const shim of ["C:\\node\\pnpm.cmd", "C:\\node\\node_modules\\corepack\\shims\\pnpm.cmd"]) {
    assert.deepEqual(packageManagerInvocation("pnpm", args, {
      platform: "win32", node, npmExecpath: "", locations: () => [shim], exists: (file) => file === entry,
    }), { command: node, args: [entry, ...args] });
  }
  assert.deepEqual(packageManagerInvocation("pnpm", args, {
    platform: "win32", node, npmExecpath: entry, exists: (file) => file === entry, locations: () => { throw new Error("PATH should not be searched"); },
  }), { command: node, args: [entry, ...args] });
  const executable = "C:\\package tools\\pnpm.exe";
  assert.deepEqual(packageManagerInvocation("pnpm", args, {
    platform: "win32", node, npmExecpath: "", locations: () => [executable], exists: (file) => file === executable,
  }), { command: executable, args });
});

test("a missing Windows entry is an error; Unix keeps direct process arguments", () => {
  assert.throws(() => packageManagerInvocation("npm", args, {
    platform: "win32", node, npmExecpath: "", locations: () => ["C:\\node\\npm.cmd"], exists: () => false,
  }), /Cannot find npm/);
  assert.deepEqual(packageManagerInvocation("npm", args, { platform: "darwin" }), { command: "npm", args });
});
