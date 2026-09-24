import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspaceOperationExecutor, browserModule, workspaceProcessContext } from "@ragents/workspace-executor";
import { RunBrowser } from "../../../plugins/ragents.browser/server/browser.ts";
import { hostRoot } from "../src/host-version.ts";

const fixture = `<!doctype html><html lang="de"><head><title>Browser-Test</title><link rel="icon" href="data:,"></head><body>
<h1>Entwurf prüfen</h1>
<form><label for="title">Titel</label><input id="title" name="title"><label for="kind">Art</label><select id="kind" name="kind"><option>Bug</option><option>Feature</option></select><button>Speichern</button></form>
<p role="status">Noch nicht gespeichert</p>
<button id="cookie">Anmeldung setzen</button><button id="error">Fehler auslösen</button>
<iframe title="Vorschau" srcdoc="<button onclick='this.textContent=&quot;Im Frame geklickt&quot;'>Im Frame speichern</button>"></iframe>
<script>
document.querySelector('form').onsubmit = (event) => { event.preventDefault(); document.querySelector('[role=status]').textContent = document.querySelector('[name=title]').value + ': ' + document.querySelector('[name=kind]').value; };
document.querySelector('#cookie').onclick = () => { document.cookie = 'session=one'; };
document.querySelector('#error').onclick = () => { console.error('Absichtlicher Browserfehler'); };
</script></body></html>`;

/** Derselbe Weg wie im Server: der Server-Teil ruft das Browsermodul seines Executors, das Chrome aus dem Host dieser Maschine startet. */
const serverBrowser = (filesFor: (runId: string) => Promise<string>) => {
  const executor = new WorkspaceOperationExecutor({
    contextFor: async (runId) => workspaceProcessContext({
      runId, cwd: tmpdir(), root: tmpdir(), home: { home: tmpdir() }, logDirectory: tmpdir(), hostRoot: hostRoot(),
    }),
    modules: [browserModule({ timeoutMs: 2500, checkTimeoutMs: 500 })],
  });
  return { browser: new RunBrowser({ sandbox: executor, filesFor }), executor };
};

test("Echter Browser bedient Formular und Iframe, isoliert Cookies und prüft Screenshots und Abbruch", { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000 }, async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-browser-live-"));
  const server = createServer((request, response) => {
    if (request.url === "/missing") { response.writeHead(503); response.end("Dienst fehlt"); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(request.url === "/cookie"
      ? `<!doctype html><head><link rel="icon" href="data:,"></head><body>${request.headers.cookie || "Keine Anmeldung"}</body>`
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

  const opened = await browser.open("one", url);
  assert.match(opened.snapshot, /Entwurf prüfen/);
  assert.match(opened.snapshot, /\[ref=/);
  assert.equal(opened.title, "Browser-Test");
  await browser.fill("one", { label: "Titel" }, "Neuer Eintrag");
  await browser.select("one", { label: "Art" }, "Feature");
  await browser.click("one", { role: "button", name: "Speichern" });
  await browser.check("one", { target: { role: "status" }, text: "Neuer Eintrag: Feature" });
  assert.ok(browser.evidence("one").checkedAt);
  const screenshot = await browser.screenshot("one", { label: "Gespeichertes Feature" });
  const bytes = await readFile(path.join(directory, "one", screenshot.path));
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1920, 1080]);
  assert.equal((await browser.image("one")).length, bytes.length);
  assert.match(screenshot.url, /^\/api\/plugins\/ragents.documents\/runs\/one\/files\/content\?path=browser/);
  assert.equal(browser.evidence("one").screenshots.length, 1);
  await assert.rejects(browser.image("other"), /noch keinen/);

  await browser.fill("one", { label: "Titel" }, "Tastatur");
  assert.equal(browser.evidence("one").checkedAt, undefined);
  assert.equal(browser.evidence("one").screenshots.length, 1);
  assert.equal(browser.evidence("one").currentScreenshots.length, 0);
  await browser.press("one", { label: "Titel" }, "Enter");
  await browser.check("one", { text: "Tastatur: Feature" });
  await assert.rejects(browser.check("one", { target: { role: "status" }, text: "Falsches Ergebnis" }), /Erwarteter Text fehlt/);
  assert.equal(browser.evidence("one").checkedAt, undefined);
  await browser.click("one", { frame: "iframe", role: "button", name: "Im Frame speichern" });
  await browser.check("one", { target: { frame: "iframe", role: "button", name: "Im Frame geklickt" } });
  await assert.rejects(browser.click("one", { role: "button" }), /strict mode violation[\s\S]*nth \(0-basiert\) oder first: true/);
  await assert.rejects(browser.check("one", {}), /mindestens/);
  await browser.check("one", { target: { role: "button" }, count: 3 });
  await browser.check("one", { target: { role: "button", first: true } });
  await assert.rejects(browser.check("one", { target: { role: "button" }, count: 2 }), /Erwartet 2 sichtbare Treffer, gefunden 3/);
  await assert.rejects(browser.check("one", { target: { role: "button", first: true }, count: 1 }), /ohne nth oder first/);
  const missingSince = Date.now();
  await assert.rejects(browser.check("one", { target: { role: "button", name: "Wird nie angezeigt" } }), /Timeout/);
  assert.ok(Date.now() - missingSince < 2000, "Sichtbarkeitsprüfungen warten kürzer als Aktionen");

  await browser.click("one", { role: "button", nth: 1 });
  await browser.open("one", `${url}/cookie`);
  await browser.check("one", { text: "session=one" });
  await browser.open("two", `${url}/cookie`);
  await browser.check("two", { text: "Keine Anmeldung" });
  await browser.viewport("two", { width: 390, height: 844 });
  const narrow = await browser.screenshot("two", { label: "Schmal" });
  const narrowBytes = await readFile(path.join(directory, "two", narrow.path));
  assert.deepEqual([narrowBytes.readUInt32BE(16), narrowBytes.readUInt32BE(20)], [390, 844]);
  await browser.open("one", url);
  await browser.click("one", { role: "button", name: "Fehler auslösen" });
  await assert.rejects(browser.check("one", { noErrors: true }), /Absichtlicher Browserfehler/);
  assert.ok(browser.evidence("one").errors.some((error) => error.includes("Absichtlicher Browserfehler")));
  await assert.rejects(browser.open("one", `${url}/missing`), /HTTP 503/);

  await browser.open("one", url);
  const abort = new AbortController();
  const pending = browser.click("one", { role: "button", name: "Wird nie angezeigt" }, { signal: abort.signal });
  const rejected = assert.rejects(pending, /closed|beendet|abort/i);
  setTimeout(() => abort.abort(), 50);
  await rejected;
  await assert.rejects(browser.snapshot("one"), /kein Browser offen/);
  await browser.check("two", { text: "Keine Anmeldung" });
  await browser.close("two");
  await assert.rejects(browser.snapshot("two"), /kein Browser offen/);
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
