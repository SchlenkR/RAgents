import assert from "node:assert/strict";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

test("VS Code uses a local modal confirmation with the run name and full access effects", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-vscode-access-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await build({
    entryPoints: [new URL("../src/workstation-access.ts", import.meta.url).pathname],
    outfile: join(directory, "access.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["vscode"],
  });
  await writeFile(join(directory, "vscode.cjs"), `
const state = { policy: undefined, answer: undefined, dialogs: [] };
module.exports = {
  state,
  workspace: { getConfiguration: (section) => ({ get: (key, fallback) => {
    if (section !== "ragents" || key !== "workstation.fullAccess") throw new Error("Wrong setting");
    return state.policy ?? fallback;
  } }) },
  window: { showWarningMessage: (...args) => { state.dialogs.push(args); return Promise.resolve(state.answer); } },
};
`);
  await writeFile(join(directory, "check.cjs"), `
const assert = require("node:assert/strict");
const Module = require("node:module");
const original = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) { return name === "vscode" ? require.resolve("./vscode.cjs") : original.call(this, name, ...args); };
const { state } = require("./vscode.cjs");
const options = require("./access.cjs").workstationFullAccessOptions();
const path = require("node:path");
const storage = path.join("editor-data", "User", "globalStorage", "ragents");
assert.deepEqual(require("./access.cjs").workstationFullAccessOptions(storage).protectedPaths(), [
  path.join("editor-data", "User", "globalStorage"), path.join("editor-data", "User", "settings.json"), path.join("editor-data", "User", "profiles"), path.join("editor-data", "Machine"),
]);
const run = { runId: "run-a", name: "Review project" };
const check = async () => {
  assert.equal(options.fullAccess(), "ask");
  state.policy = "allow";
  assert.equal(options.fullAccess(), "allow");
  state.policy = "deny";
  assert.equal(options.fullAccess(), "deny");
  state.policy = "invalid";
  assert.equal(options.fullAccess(), "ask");
  assert.equal(await options.confirmFullAccess(run), false);
  state.answer = "Allow full access";
  assert.equal(await options.confirmFullAccess(run), true);
  assert.equal(state.dialogs.length, 2);
  const [message, dialog, action] = state.dialogs[0];
  assert.match(message, /Review project.*run-a/);
  assert.equal(dialog.modal, true);
  assert.match(dialog.detail, /every file.*without an OS sandbox.*environment.*credentials.*remembered/);
  assert.equal(action, "Allow full access");
};
check().catch((cause) => { console.error(cause); process.exitCode = 1; });
`);
  const result = await execute(process.execPath, [join(directory, "check.cjs")], { cwd: directory });
  assert.equal(result.stderr, "");
});
