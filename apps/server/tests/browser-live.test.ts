import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspaceOperationExecutor, executorMachine, workspaceProcessContext } from "@ragents/workspace-executor";
import { browserModule } from "../../../plugins/ragents.browser/executor/module.ts";
import { RunBrowser } from "../../../plugins/ragents.browser/server/browser.ts";
import { hostRoot } from "../src/host-version.ts";

const fixture = `<!doctype html><html lang="en"><head><title>Browser-Test</title><link rel="icon" href="data:,"></head><body>
<h1>Review draft</h1>
<form><label for="title">Title</label><input id="title" name="title"><label for="kind">Kind</label><select id="kind" name="kind"><option>Bug</option><option>Feature</option></select><button>Save</button></form>
<p role="status">Not saved yet</p>
<button id="cookie">Set sign-in</button><button id="error">Raise error</button>
<iframe title="Preview" srcdoc="<button onclick='this.textContent=&quot;Clicked in frame&quot;'>Save in frame</button>"></iframe>
<script>
document.querySelector('form').onsubmit = (event) => { event.preventDefault(); document.querySelector('[role=status]').textContent = document.querySelector('[name=title]').value + ': ' + document.querySelector('[name=kind]').value; };
document.querySelector('#cookie').onclick = () => { document.cookie = 'session=one'; };
document.querySelector('#error').onclick = () => { console.error('Intentional browser error'); };
</script></body></html>`;

/** The same path as in the server: the server part calls the browser module of its executor, which starts Chrome from this machine's host. */
const serverBrowser = (filesFor: (runId: string) => Promise<string>) => {
  const executor = new WorkspaceOperationExecutor({
    contextFor: async (runId) => workspaceProcessContext({
      runId, cwd: tmpdir(), root: tmpdir(), home: { home: tmpdir() }, logDirectory: tmpdir(), hostRoot: hostRoot(),
    }),
    modules: [browserModule(executorMachine("/unused"), { timeoutMs: 2500, checkTimeoutMs: 500 })],
  });
  return { browser: new RunBrowser({ sandbox: executor, filesFor }), executor };
};

test("a real browser operates form and iframe, isolates cookies and checks screenshots and abort", { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000 }, async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-browser-live-"));
  const server = createServer((request, response) => {
    if (request.url === "/missing") { response.writeHead(503); response.end("Service missing"); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(request.url === "/cookie"
      ? `<!doctype html><head><link rel="icon" href="data:,"></head><body>${request.headers.cookie || "No sign-in"}</body>`
      : fixture);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  const { browser, executor } = serverBrowser(async (runId) => path.join(directory, runId));
  context.after(async () => {
    await browser.shutdown();
    await executor.shutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  const opened = await browser.navigate("one", url);
  assert.match(opened.snapshot, /Review draft/);
  assert.match(opened.snapshot, /\[ref=/);
  assert.equal(opened.title, "Browser-Test");
  await browser.type("one", { label: "Title" }, { text: "New entry", slowly: true });
  await browser.selectOption("one", { label: "Kind" }, ["Feature"]);
  await browser.click("one", { role: "button", name: "Save" });
  await browser.check("one", { target: { role: "status" }, text: "New entry: Feature" });
  assert.ok(browser.evidence("one").checkedAt);
  const screenshot = await browser.takeScreenshot("one", { label: "Saved feature" });
  const bytes = await readFile(path.join(directory, "one", screenshot.path));
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1920, 1080]);
  assert.equal((await browser.image("one")).length, bytes.length);
  assert.match(screenshot.url, /^\/api\/plugins\/ragents.documents\/runs\/one\/files\/content\?path=browser/);
  assert.equal(browser.evidence("one").screenshots.length, 1);
  await assert.rejects(browser.image("other"), /no browser screenshot/);

  await browser.type("one", { label: "Title" }, { text: "Keyboard" });
  assert.equal(browser.evidence("one").checkedAt, undefined);
  assert.equal(browser.evidence("one").screenshots.length, 1);
  assert.equal(browser.evidence("one").currentScreenshots.length, 0);
  await browser.pressKey("one", undefined, "Enter");
  await browser.check("one", { text: "Keyboard: Feature" });
  await browser.type("one", { label: "Title" }, { text: "Submitted", submit: true });
  await browser.check("one", { target: { role: "status" }, text: "Submitted: Feature" });
  await browser.type("one", { label: "Title" }, { text: "Targeted" });
  await browser.pressKey("one", { label: "Title" }, "Enter");
  await browser.check("one", { target: { role: "status" }, text: "Targeted: Feature" });
  await assert.rejects(browser.check("one", { target: { role: "status" }, text: "Wrong result" }), /Expected text is missing/);
  assert.equal(browser.evidence("one").checkedAt, undefined);
  await browser.click("one", { frame: "iframe", role: "button", name: "Save in frame" });
  await browser.check("one", { target: { frame: "iframe", role: "button", name: "Clicked in frame" } });
  await assert.rejects(browser.click("one", { role: "button" }), /strict mode violation[\s\S]*nth \(0-based\) or first: true/);
  await assert.rejects(browser.check("one", {}), /at least/);
  await browser.check("one", { target: { role: "button" }, count: 3 });
  await browser.check("one", { target: { role: "button", first: true } });
  await assert.rejects(browser.check("one", { target: { role: "button" }, count: 2 }), /Expected 2 visible matches, found 3/);
  await assert.rejects(browser.check("one", { target: { role: "button", first: true }, count: 1 }), /without nth or first/);
  const missingSince = Date.now();
  await assert.rejects(browser.check("one", { target: { role: "button", name: "Never shown" } }), /Timeout/);
  assert.ok(Date.now() - missingSince < 2000, "visibility checks wait shorter than actions");

  await browser.click("one", { role: "button", nth: 1 });
  await browser.navigate("one", `${url}/cookie`);
  await browser.check("one", { text: "session=one" });
  await browser.navigate("two", `${url}/cookie`);
  await browser.check("two", { text: "No sign-in" });
  await browser.resize("two", { width: 390, height: 844 });
  const narrow = await browser.takeScreenshot("two", { label: "Narrow" });
  const narrowBytes = await readFile(path.join(directory, "two", narrow.path));
  assert.deepEqual([narrowBytes.readUInt32BE(16), narrowBytes.readUInt32BE(20)], [390, 844]);
  await browser.navigate("one", url);
  await browser.click("one", { role: "button", name: "Raise error" });
  await assert.rejects(browser.check("one", { noErrors: true }), /Intentional browser error/);
  assert.ok(browser.evidence("one").errors.some((error) => error.includes("Intentional browser error")));
  await assert.rejects(browser.navigate("one", `${url}/missing`), /HTTP 503/);

  await browser.navigate("one", url);
  const abort = new AbortController();
  const pending = browser.click("one", { role: "button", name: "Never shown" }, { signal: abort.signal });
  const rejected = assert.rejects(pending, /closed|ended|abort/i);
  setTimeout(() => abort.abort(), 50);
  await rejected;
  await assert.rejects(browser.snapshot("one"), /No browser is open/);
  await browser.check("two", { text: "No sign-in" });
  await browser.close("two");
  await assert.rejects(browser.snapshot("two"), /No browser is open/);
  assert.ok((await browser.image("one")).length > 0);
  assert.equal(browser.evidence("one").screenshots.length, 1);
  assert.equal(browser.evidence("one").checkedAt, undefined);
  assert.equal(browser.evidence("one").url, undefined);
  const restored = new RunBrowser({ sandbox: executor, filesFor: async (runId) => path.join(directory, runId) });
  await restored.restore("one");
  assert.deepEqual(restored.evidence("one"), browser.evidence("one"));
  assert.equal((await restored.image("one")).length, bytes.length);
  await restored.shutdown();
});
