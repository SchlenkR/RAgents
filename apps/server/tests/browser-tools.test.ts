import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext, ToolResultEvent } from "@aicontainer/agent";
import type { Browser, Page } from "playwright-core";
import { RunBrowser, browserLocator } from "../../../plugins/ragents.browser/server/browser.ts";
import { createBrowserFunctions, createBrowserImageContribution } from "../../../plugins/ragents.browser/server/tools.ts";

test("Browserziele sind eindeutig beschrieben und benötigen keine Element-IDs", () => {
  const locator = (role: string, input: unknown, pick?: string | number) => ({ role, input, pick, first: () => locator(role, input, "first"), nth: (index: number) => locator(role, input, index) });
  const page = { getByRole: (role: string, input: unknown) => locator(role, input) } as unknown as Page;
  const resolved = (target: Parameters<typeof browserLocator>[1]) => { const { first: _first, nth: _nth, ...rest } = browserLocator(page, target) as unknown as ReturnType<typeof locator>; return rest; };
  assert.deepEqual(resolved({ role: "button", name: "Speichern" }), { role: "button", input: { name: "Speichern", exact: true }, pick: undefined });
  assert.deepEqual(resolved({ role: "button", first: true }), { role: "button", input: { name: undefined, exact: true }, pick: "first" });
  assert.deepEqual(resolved({ role: "button", nth: 2 }), { role: "button", input: { name: undefined, exact: true }, pick: 2 });
  assert.throws(() => browserLocator(page, {}), /genau role/);
  assert.throws(() => browserLocator(page, { name: "Speichern" }), /genau role/);
  assert.throws(() => browserLocator(page, { role: "button", css: "button" }), /genau role/);
  assert.throws(() => browserLocator(page, { role: "button", nth: 1, first: true }), /entweder nth oder first/);
});

test("Browserwerkzeuge deklarieren typisierte Ergebnisse und eine eigene native Bildanzeige", () => {
  const browser = new RunBrowser({ filesFor: async () => "/unused" });
  const functions = createBrowserFunctions(browser);
  assert.equal(functions.length, 11);
  const viewport = functions.find((entry) => entry.name === "browser_viewport");
  assert.deepEqual(Object.keys(viewport!.schema.properties), ["width", "height"]);
  const check = functions.find((entry) => entry.name === "browser_check");
  assert.deepEqual(Object.keys(check!.schema.properties), ["target", "text", "url", "count", "noErrors"]);
  const click = functions.find((entry) => entry.name === "browser_click");
  assert.deepEqual(Object.keys((click!.schema.properties as { target: { properties: object } }).target.properties), ["role", "name", "label", "text", "testId", "css", "frame", "nth", "first"]);
  for (const fn of functions) {
    assert.ok(fn.schema);
    assert.ok(fn.resultSchema);
    assert.equal(fn.executionMode, "sequential");
  }
  assert.equal(functions.find((entry) => entry.name === "browser_view_screenshot")?.nativeTool, true);
});

test("Native Bildanzeige löst den Run serverseitig auf und weist Modelle ohne Bilder ab", async () => {
  const requested: string[] = [];
  class ImageBrowser extends RunBrowser {
    override async image(runId: string): Promise<Buffer> {
      requested.push(runId);
      return Buffer.from("screenshot");
    }
  }
  const browser = new ImageBrowser({ filesFor: async () => "/unused" });
  const contribution = createBrowserImageContribution(browser);
  const extensions = await contribution.resolve!({ runId: "this-run", agentId: "actor", audience: "agent", workspace: "/unused" });
  const extension = extensions[0];
  assert.equal(typeof extension, "object");
  if (typeof extension === "function") throw new Error("Named extension expected");
  type Handler = (event: ToolResultEvent, context: ExtensionContext) => Promise<{ content?: unknown; isError?: boolean } | undefined>;
  let handler: Handler | undefined;
  await extension.factory({ on: (event: string, registered: Handler) => { assert.equal(event, "tool_result"); handler = registered; } } as never, {} as never);
  assert.ok(handler);
  const event = { toolName: "browser_view_screenshot", isError: false } as ToolResultEvent;
  const rejected = await handler(event, { model: { input: ["text"] } } as never);
  assert.equal(rejected?.isError, true);
  assert.match(JSON.stringify(rejected?.content), /unterstützt keine Bilder/);
  assert.deepEqual(requested, []);
  const result = await handler(event, { model: { input: ["text", "image"] } } as never);
  assert.deepEqual(requested, ["this-run"]);
  assert.deepEqual(result?.content, [
    { type: "text", text: "Letzte Browseraufnahme dieses Runs." },
    { type: "image", data: Buffer.from("screenshot").toString("base64"), mimeType: "image/png" },
  ]);
  assert.equal(await handler({ ...event, toolName: "browser_snapshot" }, {} as never), undefined);
  assert.equal(await handler({ ...event, isError: true }, {} as never), undefined);
});

test("Fehlender Browser und Aufnahmen sind klare Fehler ohne künstlichen Erfolg", async () => {
  const browser = new RunBrowser({ filesFor: async () => "/unused", executablePath: "/no-such-ragents-browser" });
  await assert.rejects(browser.open("one", "http://127.0.0.1"), /BROWSER_EXECUTABLE_PATH/);
  await assert.rejects(browser.image("one"), /noch keinen Browser-Screenshot/);
  await assert.rejects(browser.snapshot("other"), /Zuerst browser_open/);
  await assert.rejects(browser.open("other", "file:///etc/hosts"), /HTTP- oder HTTPS/);
  await browser.shutdown();
  await assert.rejects(browser.open("one", "http://127.0.0.1"), /Browserdienst ist beendet/);
});

test("Run-Stopp schließt auch einen noch startenden Browser und startet keine Seite", async () => {
  let finishLaunch!: (browser: Browser) => void;
  let closed = 0;
  let contexts = 0;
  const browser = new RunBrowser({
    filesFor: async () => "/unused",
    launch: () => new Promise((resolve) => { finishLaunch = resolve; }),
  });
  await browser.restore("one");
  const opened = browser.open("one", "http://127.0.0.1");
  await Promise.resolve();
  const rejected = assert.rejects(opened, /Browser wurde beendet/);
  const stopped = browser.close("one");
  finishLaunch({
    close: async () => { closed += 1; },
    newContext: async () => { contexts += 1; throw new Error("unexpected context"); },
  } as unknown as Browser);
  await Promise.all([rejected, stopped]);
  assert.equal(closed, 1);
  assert.equal(contexts, 0);
  assert.deepEqual(browser.evidence("one"), { screenshots: [], currentScreenshots: [], errors: [] });
});

test("Bereits abgebrochene Browseröffnung startet keinen Prozess", async () => {
  let launches = 0;
  const browser = new RunBrowser({ filesFor: async () => "/unused", launch: async () => { launches += 1; throw new Error("unexpected launch"); } });
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(browser.open("one", "http://127.0.0.1", abort.signal), /abort/i);
  assert.equal(launches, 0);
});
