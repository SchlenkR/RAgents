import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspaceOperationExecutor, executorMachine, sandboxToolsModule, workspaceProcessContext } from "@ragents/workspace-executor";
import { browserModule } from "../../../plugins/ragents.browser/executor/module.ts";
import { RunBrowser } from "../../../plugins/ragents.browser/server/browser.ts";
import { hostRoot } from "../src/host-version.ts";

const fixture = `<!doctype html><html lang="en"><head><title>Browser-Test</title><link rel="icon" href="data:,"></head><body>
<h1>Review draft</h1>
<form><label for="title">Title</label><input id="title" name="title"><label for="kind">Kind</label><select id="kind" name="kind"><option>Bug</option><option>Feature</option></select><button>Save</button></form>
<p role="status">Not saved yet</p>
<button id="cookie">Set sign-in</button><button id="error">Raise error</button>
<button id="blocked" hidden>Never operable</button>
<div id="overflow" style="width:120px;overflow:hidden"><div style="width:260px">Clipped content</div></div>
<iframe title="Preview" srcdoc="<button onclick='this.textContent=&quot;Clicked in frame&quot;'>Save in frame</button>"></iframe>
<script>
document.querySelector('form').onsubmit = (event) => { event.preventDefault(); document.querySelector('[role=status]').textContent = document.querySelector('[name=title]').value + ': ' + document.querySelector('[name=kind]').value; };
document.querySelector('#cookie').onclick = () => { document.cookie = 'session=one'; };
document.querySelector('#error').onclick = () => { console.error('Intentional browser error'); };
</script></body></html>`;

/** The same path as in the server: the server part calls the browser module of its executor, which starts Chrome from this machine's host; the store is its root @documents. */
const serverBrowser = (documentsFor: (runId: string) => string) => {
  const executor = new WorkspaceOperationExecutor({
    contextFor: async (runId) => workspaceProcessContext({
      runId, cwd: tmpdir(), root: tmpdir(), home: { home: tmpdir() }, logDirectory: tmpdir(), hostRoot: hostRoot(),
      additionalRoots: [{ directory: documentsFor(runId), alias: "@documents" }],
    }),
    modules: [sandboxToolsModule, browserModule(executorMachine("/unused"), { timeoutMs: 2500, checkTimeoutMs: 500 })],
  });
  return { browser: new RunBrowser({ sandbox: executor, filesFor: async (runId) => documentsFor(runId) }), executor };
};

const stored = (documents: string, reference: string): string => path.join(documents, ...reference.slice("@documents/".length).split("/"));

test("a real browser operates form and iframe, isolates cookies and checks screenshots and abort", { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000 }, async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-browser-live-"));
  const server = createServer((request, response) => {
    if (request.url === "/logo.svg") { response.writeHead(404); response.end(); return; }
    if (request.url === "/missing") { response.writeHead(503); response.end("Service missing"); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(request.url === "/cookie"
      ? `<!doctype html><head><link rel="icon" href="data:,"></head><body>${request.headers.cookie || "No sign-in"}</body>`
      : request.url === "/noisy" ? fixture.replace("<script>", '<img alt="Logo" src="/logo.svg"><script>')
        : request.url === "/large" ? fixture.replace("</body>", `${Array.from({ length: 100 }, (_, index) => `<p>Entry ${index} ${"x".repeat(350)}</p>`).join("")}</body>`)
          : fixture);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  await Promise.all(["one", "two"].map((runId) => mkdir(path.join(directory, runId))));
  const { browser, executor } = serverBrowser((runId) => path.join(directory, runId));
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
  const bytes = await readFile(stored(path.join(directory, "one"), screenshot.reference));
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1920, 1080]);
  assert.equal((await browser.image("one")).length, bytes.length);
  assert.match(screenshot.url, /^\/api\/plugins\/ragents.documents\/runs\/one\/raw\/%40documents\/browser\//);
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
  await browser.check("one", { frame: "iframe", text: "CLICKED IN FRAME" });
  await assert.rejects(browser.check("one", { text: "Clicked in frame" }), /0 matches for/);
  await assert.rejects(browser.check("one", { frame: "iframe", text: "Review draft" }), /0 matches for/);
  await assert.rejects(browser.click("one", { role: "button" }), /Target matches several elements[\s\S]*target.nth \(0-based\), first: true/);
  await assert.rejects(browser.check("one", {}), /at least/);
  await browser.check("one", { target: { role: "button" }, count: 3 });
  await browser.check("one", { target: { role: "button" }, count: 1, text: "save" });
  await browser.check("one", { target: { role: "button" }, count: 0, text: "Absent" });
  const wrongSelector = await browser.check("one", { target: { css: ".missing-selector" }, count: 0 });
  assert.match(wrongSelector.warnings?.[0] ?? "", /never matched.*wrong selector/);
  assert.equal((await browser.check("one", { target: { css: "#blocked" }, count: 0 })).warnings, undefined);
  assert.equal((await browser.check("one", { target: { role: "button" }, count: 0, text: "Absent" })).warnings, undefined);
  const measured = await browser.check("one", { target: { css: "#overflow" }, measure: true });
  assert.equal(measured.measurement?.box.width, 120);
  assert.equal(measured.measurement?.clientWidth, 120);
  assert.equal(measured.measurement?.scrollWidth, 260);
  assert.equal(measured.measurement?.overflowX, 140);
  const pageSize = await browser.check("one", { target: { css: "html" }, measure: true });
  assert.equal(pageSize.measurement?.clientWidth, 1920);
  assert.equal(pageSize.measurement?.overflowX, 0);
  const frameSize = await browser.check("one", { target: { frame: "iframe", role: "button" }, measure: true });
  assert.ok(frameSize.measurement && frameSize.measurement.box.x > 0 && frameSize.measurement.box.width > 0);
  await assert.rejects(browser.check("one", { target: { role: "button" }, count: 2, text: "Save" }), /Expected 2 visible matches, found 1/);
  await browser.check("one", { target: { role: "button" }, text: "Raise error" });
  await browser.check("one", { target: { role: "button", first: true } });
  await assert.rejects(browser.check("one", { target: { role: "button" }, count: 2 }), /Expected 2 visible matches, found 3/);
  await assert.rejects(browser.check("one", { target: { role: "button", first: true }, count: 1 }), /without nth or first/);
  const missingSince = Date.now();
  await assert.rejects(browser.check("one", { target: { role: "button", name: "Never shown" } }), /0 matches for/);
  assert.ok(Date.now() - missingSince < 1000, "missing targets fail before the check timeout");

  await browser.navigate("one", `${url}/noisy`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const logoCheck = await browser.check("one", { text: "Review draft" });
  assert.equal(logoCheck.errors.filter((error) => error.includes("/logo.svg")).length, 1);
  await assert.rejects(browser.check("one", { text: "Review draft", noErrors: true }), /logo.svg/);
  await browser.navigate("one", url);
  await browser.click("one", { role: "button", nth: 1 });
  await browser.navigate("one", `${url}/cookie`);
  await browser.check("one", { text: "session=one" });
  await browser.navigate("two", `${url}/cookie`);
  await browser.check("two", { text: "No sign-in" });
  await browser.resize("two", { width: 390, height: 844 });
  const narrow = await browser.takeScreenshot("two", { label: "Narrow" });
  const narrowBytes = await readFile(stored(path.join(directory, "two"), narrow.reference));
  assert.deepEqual([narrowBytes.readUInt32BE(16), narrowBytes.readUInt32BE(20)], [390, 844]);
  await browser.navigate("one", url);
  await browser.click("one", { role: "button", name: "Raise error" });
  const noisy = await browser.check("one", { text: "Review draft" });
  assert.ok(noisy.errors.some((error) => error.includes("Intentional browser error")));
  await assert.rejects(browser.check("one", { noErrors: true }), /Intentional browser error/);
  await browser.check("one", { text: "Review draft", noErrors: false });
  const missingActionSince = Date.now();
  await assert.rejects(browser.click("one", { role: "button", name: "Absent" }), (error: Error) => {
    assert.ok(error.message.split("\n").length <= 2);
    assert.doesNotMatch(error.message, /Call log|retrying click/);
    assert.match(error.message, /0 matches for.*Absent/);
    return true;
  });
  assert.ok(Date.now() - missingActionSince < 1000, "missing actions fail before the action timeout");
  assert.ok(browser.evidence("one").errors.some((error) => error.includes("Intentional browser error")));
  await assert.rejects(browser.navigate("one", `${url}/missing`), /HTTP 503/);

  const large = await browser.navigate("one", `${url}/large`);
  assert.ok(large.snapshot.length > 2000);
  const clickedLarge = await browser.click("one", { role: "button", name: "Set sign-in" });
  assert.ok(clickedLarge.truncated && clickedLarge.snapshot.length <= 2000);
  const resizedLarge = await browser.resize("one", { width: 1300, height: 800 });
  assert.ok(resizedLarge.truncated && resizedLarge.snapshot.length <= 2000);
  const full = await browser.snapshot("one");
  assert.ok(full.snapshot.length > 2000);
  assert.match(full.snapshot, /Entry 99/);
  await browser.check("one", { text: "Entry 99" });
  await browser.resize("one", { width: 390, height: 844 });
  assert.equal(browser.evidence("one").checkedAt, undefined, "resize invalidates layout evidence");
  assert.equal((await browser.check("one", { target: { css: "html" }, measure: true })).measurement?.clientWidth, 390);

  await browser.navigate("one", url);
  const abort = new AbortController();
  const pending = browser.click("one", { css: "#blocked" }, { signal: abort.signal });
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
