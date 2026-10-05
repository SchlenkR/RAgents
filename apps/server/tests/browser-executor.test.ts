import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright-core";
import { WorkspaceOperationError, WorkspaceOperationExecutor, executorMachine, workspaceProcessContext } from "@ragents/workspace-executor";
import {
  BROWSER_EXECUTABLE_VARIABLE,
  BROWSER_OPERATIONS,
  type BrowserCheckResult,
  type BrowserPageState,
  type BrowserSnapshot,
  type BrowserStep,
} from "../../../plugins/ragents.browser/executor/contract.ts";
import { browserModule, type BrowserModuleOptions } from "../../../plugins/ragents.browser/executor/module.ts";
import { browserLocator } from "../../../plugins/ragents.browser/executor/pages.ts";
import { browserExecutable, hostPlaywright } from "../../../plugins/ragents.browser/executor/playwright.ts";
import { stubBrowser, type StubDocument } from "./browser-stub.ts";

const machine = executorMachine("/unused");

const hostRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const site: Readonly<Record<string, StubDocument>> = {
  "/": {
    title: "Draft",
    elements: [
      { role: "button", name: "Save", onClick: (page) => page.show({ role: "status", name: "Saved" }) },
      { role: "button", name: "Raise error", onClick: (page) => page.consoleError("Intentional error") },
      { role: "button", name: "Next", onClick: (page) => page.navigate("/two") },
      { role: "textbox", name: "Title", label: "Title" },
    ],
  },
  "/two": { title: "Second page", elements: [{ role: "link", name: "Back" }, { role: "link", name: "Start" }] },
};

const viewport = { width: 1280, height: 720 };

const executorWith = (options: BrowserModuleOptions) => new WorkspaceOperationExecutor({
  contextFor: async (runId) => workspaceProcessContext({
    runId, cwd: tmpdir(), root: tmpdir(), home: { home: tmpdir() }, logDirectory: tmpdir(), hostRoot: undefined,
  }),
  modules: [browserModule(machine, { timeoutMs: 500, checkTimeoutMs: 50, ...options })],
});

const coded = (code: string) => (error: unknown): boolean => error instanceof WorkspaceOperationError && error.code === code;

test("a run's page lives in the module: every operation reports its result and the page state", async (t) => {
  const stub = stubBrowser(site);
  const executor = executorWith({ launch: stub.launch });
  t.after(() => executor.shutdown());
  const run = <T>(operation: string, input: unknown = null) => executor.execute("run-1", operation, input) as Promise<BrowserStep<T>>;

  const opened = await run<BrowserSnapshot>(BROWSER_OPERATIONS.navigate, { url: "http://localhost:4173/", viewport });
  assert.equal(opened.result.title, "Draft");
  assert.match(opened.result.snapshot, /button "Save" \[ref=e1\]/);
  assert.deepEqual(opened.page, { url: "http://localhost:4173/", checked: false, errors: [], screenshots: [] });

  await run(BROWSER_OPERATIONS.type, { target: { label: "Title" }, text: "New" });
  const clicked = await run<BrowserSnapshot>(BROWSER_OPERATIONS.click, { target: { role: "button", name: "Save" } });
  assert.match(clicked.result.snapshot, /status "Saved"/);
  const checked = await run<BrowserCheckResult>(BROWSER_OPERATIONS.check, { target: { role: "status" }, text: "Saved" });
  assert.deepEqual(checked.result, { url: "http://localhost:4173/", assertions: ["Target text is visible"], errors: [] });
  assert.equal(checked.page.checked, true);

  const shot = await run<string>(BROWSER_OPERATIONS.takeScreenshot, { id: "capture-1", fullPage: false });
  assert.equal(Buffer.from(shot.result, "base64").toString(), "PNG 1280x720");
  assert.deepEqual(shot.page, { url: "http://localhost:4173/", checked: true, errors: [], screenshots: ["capture-1"] });
  await run(BROWSER_OPERATIONS.resize, { width: 390, height: 844 });
  const narrow = await run<string>(BROWSER_OPERATIONS.takeScreenshot, { id: "capture-2", fullPage: true });
  assert.equal(Buffer.from(narrow.result, "base64").toString(), "PNG 390x844 full page");
  assert.deepEqual(narrow.page.screenshots, ["capture-2"]);
  assert.equal((await run<BrowserSnapshot>(BROWSER_OPERATIONS.snapshot)).page.checked, false);

  const pressed = await run(BROWSER_OPERATIONS.pressKey, { target: { label: "Title" }, key: "Enter" });
  assert.deepEqual(pressed.page, { url: "http://localhost:4173/", checked: false, errors: [], screenshots: [] });
  await run(BROWSER_OPERATIONS.check, { text: "Saved" });
  const focused = await run(BROWSER_OPERATIONS.pressKey, { key: "Escape" });
  assert.equal(focused.page.checked, false, "a key on the focused element is an action as well");
  await run(BROWSER_OPERATIONS.selectOption, { target: { label: "Title" }, values: ["Bug", "Feature"] });
  await run(BROWSER_OPERATIONS.type, { target: { label: "Title" }, text: "Slow", slowly: true, submit: true });
  assert.deepEqual(stub.log.actions, ["fill Title=New", "click Save", "press Title Enter", "press Escape", "select Title=Bug,Feature", "type Title=Slow", "press Title Enter"]);

  stub.page().consoleError("Reported later");
  assert.deepEqual((await executor.execute("run-1", BROWSER_OPERATIONS.state, null) as BrowserPageState).errors, ["Console: Reported later"]);
  await assert.rejects(run(BROWSER_OPERATIONS.check, { noErrors: true }), /Browser errors: Console: Reported later/);
  const failed = await executor.execute("run-1", BROWSER_OPERATIONS.state, null) as BrowserPageState;
  assert.equal(failed.checked, false);
  await run(BROWSER_OPERATIONS.check, { text: "Saved", noErrors: false });
  const navigated = await run<BrowserSnapshot>(BROWSER_OPERATIONS.click, { target: { role: "button", name: "Next" } });
  assert.equal(navigated.result.title, "Second page");
  assert.deepEqual(navigated.page, { url: "http://localhost:4173/two", checked: false, errors: [], screenshots: [] });
  assert.equal(stub.log.launches, 1);
  assert.equal(stub.log.contexts, 1);
});

test("ambiguous, missing and invalid inputs are errors with a cause", async (t) => {
  const stub = stubBrowser(site);
  const executor = executorWith({ launch: stub.launch });
  t.after(() => executor.shutdown());
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.snapshot, null), /No browser is open for this run. Call browser_navigate first/);
  assert.equal(await executor.execute("run-1", BROWSER_OPERATIONS.state, null), null);
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.navigate, { url: "file:///etc/hosts", viewport }), /HTTP or HTTPS/);
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.navigate, { url: "http://localhost/" }), coded("browser-input-invalid"));
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.navigate, { url: "http://localhost/", viewport: { width: 0, height: 10 } }), coded("browser-input-invalid"));
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.navigate, "http://localhost/"), coded("browser-input-invalid"));
  assert.equal(stub.log.launches, 0);

  await executor.execute("run-1", BROWSER_OPERATIONS.navigate, { url: "http://localhost/two", viewport });
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.click, {}), coded("browser-input-invalid"));
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.click, { target: { role: "link" } }),
    /Target matches several elements: \[0\] link "Back"; \[1\] link "Start"[\s\S]*target.nth \(0-based\), first: true/);
  await executor.execute("run-1", BROWSER_OPERATIONS.click, { target: { role: "link", nth: 1 } });
  await executor.execute("run-1", BROWSER_OPERATIONS.check, { target: { role: "link" }, count: 2 });
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.check, { target: { role: "link" }, count: 3 }), /Expected 3 visible matches, found 2/);
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.check, {}), /at least target, text, url or noErrors/);
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.takeScreenshot, { fullPage: true }), coded("browser-input-invalid"));
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.selectOption, { target: { role: "link", first: true }, values: [] }), coded("browser-input-invalid"));
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.type, { target: { role: "link", first: true }, text: "x", submit: "yes" }), coded("browser-input-invalid"));
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.pressKey, { target: "link", key: "Enter" }), coded("browser-input-invalid"));
  await assert.rejects(executor.execute("run-1", BROWSER_OPERATIONS.navigate, { url: "http://localhost/missing", viewport }), /Browser navigation failed: HTTP 404/);
  assert.deepEqual((await executor.execute("run-1", BROWSER_OPERATIONS.state, null) as BrowserPageState).errors, ["HTTP 404: http://localhost/missing"]);
});

test("close, run stop and shutdown end the browser; after the shutdown none starts anymore", async () => {
  const stub = stubBrowser(site);
  const executor = executorWith({ launch: stub.launch });
  await executor.execute("one", BROWSER_OPERATIONS.navigate, { url: "http://localhost/", viewport });
  assert.equal(await executor.execute("one", BROWSER_OPERATIONS.close, null), null);
  assert.equal(stub.log.closes, 1);
  assert.equal(await executor.execute("one", BROWSER_OPERATIONS.state, null), null);
  assert.equal(await executor.execute("one", BROWSER_OPERATIONS.close, null), null);
  assert.equal(stub.log.closes, 1);

  await executor.execute("one", BROWSER_OPERATIONS.navigate, { url: "http://localhost/", viewport });
  await executor.execute("two", BROWSER_OPERATIONS.navigate, { url: "http://localhost/", viewport });
  await executor.stopRun("one");
  assert.equal(stub.log.closes, 2);
  assert.notEqual(await executor.execute("two", BROWSER_OPERATIONS.state, null), null);
  await executor.shutdown();
  assert.equal(stub.log.closes, 3);
  assert.equal(await executor.execute("two", BROWSER_OPERATIONS.state, null), null);
  await assert.rejects(executor.execute("two", BROWSER_OPERATIONS.navigate, { url: "http://localhost/", viewport }), /The browser service of this executor has ended/);
  await assert.rejects(executor.execute("two", BROWSER_OPERATIONS.snapshot, null), /The browser service of this executor has ended/);
  assert.equal(await executor.execute("two", BROWSER_OPERATIONS.close, null), null);
  assert.equal(stub.log.launches, 3);
  await executor.shutdown();
});

test("abort and stop during the launch close the browser without opening a page", async () => {
  let launches = 0;
  let finishLaunch!: (browser: Browser) => void;
  const executor = executorWith({ launch: () => {
    launches += 1;
    return new Promise((resolve) => { finishLaunch = resolve; });
  } });
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(executor.execute("one", BROWSER_OPERATIONS.navigate, { url: "http://localhost/", viewport }, { signal: aborted.signal }), /abort/i);
  assert.equal(launches, 0);

  const opened = executor.execute("one", BROWSER_OPERATIONS.navigate, { url: "http://localhost/", viewport });
  const rejected = assert.rejects(opened, /browser was closed/);
  assert.equal(launches, 1);
  let closed = 0;
  let contexts = 0;
  const stopped = executor.stopRun("one");
  finishLaunch({
    close: async () => { closed += 1; },
    newContext: async () => { contexts += 1; throw new Error("unexpected context"); },
  } as unknown as Browser);
  await Promise.all([rejected, stopped]);
  assert.equal(closed, 1);
  assert.equal(contexts, 0);

  const stub = stubBrowser({ "/": { title: "Slow", elements: [{ role: "button", name: "Hangs", onClick: () => new Promise(() => undefined) }] } });
  const slow = executorWith({ launch: stub.launch });
  await slow.execute("one", BROWSER_OPERATIONS.navigate, { url: "http://localhost/", viewport });
  const queued = new AbortController();
  queued.abort();
  await assert.rejects(slow.execute("one", BROWSER_OPERATIONS.snapshot, null, { signal: queued.signal }), /abort/i);
  assert.notEqual(await slow.execute("one", BROWSER_OPERATIONS.state, null), null, "an abort before the start leaves the browser open");
  const abort = new AbortController();
  const pending = slow.execute("one", BROWSER_OPERATIONS.click, { target: { role: "button", name: "Hangs" } }, { signal: abort.signal });
  const ended = assert.rejects(pending, /closed|abort/i);
  while (!stub.log.actions.includes("click Hangs")) await new Promise((resolve) => setTimeout(resolve, 5));
  abort.abort();
  await ended;
  assert.equal(stub.log.closes, 1);
  assert.equal(await slow.execute("one", BROWSER_OPERATIONS.state, null), null);
  await slow.shutdown();
});

test("browser targets are described unambiguously and need no element ids", () => {
  const locator = (role: string, input: unknown, pick?: string | number) => ({ role, input, pick, first: () => locator(role, input, "first"), nth: (index: number) => locator(role, input, index) });
  const page = { getByRole: (role: string, input: unknown) => locator(role, input) } as unknown as Page;
  const resolved = (target: Parameters<typeof browserLocator>[1]) => { const { first: _first, nth: _nth, ...rest } = browserLocator(page, target) as unknown as ReturnType<typeof locator>; return rest; };
  assert.deepEqual(resolved({ role: "button", name: "Save" }), { role: "button", input: { name: "Save", exact: true }, pick: undefined });
  assert.deepEqual(resolved({ role: "button", first: true }), { role: "button", input: { name: undefined, exact: true }, pick: "first" });
  assert.deepEqual(resolved({ role: "button", nth: 2 }), { role: "button", input: { name: undefined, exact: true }, pick: 2 });
  assert.throws(() => browserLocator(page, {}), /exactly one of role/);
  assert.throws(() => browserLocator(page, { name: "Save" }), /exactly one of role/);
  assert.throws(() => browserLocator(page, { role: "button", css: "button" }), /exactly one of role/);
  assert.throws(() => browserLocator(page, { role: "button", nth: 1, first: true }), /either nth or first/);
});

test("playwright-core comes from this machine's host, Chrome from its environment or the provisioning", async () => {
  await assert.rejects(hostPlaywright(machine, undefined), /no host is known.*playwright-core/i);
  await assert.rejects(hostPlaywright(machine, path.join(tmpdir(), "no-host-here")), /playwright-core is not in the host/);
  const playwright = await hostPlaywright(machine, hostRoot);
  assert.equal(typeof playwright.chromium.launch, "function");
  assert.equal(await browserExecutable(playwright, { [BROWSER_EXECUTABLE_VARIABLE]: process.execPath }), process.execPath);
  await assert.rejects(browserExecutable(playwright, { [BROWSER_EXECUTABLE_VARIABLE]: "/no/chrome" }),
    /BROWSER_EXECUTABLE_PATH names \/no\/chrome; there is no executable browser there on this machine\. A workspace fetches Chromium with pnpm provision --workspace/);

  const executor = executorWith({});
  await assert.rejects(executor.execute("one", BROWSER_OPERATIONS.navigate, { url: "http://localhost/", viewport }), /no host is known/i);
  await executor.shutdown();
});

test("the browser contribution never loads playwright-core on import, only as a type", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../plugins/ragents.browser/executor");
  const files = (await readdir(root, { recursive: true })).filter((file) => file.endsWith(".ts"));
  const imports = await Promise.all(files.map(async (file) => {
    const source = await readFile(path.join(root, file), "utf8");
    return [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"playwright-core";/gm)].map((match) => ({ file, typeOnly: match[1] !== undefined }));
  }));
  const found = imports.flat();
  assert.ok(found.length > 0);
  assert.deepEqual(found.filter((entry) => !entry.typeOnly), []);
});

test("count filters by text, zero proves absence and page errors fail only on explicit request", async (t) => {
  const stub = stubBrowser({ "/": { title: "List", elements: [
    { role: "button", name: "Save draft" },
    { role: "button", name: "Save copy" },
    { role: "button", name: "Cancel" },
  ] } });
  const executor = executorWith({ launch: stub.launch });
  t.after(() => executor.shutdown());
  await executor.execute("one", BROWSER_OPERATIONS.navigate, { url: "http://localhost/", viewport });
  const check = (input: unknown) => executor.execute("one", BROWSER_OPERATIONS.check, input) as Promise<BrowserStep<BrowserCheckResult>>;
  await check({ target: { role: "button" }, count: 2, text: "save" });
  await check({ target: { role: "button" }, count: 0, text: "Deleted" });
  await assert.rejects(check({ target: { role: "button" }, count: 3, text: "save" }), /Expected 3 visible matches, found 2/);
  await check({ target: { role: "button" }, text: "Cancel" });
  stub.page().consoleError("Logo request failed");
  const informational = await check({ target: { role: "button" }, count: 2, text: "save" });
  assert.equal(informational.page.checked, true);
  assert.deepEqual(informational.result.errors, ["Console: Logo request failed"]);
  await check({ text: "Cancel", noErrors: false });
  await assert.rejects(check({ noErrors: true }), /Browser errors: Console: Logo request failed/);
  assert.equal((await executor.execute("one", BROWSER_OPERATIONS.state, null) as BrowserPageState).checked, false);
  for (let index = 0; index < 8; index++) stub.page().consoleError("Long error\n" + "x".repeat(2000));
  const bounded = (await check({ text: "Cancel" })).result.errors;
  assert.equal(bounded.length, 6);
  assert.equal(bounded.at(-1), "4 more page errors");
  assert.ok(bounded.every((line) => line.length <= 300 && !line.includes("\n")));
});

test("action failures list only a few candidates and omit Playwright timeout logs", async (t) => {
  const stub = stubBrowser({ "/": { title: "Actions", elements: [
    ...Array.from({ length: 7 }, (_, index) => ({ role: "button", name: `Choice ${index}` })),
    { role: "button", name: "Blocked", onClick: () => { throw new Error("locator.click: Timeout 500ms exceeded.\nCall log:\n  - waiting for button\n  - element is not enabled\n  - retrying click action\n  - waiting 500ms"); } },
  ] } });
  const executor = executorWith({ launch: stub.launch });
  t.after(() => executor.shutdown());
  await executor.execute("one", BROWSER_OPERATIONS.navigate, { url: "http://localhost/", viewport });
  await assert.rejects(executor.execute("one", BROWSER_OPERATIONS.click, { target: { role: "button" } }), (error: Error) => {
    assert.match(error.message, /\[0\] button "Choice 0"/);
    assert.match(error.message, /\[4\] button "Choice 4"/);
    assert.doesNotMatch(error.message, /Choice 5|strict mode violation/);
    assert.match(error.message, /target.nth.*first: true.*text or role\/name/);
    assert.equal(error.message.split("\n").length, 2);
    return true;
  });
  await assert.rejects(executor.execute("one", BROWSER_OPERATIONS.click, { target: { role: "button", name: "Blocked" } }), (error: Error) => {
    assert.match(error.message, /Timed out.*not enabled/);
    assert.doesNotMatch(error.message, /Call log|retrying click/);
    assert.equal(error.message.split("\n").length, 1);
    return true;
  });
  await executor.execute("one", BROWSER_OPERATIONS.click, { target: { role: "button", first: true } });
  await executor.execute("one", BROWSER_OPERATIONS.click, { target: { text: "Choice 5" } });
});

test("pure text checks are scoped to their iframe and missing targets fail before waiting", async (t) => {
  const stub = stubBrowser({ "/": { title: "Frames", elements: [{ role: "status", name: "Main result" }],
    frames: { "iframe.preview": { title: "Preview", elements: [{ role: "status", name: "Frame result" }] } } } });
  const executor = executorWith({ launch: stub.launch });
  t.after(() => executor.shutdown());
  await executor.execute("one", BROWSER_OPERATIONS.navigate, { url: "http://localhost/", viewport });
  const check = (input: unknown) => executor.execute("one", BROWSER_OPERATIONS.check, input);
  await check({ text: "FRAME RESULT", frame: "iframe.preview" });
  await assert.rejects(check({ text: "Frame result" }), /0 matches for.*Frame result/);
  await assert.rejects(check({ text: "Main result", frame: "iframe.preview" }), /0 matches for.*iframe.preview/);
  await assert.rejects(check({ frame: "iframe.preview", url: "http://localhost/" }), /frame.*requires text without target/);
  await assert.rejects(check({ frame: "iframe.preview", target: { role: "status" }, text: "Main result" }), /use target.frame/);
  await assert.rejects(check({ target: { css: ".missing" } }), /^Error: 0 matches for/);
  await assert.rejects(check({ target: { css: ".missing" }, count: 1 }), /0 matches for/);
  for (const operation of [BROWSER_OPERATIONS.click, BROWSER_OPERATIONS.type, BROWSER_OPERATIONS.selectOption, BROWSER_OPERATIONS.pressKey]) {
    await assert.rejects(executor.execute("one", operation, { target: { css: ".missing" }, text: "x", values: ["x"], key: "Enter" }),
      /0 matches for.*\.missing/);
  }
  assert.deepEqual(stub.log.actions, []);
});

test("zero counts warn for unproven selectors, while text filters, hidden and previously seen targets establish the selector", async (t) => {
  const stub = stubBrowser({ "/": { title: "List", elements: [
    { role: "status", name: "Saved", css: ".status" },
    { role: "status", name: "Hidden", css: ".hidden", visible: false },
  ] } });
  const executor = executorWith({ launch: stub.launch });
  t.after(() => executor.shutdown());
  const navigate = () => executor.execute("one", BROWSER_OPERATIONS.navigate, { url: "http://localhost/", viewport });
  const check = async (input: unknown) => (await executor.execute("one", BROWSER_OPERATIONS.check, input) as BrowserStep<BrowserCheckResult>).result;
  await navigate();
  const unproven = await check({ target: { css: ".typo" }, count: 0 });
  assert.match(unproven.warnings?.[0] ?? "", /never matched.*wrong selector/);
  assert.equal((await executor.execute("one", BROWSER_OPERATIONS.state, null) as BrowserPageState).checked, true);
  assert.equal((await check({ target: { css: ".status" }, count: 0, text: "Missing" })).warnings, undefined);
  assert.equal((await check({ target: { css: ".hidden" }, count: 0 })).warnings, undefined);
  stub.page().remove("Saved");
  assert.equal((await check({ target: { css: ".status" }, count: 0 })).warnings, undefined);
  await navigate();
  stub.page().remove("Saved");
  assert.equal((await check({ target: { css: ".status" }, count: 0 })).warnings?.length, 1, "navigation discards selector history");
});

test("layout checks return only one target's dimensions and require a visible target without count", async (t) => {
  const box = { x: 10, y: 20, width: 120, height: 40 };
  const stub = stubBrowser({ "/": { title: "Layout", elements: [
    { role: "region", name: "Clipped", css: ".clipped", box, clientWidth: 120, scrollWidth: 260 },
    { role: "region", name: "Fits", css: ".fits", box, clientWidth: 120, scrollWidth: 120 },
  ] } });
  const executor = executorWith({ launch: stub.launch });
  t.after(() => executor.shutdown());
  await executor.execute("one", BROWSER_OPERATIONS.navigate, { url: "http://localhost/", viewport });
  const check = async (input: unknown) => (await executor.execute("one", BROWSER_OPERATIONS.check, input) as BrowserStep<BrowserCheckResult>).result;
  assert.deepEqual((await check({ target: { css: ".clipped" }, measure: true })).measurement,
    { box, clientWidth: 120, scrollWidth: 260, overflowX: 140 });
  assert.equal((await check({ target: { css: ".fits" }, measure: true })).measurement?.overflowX, 0);
  assert.equal((await check({ target: { css: ".fits" } })).measurement, undefined);
  await assert.rejects(check({ text: "Fits", measure: true }), /measure.*target without count/);
  await assert.rejects(check({ target: { css: ".fits" }, count: 1, measure: true }), /measure.*target without count/);
  await assert.rejects(check({ target: { role: "region" }, measure: true }), /Target matches several elements/);
  assert.ok((await check({ target: { role: "region", nth: 0 }, measure: true })).measurement);
});

test("actions return bounded snapshots and explicit reads retain the full structure", async (t) => {
  const stub = stubBrowser({ "/": { title: "Large", elements: [
    { role: "button", name: "Save" },
    ...Array.from({ length: 90 }, (_, index) => ({ role: "status", name: `Entry ${index} ${"x".repeat(400)}` })),
  ] } });
  const executor = executorWith({ launch: stub.launch });
  t.after(() => executor.shutdown());
  const run = async (operation: string, input: unknown = null) =>
    (await executor.execute("one", operation, input) as BrowserStep<BrowserSnapshot>).result;
  const opened = await run(BROWSER_OPERATIONS.navigate, { url: "http://localhost/", viewport });
  assert.ok(opened.snapshot.length > 2000);
  for (const [operation, input] of [
    [BROWSER_OPERATIONS.click, { target: { role: "button" } }],
    [BROWSER_OPERATIONS.resize, { width: 390, height: 844 }],
    [BROWSER_OPERATIONS.type, { target: { role: "button" }, text: "x" }],
    [BROWSER_OPERATIONS.selectOption, { target: { role: "button" }, values: ["x"] }],
    [BROWSER_OPERATIONS.pressKey, { key: "Escape" }],
  ] as const) {
    const result = await run(operation, input);
    assert.equal(result.truncated, true);
    assert.ok(result.snapshot.length <= 2000);
    assert.ok(result.snapshot.split("\n").length <= 40);
    assert.ok(result.snapshot.split("\n").every((line) => line.length <= 300));
  }
  assert.equal((await run(BROWSER_OPERATIONS.snapshot)).snapshot, opened.snapshot);
});
