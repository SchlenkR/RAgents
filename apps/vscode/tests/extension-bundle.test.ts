import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));

/** Die .vsix bringt keine node_modules mit; der Stub ist alles, was das Bundle beim Laden und Aktivieren vorfindet. */
const VSCODE_STUB = `const noop = () => undefined;
const settings = { "ragents.connections": [], "ragents.hostPath": "", "ragents.theme": "auto" };
const configurationListeners = new Set();
const disposable = { dispose: noop };
const event = () => disposable;
const uri = (value) => ({ scheme: "file", path: value, fsPath: value, toString: () => value });

class EventEmitter {
  constructor() { this.event = event; }
  fire() {}
  dispose() {}
}

module.exports = {
  EventEmitter,
  ThemeIcon: class { constructor(id) { this.id = id; } },
  ThemeColor: class { constructor(id) { this.id = id; } },
  Disposable: class { constructor(dispose) { this.dispose = dispose ?? noop; } },
  Uri: { file: uri, parse: uri, joinPath: (base, ...parts) => uri([base.fsPath, ...parts].join("/")) },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  QuickPickItemKind: { Separator: -1, Default: 0 },
  ViewColumn: { Active: -1 },
  commands: { registerCommand: () => disposable, executeCommand: () => Promise.resolve(undefined) },
  env: { openExternal: () => Promise.resolve(true) },
  extensions: { getExtension: () => undefined },
  window: {
    activeColorTheme: { kind: 2 },
    createOutputChannel: () => ({ appendLine: noop, append: noop, show: noop, dispose: noop }),
    createStatusBarItem: () => ({ text: "", tooltip: "", command: "", show: noop, hide: noop, dispose: noop }),
    createWebviewPanel: () => { throw new Error("Beim Aktivieren wird kein Webview-Panel erwartet"); },
    registerWebviewViewProvider: () => disposable,
    registerUriHandler: () => disposable,
    onDidChangeActiveColorTheme: event,
    showErrorMessage: () => Promise.resolve(undefined),
    showInformationMessage: () => Promise.resolve(undefined),
    showWarningMessage: () => Promise.resolve(undefined),
    showQuickPick: () => Promise.resolve(undefined),
    showOpenDialog: () => Promise.resolve(undefined),
    showTextDocument: () => Promise.resolve(undefined),
    withProgress: (_options, task) => task({ report: noop }, { isCancellationRequested: false, onCancellationRequested: event }),
  },
  workspace: {
    name: undefined,
    workspaceFolders: undefined,
    settings,
    getConfiguration: (section) => ({
      get: (key) => settings[section + "." + key],
      inspect: (key) => ({ globalValue: settings[section + "." + key] }),
      update: (key, value) => {
        settings[section + "." + key] = value;
        const changed = { affectsConfiguration: (id) => id === section || id === section + "." + key };
        for (const listener of configurationListeners) listener(changed);
        return Promise.resolve(undefined);
      },
    }),
    registerTextDocumentContentProvider: () => disposable,
    onDidChangeConfiguration: (listener) => { configurationListeners.add(listener); return disposable; },
    onDidChangeWorkspaceFolders: event,
    openTextDocument: () => Promise.resolve(undefined),
  },
};
`;

const ACTIVATE = `const Module = require("node:module");
const stub = require.resolve("./vscode.cjs");
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === "vscode" ? stub : resolveFilename.call(this, request, ...rest);
};
const vscode = require("./vscode.cjs");
const extension = require("./extension.js");
const context = {
  subscriptions: [],
  extensionPath: process.cwd(),
  extensionUri: vscode.Uri.file(process.cwd()),
  globalStorageUri: vscode.Uri.file(process.cwd() + "/storage"),
  globalState: { get: () => undefined, update: () => Promise.resolve(undefined) },
  workspaceState: { get: () => undefined, update: () => Promise.resolve(undefined) },
  secrets: { get: () => Promise.resolve(undefined), store: () => Promise.resolve(undefined), delete: () => Promise.resolve(undefined), onDidChange: () => ({ dispose: () => undefined }) },
};
const assert = require("node:assert/strict");
const path = require("node:path");
const settings = vscode.workspace.settings;
const host = path.join(process.cwd(), "host");
const names = (api) => api.panel().connections.map((connection) => connection.name);

/** Die Panelseite schickt genau diese Aktionen; sie schreiben ragents.connections und melden Fehler in der Seite. */
const checkPanelActions = async (api) => {
  assert.equal(api.panel().page, "start", "die Erweiterung beginnt auf der Start-Seite");
  for (const page of ["runs", "connections", "start"]) {
    await api.panelAction({ action: "page", page });
    assert.equal(api.panel().page, page);
  }

  await api.panelAction({ action: "addServer", name: "erste", url: "http://127.0.0.1:59991" });
  await api.panelAction({ action: "addServer", name: "zweite", url: "http://127.0.0.1:59992" });
  assert.deepEqual(settings["ragents.connections"], [
    { name: "erste", url: "http://127.0.0.1:59991" },
    { name: "zweite", url: "http://127.0.0.1:59992" },
  ]);

  await api.panelAction({ action: "addServer", name: "ohne-schema", url: "localhost:59993" });
  assert.equal(settings["ragents.connections"].length, 2, "eine Adresse ohne Schema kommt nicht durch");
  assert.notEqual(api.panel().problem, undefined, "der Grund steht in der Seite");

  // Bearbeiten ersetzt den Eintrag an seiner Stelle, statt ihn zu entfernen und neu anzuhängen.
  await api.panelAction({ action: "updateServer", name: "erste", newName: "erste-neu", url: "http://127.0.0.1:59994" });
  assert.deepEqual(settings["ragents.connections"], [
    { name: "erste-neu", url: "http://127.0.0.1:59994" },
    { name: "zweite", url: "http://127.0.0.1:59992" },
  ]);
  assert.equal(api.panel().problem, undefined);
  assert.deepEqual(names(api), ["erste-neu", "zweite"]);

  await api.panelAction({ action: "updateServer", name: "erste-neu", newName: "zweite", url: "http://127.0.0.1:59994" });
  assert.notEqual(api.panel().problem, undefined, "ein doppelter Name kommt nicht durch");
  assert.deepEqual(names(api), ["erste-neu", "zweite"]);

  await api.panelAction({ action: "addProfile", name: "core", profileFile: path.join(host, "ragents.config.core.ts") });
  assert.deepEqual(names(api), ["erste-neu", "zweite", "core"]);
  await api.panelAction({ action: "updateProfile", name: "core", newName: "entwicklung", profileFile: path.join(host, "ragents.config.developer.ts") });
  assert.deepEqual(settings["ragents.connections"][2], { name: "entwicklung", profileFile: path.join(host, "ragents.config.developer.ts") });
  await api.panelAction({ action: "updateProfile", name: "entwicklung", newName: "entwicklung", profileFile: path.join(host, "ragents.config.gibtesnicht.ts") });
  assert.notEqual(api.panel().problem, undefined, "eine Profildatei, die es nicht gibt, kommt nicht durch");

  await api.panelAction({ action: "stopProfile", name: "entwicklung" });
  assert.equal(api.panel().connections[2].state.kind, "stopped");

  await api.panelAction({ action: "remove", name: "zweite" });
  assert.deepEqual(names(api), ["erste-neu", "entwicklung"]);

  // Die Vorschläge des Dialogs kommen aus dem Host-Ordner; ohne Host bleibt die Liste leer.
  assert.deepEqual(api.panel().profileSuggestions, []);
  settings["ragents.hostPath"] = host;
  assert.deepEqual(api.panel().profileSuggestions, [
    path.join(host, "ragents.config.core.ts"),
    path.join(host, "ragents.config.developer.ts"),
  ]);
  settings["ragents.hostPath"] = "";

  const entwicklung = api.panel().connections[1];
  assert.equal(entwicklung.kind, "profile");
  assert.equal(entwicklung.address, path.join(host, "ragents.config.developer.ts"));
};

process.on("unhandledRejection", (cause) => { console.error("unhandledRejection:", cause); process.exit(4); });
extension.activate(context).then(
  async (api) => {
    if (typeof api.connections !== "function") throw new Error("activate liefert keine API");
    await checkPanelActions(api);
    await extension.deactivate();
    process.exit(0);
  },
  (cause) => { console.error("activate:", cause && cause.stack ? cause.stack : cause); process.exit(5); },
).catch((cause) => { console.error("panelAction:", cause && cause.stack ? cause.stack : cause); process.exit(6); });
`;

test("das gebaute Bundle lädt, aktiviert ohne node_modules daneben und führt die Aktionen der Panelseite aus", () => {
  const built = spawnSync(process.execPath, ["esbuild.mjs"], { cwd: extensionRoot, encoding: "utf8" });
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-bundle-"));
  try {
    copyFileSync(path.join(extensionRoot, "dist/extension.js"), path.join(directory, "extension.js"));
    writeFileSync(path.join(directory, "vscode.cjs"), VSCODE_STUB);
    writeFileSync(path.join(directory, "activate.cjs"), ACTIVATE);
    mkdirSync(path.join(directory, "host/apps/server/src"), { recursive: true });
    writeFileSync(path.join(directory, "host/package.json"), "{}");
    writeFileSync(path.join(directory, "host/apps/server/src/main.ts"), "");
    writeFileSync(path.join(directory, "host/ragents.config.core.ts"), "");
    writeFileSync(path.join(directory, "host/ragents.config.developer.ts"), "");
    const run = spawnSync(process.execPath, ["activate.cjs"], { cwd: directory, encoding: "utf8", timeout: 120_000 });
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
