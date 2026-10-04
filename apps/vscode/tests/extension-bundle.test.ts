import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { before } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { session, SESSION_TOKEN, startStubServer, stubProfile } from "./fixtures";

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));
const execute = promisify(execFile);

before(() => {
  const built = spawnSync(process.execPath, ["esbuild.mjs"], { cwd: extensionRoot, encoding: "utf8" });
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
});

/** The .vsix brings no node_modules; the stub is everything the bundle finds when loading and activating. */
const VSCODE_STUB = `const noop = () => undefined;
const settings = { "ragents.connections": [], "ragents.hostPath": "", "ragents.theme": "auto", "ragents.zoom": 100 };
const providers = new Map();
const commandHandlers = new Map();
const contextValues = new Map();
const quickPicks = { calls: [], answers: [] };
const notifications = [];
const configurationListeners = new Set();
const disposable = { dispose: noop };
const event = () => disposable;
const uri = (value) => ({ scheme: "file", path: value, fsPath: value, toString: () => value });

class EventEmitter {
  constructor() {
    this.listeners = new Set();
    this.event = (listener) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
  }
  fire(value) { for (const listener of this.listeners) listener(value); }
  dispose() { this.listeners.clear(); }
}

module.exports = {
  EventEmitter,
  providers,
  contextValues,
  quickPicks,
  notifications,
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
  commands: {
    registerCommand: (name, handler) => { commandHandlers.set(name, handler); return { dispose: () => commandHandlers.delete(name) }; },
    executeCommand: (name, ...args) => {
      if (name === "setContext") contextValues.set(args[0], args[1]);
      return Promise.resolve(commandHandlers.get(name)?.(...args));
    },
  },
  env: { openExternal: () => Promise.resolve(true) },
  extensions: { getExtension: () => undefined },
  window: {
    activeColorTheme: { kind: 2 },
    createOutputChannel: () => ({ appendLine: noop, append: noop, show: noop, dispose: noop }),
    createStatusBarItem: () => ({ text: "", tooltip: "", command: "", show: noop, hide: noop, dispose: noop }),
    createWebviewPanel: () => { throw new Error("No webview panel is expected on activation"); },
    registerWebviewViewProvider: (id, provider) => { providers.set(id, provider); return { dispose: () => providers.delete(id) }; },
    registerUriHandler: () => disposable,
    onDidChangeActiveColorTheme: event,
    showErrorMessage: (message) => { notifications.push(message); return Promise.resolve(undefined); },
    showInformationMessage: (message) => { notifications.push(message); return Promise.resolve(undefined); },
    showWarningMessage: () => Promise.resolve(undefined),
    showQuickPick: (items, options) => {
      quickPicks.calls.push({ items, options });
      const answer = quickPicks.answers.shift();
      return Promise.resolve(typeof answer === "function" ? answer(items) : answer);
    },
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
    onDidChangeConfiguration: (listener) => { configurationListeners.add(listener); return { dispose: () => configurationListeners.delete(listener) }; },
    onDidChangeWorkspaceFolders: event,
    openTextDocument: () => Promise.resolve(undefined),
  },
};
`;

const LOAD_EXTENSION = `const Module = require("node:module");
const stub = require.resolve("./vscode.cjs");
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === "vscode" ? stub : resolveFilename.call(this, request, ...rest);
};
const vscode = require("./vscode.cjs");
const extension = require("./extension.js");
const workspaceState = new Map();
const secrets = new Map();
const context = {
  subscriptions: [],
  extensionPath: process.cwd(),
  extensionUri: vscode.Uri.file(process.cwd()),
  globalStorageUri: vscode.Uri.file(process.cwd() + "/storage"),
  extension: { id: "purestate.ragents-vscode" },
  globalState: { get: () => undefined, update: () => Promise.resolve(undefined) },
  workspaceState: { get: (key) => workspaceState.get(key), update: (key, value) => { workspaceState.set(key, value); return Promise.resolve(undefined); } },
  secrets: { get: (key) => Promise.resolve(secrets.get(key)), store: (key, value) => { secrets.set(key, value); return Promise.resolve(undefined); }, delete: (key) => { secrets.delete(key); return Promise.resolve(undefined); }, onDidChange: () => ({ dispose: () => undefined }) },
};
const assert = require("node:assert/strict");
const path = require("node:path");
const settings = vscode.workspace.settings;
const host = path.join(process.cwd(), "host");
const names = (api) => api.snapshots().map((snapshot) => snapshot.connection.name);
const waitFor = async (condition) => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > 15_000) throw new Error("Condition was not met.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
`;

const ACTIVATE = `${LOAD_EXTENSION}

/** The panel page sends exactly these actions; they write ragents.connections and report errors in the page. */
const checkPanelActions = async (api) => {
  assert.equal(api.panel().page, "connections", "without an environment the local shell shows connection management");
  assert.equal(api.activeEnvironment(), undefined);
  for (const page of ["runs", "connections", "start"]) {
    await api.panelAction({ action: "page", page });
    assert.equal(api.panel().page, "connections");
  }

  await api.panelAction({ action: "addServer", name: "first", url: "http://127.0.0.1:59991" });
  await api.panelAction({ action: "addServer", name: "second", url: "http://127.0.0.1:59992" });
  await api.panelAction({ action: "page", page: "connections" });
  assert.deepEqual(settings["ragents.connections"], [
    { name: "first", url: "http://127.0.0.1:59991" },
    { name: "second", url: "http://127.0.0.1:59992" },
  ]);

  // Sharing goes to the run's server: a refusal stays in the dialog, closing removes it, without a dialog the caller gets it.
  await api.panelAction({ action: "openSharing", name: "first", runId: "run-a" });
  assert.equal(api.panel().sharing.runId, "run-a");
  assert.equal(api.panel().sharing.result, undefined);
  assert.equal(typeof api.panel().sharing.error, "string", "the unreachable server's refusal appears in the dialog");
  await api.panelAction({ action: "closeSharing" });
  assert.equal(api.panel().sharing, undefined);
  await assert.rejects(api.panelAction({ action: "share", name: "first", runId: "run-a", sharing: { everyone: null, users: [] } }));

  await api.panelAction({ action: "addServer", name: "no-scheme", url: "localhost:59993" });
  assert.equal(settings["ragents.connections"].length, 2, "an address without a scheme does not get through");
  assert.notEqual(api.panel().problem, undefined, "the reason appears in the page");

  // Editing replaces the entry in place instead of removing it and appending it again.
  await api.panelAction({ action: "updateServer", name: "first", newName: "first-new", url: "http://127.0.0.1:59994" });
  assert.deepEqual(settings["ragents.connections"], [
    { name: "first-new", url: "http://127.0.0.1:59994" },
    { name: "second", url: "http://127.0.0.1:59992" },
  ]);
  assert.equal(api.panel().problem, undefined);
  assert.deepEqual(names(api), ["first-new", "second"]);

  await api.panelAction({ action: "updateServer", name: "first-new", newName: "second", url: "http://127.0.0.1:59994" });
  assert.notEqual(api.panel().problem, undefined, "a duplicate name does not get through");
  assert.deepEqual(names(api), ["first-new", "second"]);

  await api.panelAction({ action: "addProfile", name: "core", profileFile: path.join(host, "ragents.config.core.ts") });
  assert.deepEqual(names(api), ["first-new", "second", "core"]);
  await api.panelAction({ action: "updateProfile", name: "core", newName: "development", profileFile: path.join(host, "ragents.config.developer.ts") });
  assert.deepEqual(settings["ragents.connections"][2], { name: "development", profileFile: path.join(host, "ragents.config.developer.ts") });
  await api.panelAction({ action: "updateProfile", name: "development", newName: "development", profileFile: path.join(host, "ragents.config.missing.ts") });
  assert.notEqual(api.panel().problem, undefined, "a profile file that does not exist does not get through");

  await api.panelAction({ action: "stopProfile", name: "development" });
  assert.equal(api.panel().connections[2].state.kind, "stopped");

  await api.panelAction({ action: "remove", name: "second" });
  assert.deepEqual(names(api), ["first-new", "development"]);

  // The suggestions of the dialog come from the host folder; without a host the list stays empty.
  assert.deepEqual(api.panel().profileSuggestions, []);
  settings["ragents.hostPath"] = host;
  assert.deepEqual(api.panel().profileSuggestions, [
    path.join(host, "ragents.config.core.ts"),
    path.join(host, "ragents.config.developer.ts"),
  ]);
  settings["ragents.hostPath"] = "";

  const development = api.panel().connections[1];
  assert.equal(development.kind, "profile");
  assert.equal(development.address, path.join(host, "ragents.config.developer.ts"));
};

/** Start shows a clicked template as starting until the next state; a start that opens no run must still send one. */
const checkNewRunAnswers = async (api) => {
  const posted = [];
  const ignore = () => ({ dispose: () => undefined });
  vscode.providers.get("ragents.runPanel").resolveWebviewView({
    webview: { options: {}, html: "", cspSource: "vscode-webview:", asWebviewUri: (uri) => uri, onDidReceiveMessage: ignore,
      postMessage: (message) => { posted.push(message); return Promise.resolve(true); } },
    onDidDispose: ignore,
    show: () => undefined,
  });
  await assert.rejects(api.panelAction({ action: "newRun", name: "missing", entryId: "demo.circle" }), /not in ragents.connections/);
  assert.ok(posted.some((message) => message.type === "ragents.panel.state"), "a failed start answers with the next state");
};

process.on("unhandledRejection", (cause) => { console.error("unhandledRejection:", cause); process.exit(4); });
extension.activate(context).then(
  async (api) => {
    if (typeof api.connections !== "function") throw new Error("activate returns no API");
    await checkPanelActions(api);
    await checkNewRunAnswers(api);
    await extension.deactivate();
    process.exit(0);
  },
  (cause) => { console.error("activate:", cause && cause.stack ? cause.stack : cause); process.exit(5); },
).catch((cause) => { console.error("panelAction:", cause && cause.stack ? cause.stack : cause); process.exit(6); });
`;

const CHECK_ENVIRONMENTS = `${LOAD_EXTENSION}
const configuration = JSON.parse(process.env.RAGENTS_TEST_ENVIRONMENTS);
settings["ragents.connections"] = configuration.connections;
secrets.set("ragents.token:" + configuration.connections[1].url, configuration.token);
const folder = path.join(process.cwd(), "workspace");
const otherFolder = path.join(process.cwd(), "other-workspace");
vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(folder) }];
workspaceState.set("ragents.activeEnvironment", "removed-environment");
const posted = [];
let receive;
let html = "";
let localState;
const ignore = () => ({ dispose() {} });
const view = {
  webview: { options: {}, cspSource: "vscode-webview:", asWebviewUri: (uri) => uri,
    get html() { return html; },
    set html(value) {
      html = value;
      const embedded = value.match(/id="state">([^<]+)<\\/script>/);
      localState = embedded ? JSON.parse(embedded[1]) : undefined;
    },
    onDidReceiveMessage: (listener) => { receive = listener; return ignore(); },
    postMessage: (message) => {
      posted.push(message);
      if (message.type === "ragents.panel.state") localState = message.state;
      return Promise.resolve(true);
    } },
  onDidDispose: ignore,
  show() {},
};
const appPanels = [];
vscode.window.createWebviewPanel = (type, title, column, options) => {
  const listeners = new Set();
  const disposals = new Set();
  const app = {
    type, title, column, options,
    webview: { html: "",
      onDidReceiveMessage: (listener) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
      postMessage: () => Promise.resolve(true) },
    onDidDispose: (listener) => { disposals.add(listener); return { dispose: () => disposals.delete(listener) }; },
    receive: (message) => { for (const listener of listeners) listener(message); },
    reveal() {},
    dispose() { for (const listener of disposals) listener(); },
  };
  appPanels.push(app);
  return app;
};
const resolveView = () => vscode.providers.get("ragents.runPanel").resolveWebviewView(view);
const framedUrl = () => {
  const source = view.webview.html.match(/<iframe[^>]+src="([^"]+)"/);
  assert.ok(source, "the selected environment supplies a frame even before a run is selected");
  return new URL(source[1].replaceAll("&amp;", "&"));
};
const assertEnvironment = (api, name) => {
  assert.equal(api.activeEnvironment(), name);
  const url = framedUrl();
  assert.equal(url.origin, configuration.connections.find((entry) => entry.name === name).url);
  assert.equal(url.searchParams.get("connection"), name);
  assert.equal(view.title, "RAgents: " + name);
  return url;
};
const managementState = () => localState;
const stop = async () => {
  await extension.deactivate();
  for (const subscription of context.subscriptions.splice(0)) subscription.dispose();
};
const ready = () => { posted.length = 0; receive({ type: "ready" }); return posted; };

const check = async () => {
  let api = await extension.activate(context);
  await waitFor(() => ["first", "second"].every((name) => api.session(name)?.status.kind === "connected"
    && api.session(name)?.workspaceClient?.status.kind === "registered"));
  resolveView();
  assert.equal(api.panel().page, "connections", "the bundled local page is only connection management");
  assert.equal(assertEnvironment(api, "first").searchParams.has("run"), false);
  assert.deepEqual(ready(), [{ type: "showPage", page: "start" }]);
  assert.equal(vscode.contextValues.get("ragents.canCreate"), true);
  await vscode.commands.executeCommand("ragents.showStart");
  assert.equal(view.badge.value, 2, "waiting inputs are scoped to the active environment");

  const observed = [];
  context.subscriptions.push(api.messages((event) => observed.push(event)));
  for (const name of ["first", "second"]) {
    await vscode.commands.executeCommand("ragents.openAppInCenter", name, "run-a", "board--main", "Collection board");
  }
  const assertAppReadiness = () => {
    const before = posted.length;
    observed.length = 0;
    for (const app of appPanels) app.receive({ type: "ready" });
    assert.equal(posted.length, before, "app readiness from either server leaves the primary panel untouched");
    assert.deepEqual(observed, [
      { connection: "first", message: { type: "ready" } },
      { connection: "second", message: { type: "ready" } },
    ], "app readiness remains observable by the host API");
  };
  assertAppReadiness();
  await api.selectEnvironment("second");
  posted.length = 0;
  await api.newRun("first", "ragents.reference.board");
  assertEnvironment(api, "first");
  assert.equal(posted.some((message) => message.type === "newRun"), false, "the new frame has not reported ready yet");
  assertAppReadiness();
  assert.deepEqual(ready(), [
    { type: "showPage", page: "start" },
    { type: "newRun", entryId: "ragents.reference.board",
      startOptions: { "ragents.workspace.binding": api.session("first").workspaceClient.binding(folder) } },
  ], "only primary-panel readiness consumes the queued new-run request");

  vscode.quickPicks.answers.push((items) => {
    assert.ok(items.filter((item) => item.choice).every((item) => item.choice.connection === "first"));
    return items.find((item) => item.choice?.entryId === "ragents.reference.board");
  });
  posted.length = 0;
  await vscode.commands.executeCommand("ragents.newRun");
  await waitFor(() => posted.some((message) => message.type === "newRun"));
  const newRun = posted.find((message) => message.type === "newRun");
  assert.deepEqual(newRun, { type: "newRun", entryId: "ragents.reference.board",
    startOptions: { "ragents.workspace.binding": api.session("first").workspaceClient.binding(folder) } });
  posted.length = 0;
  receive({ type: "runChanged", runId: "ui-created" });
  assert.equal(posted.some((message) => message.type === "selectRun"), false, "a UI-created run keeps its fresh start options without a host selection echo");
  assertAppReadiness();
  assert.deepEqual(ready(), [{ type: "selectRun", runId: "ui-created" }], "app readiness does not restore or redirect the selected run");

  await api.newRun("first", "ragents.reference.circle");
  assert.deepEqual(posted.find((message) => message.type === "newRun"), { type: "newRun", entryId: "ragents.reference.circle" }, "a template's fixed folder is not replaced with the workstation folder");
  await api.session("first").updateFolders([folder, otherFolder]);
  vscode.quickPicks.answers.push(undefined);
  posted.length = 0;
  receive({ type: "newRun", entryId: "ragents.reference.board" });
  await waitFor(() => posted.some((message) => message.type === "showPage" && message.notice === "Run start cancelled."));
  assert.equal(posted.some((message) => message.type === "newRun"), false);
  await api.session("first").updateFolders([folder]);

  const unavailableSession = api.session("first");
  const reconnect = unavailableSession.connect.bind(unavailableSession);
  vscode.quickPicks.answers.push(async (items) => {
    await api.disconnect("first");
    unavailableSession.connect = async () => {};
    return items.find((item) => item.choice?.entryId === "ragents.reference.board");
  });
  await vscode.commands.executeCommand("ragents.newRun");
  assert.ok(vscode.notifications.includes("RAgents: The environment first is not connected."), "a disconnect during the native template picker reports a controlled error");
  assert.equal(managementState().notice, "The environment first is not connected.");
  unavailableSession.connect = reconnect;
  await reconnect();
  await waitFor(() => unavailableSession.workspaceClient?.status.kind === "registered");

  vscode.quickPicks.answers.push((items) => {
    assert.deepEqual(items.filter((item) => item.connection).map((item) => item.connection), ["first", "second"]);
    assert.ok(items.some((item) => item.label === "Manage environments ..." && item.connection === undefined));
    return items.find((item) => item.connection === "second");
  });
  await vscode.commands.executeCommand("ragents.selectEnvironment");
  assert.equal(assertEnvironment(api, "second").searchParams.has("run"), false);
  assert.deepEqual(ready(), [{ type: "showPage", page: "start" }]);
  assert.equal(view.badge.value, 5, "the badge does not include waiting inputs from the other connected server");
  assert.equal(vscode.contextValues.get("ragents.canCreate"), false);
  const picks = vscode.quickPicks.calls.length;
  posted.length = 0;
  await vscode.commands.executeCommand("ragents.newRun");
  await waitFor(() => vscode.notifications.includes("RAgents: The selected environment does not allow new runs."));
  assert.equal(vscode.quickPicks.calls.length, picks, "new-run choices never fall back to another environment");
  assert.equal(posted.some((message) => message.type === "newRun"), false);

  api.selectRun("second", "run-a");
  assert.deepEqual(ready(), [{ type: "selectRun", runId: "run-a" }]);
  const secondFrame = view.webview.html;
  await vscode.commands.executeCommand("ragents.showRuns");
  assert.equal(view.webview.html, secondFrame, "Runs keeps the selected server frame and its plugin sources");
  assert.deepEqual(ready(), [{ type: "showPage", page: "runs" }]);
  posted.length = 0;
  receive({ type: "pageChanged", page: "start" });
  assert.equal(view.webview.html, secondFrame);
  assert.deepEqual(posted, [], "a server page change is observed without a navigation echo");
  assert.deepEqual(ready(), [{ type: "showPage", page: "start" }], "frame readiness restores the page selected in the server interface");
  receive({ type: "pageChanged", page: "runs" });
  appPanels[0].receive({ type: "pageChanged", page: "start" });
  assert.deepEqual(ready(), [{ type: "showPage", page: "runs" }], "another environment cannot change the selected server page");
  await vscode.commands.executeCommand("ragents.showStart");
  assert.equal(view.webview.html, secondFrame);
  assert.deepEqual(ready(), [{ type: "showPage", page: "start" }]);
  receive({ type: "showStart", notice: "This run is no longer available to you." });
  assert.deepEqual(ready(), [{ type: "showPage", page: "start", notice: "This run is no longer available to you." }]);
  const refreshes = { first: 0, second: 0 };
  for (const name of ["first", "second"]) {
    const store = api.session(name).store;
    const refresh = store.refresh.bind(store);
    store.refresh = async () => { refreshes[name]++; await refresh(); };
  }
  posted.length = 0;
  await vscode.commands.executeCommand("ragents.refresh");
  await waitFor(() => refreshes.second === 1);
  assert.equal(refreshes.first, 0);
  assert.equal(posted.some((message) => message.type === "showPage"), false, "Refresh preserves the current server page");

  vscode.quickPicks.answers.push((items) => items.find((item) => item.label === "Manage environments ..."));
  await vscode.commands.executeCommand("ragents.selectEnvironment");
  assert.equal(api.activeEnvironment(), "second");
  assert.doesNotMatch(view.webview.html, /<iframe/);
  assert.deepEqual(managementState().connections.map((entry) => entry.name), ["first", "second"]);
  await vscode.commands.executeCommand("ragents.showRuns");
  assert.equal(assertEnvironment(api, "second").searchParams.has("run"), false);
  assert.deepEqual(ready(), [{ type: "showPage", page: "runs" }], "a recreated frame restores the page after ready");
  await vscode.commands.executeCommand("ragents.showConnections");
  await vscode.commands.executeCommand("ragents.showStart");
  assertEnvironment(api, "second");
  assert.deepEqual(ready(), [{ type: "showPage", page: "start" }]);

  assert.equal(workspaceState.get("ragents.activeEnvironment"), "second");
  await stop();
  api = await extension.activate(context);
  await waitFor(() => ["first", "second"].every((name) => api.session(name)?.status.kind === "connected"
    && api.session(name)?.workspaceClient?.status.kind === "registered"));
  resolveView();
  assertEnvironment(api, "second");
  assert.equal(workspaceState.get("ragents.activeEnvironment"), "second", "reactivation restores the chosen environment instead of the first configured one");

  api.selectRun("second", "run-a");
  await api.panelAction({ action: "deleteRuns", name: "first", runIds: ["run-a"] });
  assertEnvironment(api, "second");
  assert.deepEqual(ready(), [{ type: "selectRun", runId: "run-a" }], "deleting the same run ID on another server leaves the current run open");
  assert.equal(api.session("first").store.runs.some((run) => run.id === "run-a"), false);
  assert.equal(api.session("second").store.runs.some((run) => run.id === "run-a"), true);
  await api.disconnect("first");
  assertEnvironment(api, "second");
  assert.equal(api.session("second").status.kind, "connected");
  assert.equal(api.session("second").workspaceClient.status.kind, "registered");
  assert.deepEqual(ready(), [{ type: "selectRun", runId: "run-a" }]);
  await api.connect("first");
  await api.disconnect("second");
  assert.equal(api.activeEnvironment(), "second", "a stopped environment remains selected");
  assert.doesNotMatch(view.webview.html, /<iframe/);
  assert.deepEqual(managementState().connections.map((entry) => entry.name), ["second"], "the unavailable environment never exposes another server's content");
  assert.equal(api.session("first").status.kind, "connected");
  assert.equal(vscode.contextValues.get("ragents.canCreate"), false);
  await vscode.commands.executeCommand("ragents.showStart");
  assert.deepEqual(managementState().connections.map((entry) => entry.name), ["second"]);
  await api.selectEnvironment("second");
  assertEnvironment(api, "second");
  api.selectRun("second", "run-a");
  await api.panelAction({ action: "deleteRuns", name: "second", runIds: ["run-a"] });
  assert.equal(api.session("second").store.runs.length, 0);
  assert.deepEqual(ready(), [{ type: "showPage", page: "runs" }], "deleting the open run stays on its own environment's Runs page");
  await api.panelAction({ action: "remove", name: "first" });
  await waitFor(() => api.session("first") === undefined);
  assertEnvironment(api, "second");
  await api.panelAction({ action: "remove", name: "second" });
  await waitFor(() => api.activeEnvironment() === undefined);
  assert.doesNotMatch(view.webview.html, /<iframe/);
  assert.deepEqual(managementState().connections, []);
  await stop();
};
process.on("unhandledRejection", (cause) => { console.error(cause); process.exit(4); });
check().then(() => process.exit(0), (cause) => { console.error(cause.stack ?? cause); process.exit(6); });
`;

test("the built bundle loads, activates without node_modules next to it, and runs the actions of the panel page", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-bundle-"));
  try {
    copyFileSync(path.join(extensionRoot, "dist/extension.js"), path.join(directory, "extension.js"));
    copyFileSync(path.join(extensionRoot, "package.json"), path.join(directory, "package.json"));
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

test("the title bar selects one server for Start, Runs, plugin sources, and new-run actions across reconnect and reactivation", async () => {
  const manifest = JSON.parse(readFileSync(path.join(extensionRoot, "package.json"), "utf8"));
  const version = manifest.version as string;
  assert.ok(manifest.contributes.commands.some((entry: { command: string; icon?: string }) => entry.command === "ragents.selectEnvironment" && entry.icon));
  assert.ok(manifest.contributes.menus["view/title"].some((entry: { command: string; when: string; group: string }) =>
    entry.command === "ragents.selectEnvironment" && entry.when === "view == ragents.runPanel" && entry.group.startsWith("navigation@")), "environment selection is a visible button in the view title bar");
  const first = await startStubServer({ version, profile: stubProfile({
    product: { id: "first", title: "First workshop" },
    plugins: [{ id: "ragents.example-first", web: { entry: "/plugins/ragents.example-first/web/index.js" } }],
    startEntries: stubProfile().startEntries.map((entry) => entry.action === "script"
      ? { ...entry, fixedStartOptions: { "ragents.workspace.binding": { machine: "server", folder: "fresh" } } }
      : entry),
  }) });
  const second = await startStubServer({ version, loginRequired: true, userRights: ["runs.read", "runs.write", "runs.inspect", "runs.delete"], profile: stubProfile({
    product: { id: "second", title: "Second workshop" },
    plugins: [{ id: "ragents.example-second", web: { entry: "/plugins/ragents.example-second/web/index.js" } }],
  }) });
  first.setSessions([session({ pendingActions: 2 })]);
  second.setSessions([session({ pendingActions: 5 })]);
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-environments-"));
  try {
    copyFileSync(path.join(extensionRoot, "dist/extension.js"), path.join(directory, "extension.js"));
    copyFileSync(path.join(extensionRoot, "package.json"), path.join(directory, "package.json"));
    writeFileSync(path.join(directory, "vscode.cjs"), VSCODE_STUB);
    writeFileSync(path.join(directory, "check.cjs"), CHECK_ENVIRONMENTS);
    mkdirSync(path.join(directory, "workspace"));
    mkdirSync(path.join(directory, "other-workspace"));
    const configuration = { connections: [{ name: "first", url: first.url }, { name: "second", url: second.url }], token: SESSION_TOKEN };
    const result = await execute(process.execPath, ["check.cjs"], {
      cwd: directory, timeout: 60_000, env: { ...process.env, RAGENTS_TEST_ENVIRONMENTS: JSON.stringify(configuration) },
    }).catch((cause: unknown) => { assert.fail(cause instanceof Error ? cause.message : String(cause)); });
    assert.equal(result.stderr, "");
  } finally {
    await Promise.all([first.close(), second.close()]);
    rmSync(directory, { recursive: true, force: true });
  }
});
