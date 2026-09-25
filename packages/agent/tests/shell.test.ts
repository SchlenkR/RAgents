import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { getShellConfig } from "../src/utils/shell.ts";

test("on Windows the bash is never searched for: without an explicit path the resolution fails", () => {
  assert.throws(() => getShellConfig(undefined, "win32"), /On Windows the bash is never searched for/);
});

test("an explicit bash wins on every platform and must exist", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "agent-shell-"));
  const bash = path.join(directory, "bash.exe");
  try {
    assert.throws(() => getShellConfig(bash, "win32"), /Custom shell path not found/);
    writeFileSync(bash, "");
    assert.deepEqual(getShellConfig(bash, "win32"), { shell: bash, args: ["--noprofile", "--norc", "-c"] });
    assert.deepEqual(getShellConfig(bash, "linux"), { shell: bash, args: ["--noprofile", "--norc", "-c"] });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("without an explicit path Unix takes the system bash and reads no startup file", { skip: process.platform === "win32" }, () => {
  const resolved = getShellConfig(undefined, process.platform);
  assert.match(resolved.shell, /bash$/);
  assert.deepEqual(resolved.args, ["--noprofile", "--norc", "-c"]);
});
