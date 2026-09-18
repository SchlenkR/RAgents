import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserHost, createVsCodeHost } from "../src/column/host.ts";
import type { HostColumnMessage } from "../src/column/host-contract.ts";

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
  assert.equal(host.centerElements("run-a").size, 0);
  assert.throws(() => host.openInCenter("run-a", "board", "Board"), /nur in VS Code/);
  assert.throws(() => host.requestLogin(), /nur in VS Code/);
});

test("the vscode host relays messages to the parent and only accepts valid commands from it", () => {
  const { browser, parent, posted, receive } = fakeWindow();
  const host = createVsCodeHost(browser);
  const commands: HostColumnMessage[] = [];
  host.onCommand((message) => commands.push(message));
  let placementsChanged = 0;
  host.subscribe(() => { placementsChanged += 1; });
  host.openInCenter("run-a", "board--main", "Sammelboard");
  host.notify({ type: "runChanged", runId: "run-a" });
  assert.deepEqual(posted.map((entry) => entry.message), [
    { type: "openInCenter", runId: "run-a", elementId: "board--main", title: "Sammelboard" },
    { type: "runChanged", runId: "run-a" },
  ]);
  receive({}, { type: "selectRun", runId: "run-b" });
  receive(parent, { type: "selectRun", runId: 42 });
  receive(parent, { type: "placements", runId: "run-a", center: ["board--main"] });
  receive(parent, { type: "theme", theme: "dark" });
  assert.deepEqual(commands, [{ type: "placements", runId: "run-a", center: ["board--main"] }, { type: "theme", theme: "dark" }]);
  assert.deepEqual([...host.centerElements("run-a")], ["board--main"]);
  assert.equal(host.centerElements("run-b").size, 0);
  assert.equal(placementsChanged, 1);
});

test("a vscode host without an embedding page is an error", () => {
  const browser = { parent: undefined as unknown } as unknown as Window;
  (browser as unknown as { parent: unknown }).parent = browser;
  assert.throws(() => createVsCodeHost(browser), /kein Webview/);
});
