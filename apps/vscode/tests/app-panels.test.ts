import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildSync } from "esbuild";

const stub = `
exports.ViewColumn = { Active: -1 };
exports.panels = [];
exports.window = { createWebviewPanel(type, title, column, options) {
  const listeners = new Set();
  const panel = {
    type, title, column, options, reveals: [], disposed: false,
    webview: { html: "", onDidReceiveMessage: () => ({ dispose() {} }) },
    onDidDispose(listener) { listeners.add(listener); },
    reveal(column, preserveFocus) {
      this.reveals.push({ column, preserveFocus });
      if (column !== undefined) this.column = column;
    },
    dispose() {
      this.disposed = true;
      for (const listener of listeners) listener();
    },
  };
  exports.panels.push(panel);
  return panel;
} };
`;

const check = `
const assert = require("node:assert/strict");
const vscode = require("./vscode.cjs");
const { AppPanels } = require("./webviews.cjs");
const apps = new AppPanels({
  zoom: () => 100,
  frame: (connection) => ({ serverUrl: "http://" + connection.replaceAll(":", "-") + ".example", theme: "dark" }),
});
apps.open("first", "run", "board", "Board", "Run");
const original = vscode.panels[0];
const html = original.webview.html;
assert.equal(original.options.retainContextWhenHidden, true);
assert.match(html, /element=board/);
original.column = 3;
apps.open("first", "run", "board", "Board", "Run");
apps.open("first", "run", "board", "Board", "Run");
assert.equal(vscode.panels.length, 1);
assert.equal(original.column, 3);
assert.deepEqual(original.reveals, [{ column: undefined, preserveFocus: false }, { column: undefined, preserveFocus: false }]);
assert.equal(original.webview.html, html);
apps.open("second", "run", "board", "Board", "Run");
apps.open("first", "other-run", "board", "Board", "Run");
apps.open("first", "run", "other-app", "Other", "Run");
assert.equal(vscode.panels.length, 4);
assert.match(vscode.panels[1].webview.html, /second.example/);
original.dispose();
apps.open("first", "run", "board", "Board", "Run");
assert.equal(vscode.panels.length, 5);
assert.notEqual(vscode.panels[4], original);
apps.closeConnection("first");
assert.equal(vscode.panels[1].disposed, false);
assert.equal(vscode.panels[4].disposed, true);
apps.open("second", "run", "board", "Board", "Run");
assert.equal(vscode.panels.length, 5);
apps.open("a:b", "c", "d", "One", undefined);
apps.open("a", "b:c", "d", "Two", undefined);
assert.equal(vscode.panels.length, 7);
apps.dispose();
assert.ok(vscode.panels.every((panel) => panel.disposed));
`;

test("app tabs reuse their editor group and isolate app, run and server identities across close and reopen", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-app-panels-"));
  try {
    const stubFile = path.join(directory, "vscode.cjs");
    writeFileSync(stubFile, stub);
    buildSync({
      entryPoints: [fileURLToPath(new URL("../src/webviews.ts", import.meta.url))],
      outfile: path.join(directory, "webviews.cjs"), bundle: true, platform: "node", format: "cjs",
      external: [stubFile], alias: { vscode: stubFile },
    });
    writeFileSync(path.join(directory, "check.cjs"), check);
    const result = spawnSync(process.execPath, ["check.cjs"], { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
