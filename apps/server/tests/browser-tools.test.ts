import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { Browser } from "playwright-core";
import { isNativeTool } from "@ragents/engine";
import { WorkspaceOperationExecutor, executorMachine, workspaceProcessContext } from "@ragents/workspace-executor";
import { browserModule, type BrowserModuleOptions } from "../../../plugins/ragents.browser/executor/module.ts";
import { RunBrowser } from "../../../plugins/ragents.browser/server/browser.ts";
import { createBrowserFunctions, createBrowserImageContribution } from "../../../plugins/ragents.browser/server/tools.ts";
import { stubBrowser, type StubDocument } from "./browser-stub.ts";

const unusedSandbox = { execute: async () => { throw new Error("This test calls no executor"); } };

const site: Readonly<Record<string, StubDocument>> = {
  "/": {
    title: "Draft",
    elements: [
      { role: "button", name: "Save", onClick: (page) => page.show({ role: "status", name: "Saved" }) },
      { role: "button", name: "Next", onClick: (page) => page.navigate("/two") },
    ],
  },
  "/two": { title: "Second page", elements: [] },
};

/** The server part on top of the server's executor; the browser itself is a module of that executor. */
const localBrowser = (options: BrowserModuleOptions, filesFor: (runId: string) => Promise<string> = async () => "/unused") => {
  const executor = new WorkspaceOperationExecutor({
    contextFor: async (runId) => workspaceProcessContext({
      runId, cwd: tmpdir(), root: tmpdir(), home: { home: tmpdir() }, logDirectory: tmpdir(), hostRoot: undefined,
    }),
    modules: [browserModule(executorMachine("/unused"), { timeoutMs: 500, checkTimeoutMs: 50, ...options })],
  });
  return { browser: new RunBrowser({ sandbox: executor, filesFor }), executor };
};

const documentsIn = async (t: TestContext): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-browser-documents-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

test("browser tools carry the Playwright MCP names, declare typed results and their own native image display", () => {
  const browser = new RunBrowser({ sandbox: unusedSandbox, filesFor: async () => "/unused" });
  const functions = createBrowserFunctions(browser);
  const fields = (name: string) => Object.keys((functions.find((entry) => entry.name === name)!.schema as { properties: object }).properties);
  assert.deepEqual(functions.map((entry) => entry.name), [
    "browser_navigate", "browser_snapshot", "browser_click", "browser_type", "browser_select_option", "browser_press_key",
    "browser_check", "browser_resize", "browser_take_screenshot", "browser_view_screenshot", "browser_close",
  ]);
  assert.deepEqual(fields("browser_navigate"), ["url"]);
  assert.deepEqual(fields("browser_type"), ["target", "text", "submit", "slowly"]);
  assert.deepEqual(fields("browser_select_option"), ["target", "values"]);
  assert.deepEqual(fields("browser_press_key"), ["key", "target"]);
  assert.deepEqual(fields("browser_resize"), ["width", "height"]);
  assert.deepEqual(fields("browser_take_screenshot"), ["label", "fullPage"]);
  assert.deepEqual(fields("browser_check"), ["target", "text", "url", "count", "noErrors"]);
  const click = functions.find((entry) => entry.name === "browser_click");
  assert.deepEqual(Object.keys((click!.schema.properties as { target: { properties: object } }).target.properties), ["role", "name", "label", "text", "testId", "css", "frame", "nth", "first"]);
  for (const fn of functions) {
    assert.ok(fn.schema);
    assert.ok(fn.resultSchema);
    assert.equal(fn.executionMode, "sequential");
  }
  assert.deepEqual(functions.filter((entry) => !isNativeTool(entry)).map((entry) => entry.name), []);
});

test("the native image display resolves the run on the server and rejects models without images", async () => {
  const requested: string[] = [];
  class ImageBrowser extends RunBrowser {
    override async image(runId: string): Promise<Buffer> {
      requested.push(runId);
      return Buffer.from("screenshot");
    }
  }
  const browser = new ImageBrowser({ sandbox: unusedSandbox, filesFor: async () => "/unused" });
  const contribution = createBrowserImageContribution(browser);
  const agent = { runId: "this-run", agentId: "actor", audience: "agent" as const, workspace: "/unused" };
  const handler = (outcome: { toolName: string; isError: boolean }, modelReadsImages: boolean) =>
    contribution.afterToolCall!(agent, outcome, { signal: undefined, modelReadsImages });
  const outcome = { toolName: "browser_view_screenshot", isError: false };
  const rejected = await handler(outcome, false);
  assert.equal(rejected?.isError, true);
  assert.match(JSON.stringify(rejected?.content), /does not support images/);
  assert.deepEqual(requested, []);
  const result = await handler(outcome, true);
  assert.deepEqual(requested, ["this-run"]);
  assert.deepEqual(result?.content, [
    { type: "text", text: "Latest browser screenshot of this run." },
    { type: "image", data: Buffer.from("screenshot").toString("base64"), mimeType: "image/png" },
  ]);
  assert.equal(await handler({ ...outcome, toolName: "browser_snapshot" }, true), undefined);
  assert.equal(await handler({ ...outcome, isError: true }, true), undefined);
});

test("a missing browser and missing screenshots are clear errors without artificial success", async () => {
  const { browser } = localBrowser({ launch: async () => { throw new Error("No executable browser: set BROWSER_EXECUTABLE_PATH"); } });
  await assert.rejects(browser.navigate("one", "http://127.0.0.1"), /BROWSER_EXECUTABLE_PATH/);
  assert.equal(browser.evidence("one").url, undefined);
  await assert.rejects(browser.image("one"), /no browser screenshot for this run yet/);
  await assert.rejects(browser.snapshot("other"), /Call browser_navigate first/);
  await assert.rejects(browser.navigate("other", "file:///etc/hosts"), /HTTP or HTTPS/);
  await browser.shutdown();
  await assert.rejects(browser.navigate("one", "http://127.0.0.1"), /browser service has ended/);
});

test("a run stop also closes a browser that is still starting and opens no page", async () => {
  let finishLaunch: ((browser: Browser) => void) | undefined;
  let closed = 0;
  let contexts = 0;
  const { browser } = localBrowser({ launch: () => new Promise((resolve) => { finishLaunch = resolve; }) });
  await browser.restore("one");
  const opened = browser.navigate("one", "http://127.0.0.1");
  const rejected = assert.rejects(opened, /browser was closed/);
  while (!finishLaunch) await new Promise((resolve) => setTimeout(resolve, 5));
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

test("an already aborted browser open starts no process", async () => {
  let launches = 0;
  const { browser } = localBrowser({ launch: async () => { launches += 1; throw new Error("unexpected launch"); } });
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(browser.navigate("one", "http://127.0.0.1", { signal: abort.signal }), /abort/i);
  assert.equal(launches, 0);
});

test("the server holds the evidence: check time by its clock, screenshots in its storage, viewport across the browser restart", async (t) => {
  const documents = await documentsIn(t);
  const stub = stubBrowser(site);
  const { browser } = localBrowser({ launch: stub.launch }, async (runId) => path.join(documents, runId));
  t.after(() => browser.shutdown());

  await browser.navigate("one", "http://localhost:4173/");
  assert.deepEqual(browser.evidence("one"), { url: "http://localhost:4173/", screenshots: [], currentScreenshots: [], errors: [] });
  await browser.click("one", { role: "button", name: "Save" });
  const before = Date.now();
  const checked = await browser.check("one", { target: { role: "status" }, text: "Saved" });
  assert.ok(Date.parse(checked.checkedAt) >= before - 1 && Date.parse(checked.checkedAt) <= Date.now());
  assert.equal(browser.evidence("one").checkedAt, checked.checkedAt);

  const shot = await browser.takeScreenshot("one", { label: "Saved" });
  assert.match(shot.path, /^browser\/[a-f0-9-]{36}\.png$/);
  assert.equal(await readFile(path.join(documents, "one", shot.path), "utf8"), "PNG 1920x1080");
  assert.equal((await browser.image("one")).toString(), "PNG 1920x1080");
  assert.match(shot.url, /^\/api\/plugins\/ragents.documents\/runs\/one\/files\/content\?path=browser/);
  await browser.snapshot("one");
  assert.deepEqual(browser.evidence("one"), {
    checkedAt: checked.checkedAt,
    url: "http://localhost:4173/",
    screenshots: [{ name: "Saved", url: shot.url }],
    currentScreenshots: [{ name: "Saved", url: shot.url }],
    errors: [],
  });

  stub.page().consoleError("Reported later");
  await assert.rejects(browser.check("one", { noErrors: true }), /Reported later/);
  assert.equal(browser.evidence("one").checkedAt, undefined, "a failed check discards the time on the server as well");
  assert.deepEqual(browser.evidence("one").errors, ["Console: Reported later"]);
  await browser.check("one", { text: "Saved", noErrors: false });
  await browser.click("one", { role: "button", name: "Next" });
  assert.deepEqual(browser.evidence("one"), {
    url: "http://localhost:4173/two",
    screenshots: [{ name: "Saved", url: shot.url }],
    currentScreenshots: [],
    errors: [],
  });

  await browser.resize("one", { width: 390, height: 844 });
  await browser.close("one");
  assert.equal(stub.log.closes, 1);
  assert.equal(browser.evidence("one").url, undefined);
  await browser.navigate("one", "http://localhost:4173/");
  const narrow = await browser.takeScreenshot("one", { label: "Narrow" });
  assert.equal(await readFile(path.join(documents, "one", narrow.path), "utf8"), "PNG 390x844");

  const restored = new RunBrowser({ sandbox: unusedSandbox, filesFor: async (runId) => path.join(documents, runId) });
  await restored.restore("one");
  assert.deepEqual(restored.evidence("one").screenshots.map((entry) => entry.name), ["Saved", "Narrow"]);
  assert.equal((await restored.image("one")).toString(), "PNG 390x844");
});

test("simultaneous screenshots of a run all end up in the screenshot list", async (t) => {
  const documents = await documentsIn(t);
  const { browser } = localBrowser({ launch: stubBrowser(site).launch }, async () => documents);
  t.after(() => browser.shutdown());
  await browser.navigate("one", "http://localhost:4173/");
  await Promise.all(["A", "B", "C"].map((label) => browser.takeScreenshot("one", { label })));
  const manifest = JSON.parse(await readFile(path.join(documents, "browser", ".captures.json"), "utf8")) as { name: string }[];
  assert.deepEqual(manifest.map((entry) => entry.name).sort(), ["A", "B", "C"]);
  assert.equal(browser.evidence("one").currentScreenshots.length, 3);
});
