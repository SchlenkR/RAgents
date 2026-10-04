import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserHost, createVsCodeHost } from "../src/run-panel/host.ts";
import { isHostRunPanelMessage, isRunPanelHostMessage, type HostRunPanelMessage } from "../src/run-panel/host-contract.ts";

const fakeWindow = () => {
  const listeners: Array<(event: { source: unknown; data: unknown }) => void> = [];
  const posted: Array<{ message: unknown; origin: string }> = [];
  const parent = { postMessage: (message: unknown, origin: string) => posted.push({ message, origin }) };
  const opened: string[] = [];
  const browser = {
    parent,
    addEventListener: (_type: string, listener: (event: { source: unknown; data: unknown }) => void) => listeners.push(listener),
    open: (url: string) => opened.push(url),
  };
  const receive = (source: unknown, data: unknown) => { for (const listener of listeners) listener({ source, data }); };
  return { browser: browser as unknown as Window, parent, posted, opened, receive };
};

test("the browser host opens links itself and refuses host-only actions loudly", () => {
  const { browser, opened } = fakeWindow();
  const host = createBrowserHost(browser);
  host.openExternal("http://localhost:4710/");
  assert.deepEqual(opened, ["http://localhost:4710/"]);
  assert.equal(host.machines, "server", "the browser starts new runs only on the server");
  assert.throws(() => host.openApp("run-a", "board", "Board"), /only available in VS Code/);
  assert.throws(() => host.requestLogin(), /only available in VS Code/);
});

test("the vscode host relays messages to the parent and only accepts valid commands from it", () => {
  const { browser, parent, posted, receive } = fakeWindow();
  const host = createVsCodeHost(browser);
  assert.equal(host.machines, "all", "VS Code offers workstations for new runs too");
  const commands: HostRunPanelMessage[] = [];
  host.onCommand((message) => commands.push(message));
  host.openApp("run-a", "board--main", "Collection board");
  host.notify({ type: "runChanged", runId: "run-a" });
  host.notify({ type: "showStart" });
  host.notify({ type: "newRun", entryId: "demo.board" });
  assert.deepEqual(posted.map((entry) => entry.message), [
    { type: "openInCenter", runId: "run-a", elementId: "board--main", title: "Collection board" },
    { type: "runChanged", runId: "run-a" },
    { type: "showStart" },
    { type: "newRun", entryId: "demo.board" },
  ]);
  receive({}, { type: "selectRun", runId: "run-b" });
  receive(parent, { type: "selectRun", runId: 42 });
  receive(parent, { type: "theme", theme: "dark" });
  receive(parent, { type: "newRun", startOptions: { "ragents.workspace.binding": { machine: "server", folder: "fresh" } } });
  receive(parent, { type: "newRun", startOptions: [] });
  receive(parent, { type: "showPage", page: "runs" });
  receive(parent, { type: "showPage", page: "start", notice: "The run is no longer shared." });
  receive(parent, { type: "showPage", page: "connections" });
  assert.deepEqual(commands, [
    { type: "theme", theme: "dark" },
    { type: "newRun", startOptions: { "ragents.workspace.binding": { machine: "server", folder: "fresh" } } },
    { type: "showPage", page: "runs" },
    { type: "showPage", page: "start", notice: "The run is no longer shared." },
  ]);
});

test("server page commands accept Start and Runs with a notice, and a start request carries only its template", () => {
  assert.equal(isHostRunPanelMessage({ type: "showPage", page: "start" }), true);
  assert.equal(isHostRunPanelMessage({ type: "showPage", page: "runs", notice: "The run was removed." }), true);
  for (const invalid of [{ page: "connections" }, { page: "run" }, { page: undefined }, { page: "start", notice: 3 }, { page: "start", notice: "" }]) {
    assert.equal(isHostRunPanelMessage({ type: "showPage", ...invalid }), false, JSON.stringify(invalid));
  }
  assert.equal(isRunPanelHostMessage({ type: "newRun" }), true);
  assert.equal(isRunPanelHostMessage({ type: "newRun", entryId: "demo.board" }), true);
  assert.equal(isRunPanelHostMessage({ type: "newRun", entryId: "" }), false);
  assert.equal(isRunPanelHostMessage({ type: "newRun", entryId: 3 }), false);
  assert.equal(isRunPanelHostMessage({ type: "pageChanged", page: "start" }), true);
  assert.equal(isRunPanelHostMessage({ type: "pageChanged", page: "runs" }), true);
  assert.equal(isRunPanelHostMessage({ type: "pageChanged", page: "connections" }), false);
  assert.equal(isRunPanelHostMessage({ type: "pageChanged", page: undefined }), false);
});

test("a vscode host without an embedding page is an error", () => {
  const browser = { parent: undefined as unknown } as unknown as Window;
  (browser as unknown as { parent: unknown }).parent = browser;
  assert.throws(() => createVsCodeHost(browser), /not embedded in a webview/);
});

test("the back arrow reports the intent, not only its consequence", () => {
  assert.equal(isRunPanelHostMessage({ type: "showStart" }), true);
  assert.equal(isRunPanelHostMessage({ type: "showStart", runId: "run-a" }), true, "additional fields do not disturb the intent");
  assert.equal(isRunPanelHostMessage({ type: "showStart", notice: "This run is no longer available to you." }), true, "a notice for Start travels along");
  assert.equal(isRunPanelHostMessage({ type: "showStart", notice: 3 }), false);
  assert.equal(isRunPanelHostMessage({ type: "showstart" }), false);
  assert.equal(isRunPanelHostMessage({ type: "runChanged", runId: null }), true);
});

test("a service of a run goes to the VS Code host with its machine and tunnel method; the browser cannot open a tunnel", () => {
  const service = { runId: "run-a", port: 5173, workstation: "client-0001", tunnel: "example.processes.tunnel" };
  const { browser, posted } = fakeWindow();
  createVsCodeHost(browser).openService(service);
  assert.deepEqual(posted.map((entry) => entry.message), [{ type: "openService", ...service }]);
  assert.equal(isRunPanelHostMessage({ type: "openService", ...service }), true);
  assert.equal(isRunPanelHostMessage({ type: "openService", ...service, workstation: null }), true, "a run on the server names no workstation");
  for (const invalid of [{ port: 0 }, { port: 65536 }, { port: 80.5 }, { workstation: "" }, { tunnel: "" }, { tunnel: undefined }, { runId: undefined }]) {
    assert.equal(isRunPanelHostMessage({ type: "openService", ...service, ...invalid }), false, JSON.stringify(invalid));
  }
  assert.throws(() => createBrowserHost(fakeWindow().browser).openService(service), /only available in VS Code/);
});
