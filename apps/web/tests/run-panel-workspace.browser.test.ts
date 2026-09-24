import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";

test("die Leiste des Run-Panels öffnet und schließt die Tab-Fläche, merkt Reiter und Höhe je Run und fehlt im Layout app", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1",
  timeout: 120_000,
}, async (context) => {
  await mkdir("/private/tmp/ragents-run-panel-workspace", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-run-panel-workspace/check-");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    stdin: {
      resolveDir: root,
      loader: "tsx",
      contents: `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PluginChat } from './apps/web/src/PluginChat';
import { PluginRegistry } from './apps/web/src/PluginRegistry';
import { Badge } from './apps/web/src/ui';
import './apps/web/src/ui/tailwind.css';
const icon = (text) => () => <svg data-icon={text} viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>;
function FilesPanel({ active, navigation }) {
  return <div><p>Dateien-Panel</p><button onClick={() => navigation.openTab('documents')}>Dokumente öffnen</button><span>{active ? 'Dateien aktiv' : 'Dateien inaktiv'}</span></div>;
}
function DocumentsPanel() {
  const [count, setCount] = useState(0);
  return <div><p>Dokumente-Panel</p><button onClick={() => setCount((value) => value + 1)}>Zählen</button><output>{count}</output></div>;
}
const registry = new PluginRegistry({ brand: { title: 'Test' }, product: { id: 'test', title: 'Test' }, startEntries: [], plugins: [{ id: 'test', workspaceTabs: [
  { id: 'files', label: 'Dateien', order: 2, Icon: icon('files'), Panel: FilesPanel },
  { id: 'documents', label: 'Dokumente', order: 1, keepMounted: true, Icon: icon('documents'), Panel: DocumentsPanel, Badge: () => <Badge variant="secondary">3</Badge> },
] }] });
const query = new URLSearchParams(location.search);
const layout = query.get('layout') === 'app' ? { element: 'board' } : 'panel';
const runId = query.get('run') ?? 'run-a';
createRoot(document.getElementById('root')).render(<div style={{ width: 600, height: 800, display: 'flex' }}><PluginChat key={runId} layout={layout} registry={registry} session={{ id: runId, title: 'Run', updatedAt: 0 }}/></div>);
`,
    },
    outfile: `${directory}/fixture.js`,
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [tailwindPlugin([`${root}apps/web/src`])],
    logLevel: "silent",
  });
  const server = createServer(async (request, response) => {
    if (request.url === "/fixture.js" || request.url === "/fixture.css") {
      response.setHeader("Content-Type", request.url.endsWith(".css") ? "text/css" : "text/javascript");
      response.end(await readFile(`${directory}${request.url}`));
      return;
    }
    if (request.url === "/rpc/stream") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write('event: hello\ndata: {"connection":"fixture"}\n\n');
      return;
    }
    if (request.url === "/rpc") {
      const body = JSON.parse(await new Promise<string>((resolve) => {
        let text = "";
        request.on("data", (chunk) => { text += String(chunk); });
        request.on("end", () => resolve(text || "{}"));
      })) as { id?: number; method?: string };
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? null, result: body.method === "rpc.subscribe" ? { subscription: "fixture" } : null }));
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><head><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/?run=run-a`);
  const rail = page.getByRole("navigation", { name: "Reiter des Arbeitsbereichs" });
  const area = page.locator("#run-panel-workspace");
  const button = (label: string) => rail.getByRole("button", { name: label, exact: true });
  const stored = (runId: string) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), `ragents.run-panel.workspace:${runId}`);
  await rail.waitFor();
  assert.deepEqual(await rail.getByRole("button").allTextContents().then((texts) => texts.map((text) => text.trim())), ["3", ""], "Dokumente mit Badge zuerst, dann Dateien");
  assert.deepEqual(await rail.getByRole("button").evaluateAll((buttons) => buttons.map((entry) => entry.getAttribute("aria-label"))), ["Dokumente", "Dateien"]);
  assert.equal(await area.isHidden(), true, "die Tab-Fläche ist anfangs zu");
  assert.equal(await stored("run-a"), null);

  await button("Dateien").click();
  await area.waitFor({ state: "visible" });
  assert.equal(await area.getByRole("heading").textContent(), "Dateien");
  assert.equal(await button("Dateien").getAttribute("aria-pressed"), "true");
  assert.equal(await button("Dokumente").getAttribute("aria-pressed"), "false");
  await area.getByText("Dateien aktiv", { exact: true }).waitFor();
  assert.deepEqual(await stored("run-a"), { tab: "files", height: 280 });

  await button("Dateien").click();
  await area.waitFor({ state: "hidden" });
  assert.equal(await button("Dateien").getAttribute("aria-pressed"), "false");
  assert.deepEqual(await stored("run-a"), { tab: null, height: 280 });

  await button("Dokumente").click();
  await area.getByText("Dokumente-Panel", { exact: true }).waitFor();
  await area.getByRole("button", { name: "Zählen", exact: true }).click();
  assert.equal(await area.locator("output").textContent(), "1");
  await button("Dateien").click();
  await area.getByText("Dateien aktiv", { exact: true }).waitFor();
  assert.equal(await area.locator("output").count(), 1, "Dokumente bleibt mit keepMounted montiert");
  await area.getByRole("button", { name: "Dokumente öffnen", exact: true }).click();
  await area.getByText("Dokumente-Panel", { exact: true }).waitFor();
  assert.equal(await area.getByRole("heading").textContent(), "Dokumente", "navigation.openTab öffnet den Reiter");
  assert.equal(await area.locator("output").textContent(), "1", "der Zustand des Reiters überlebt den Wechsel");
  assert.equal(await area.getByText(/Dateien (aktiv|inaktiv)/).count(), 0, "der verborgene Reiter ohne keepMounted ist abgebaut");

  const sash = area.getByRole("separator", { name: "Höhe des Arbeitsbereichs" });
  assert.equal(await sash.getAttribute("aria-valuenow"), "280");
  await sash.focus();
  await sash.press("ArrowUp");
  assert.equal(await sash.getAttribute("aria-valuenow"), "304");
  assert.equal(await area.evaluate((element) => element.getBoundingClientRect().height), 304);
  assert.deepEqual(await stored("run-a"), { tab: "documents", height: 304 });
  const box = await sash.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 50, { steps: 5 });
  await page.mouse.up();
  assert.equal(await sash.getAttribute("aria-valuenow"), "354");
  assert.deepEqual(await stored("run-a"), { tab: "documents", height: 354 });

  await page.reload();
  await area.waitFor({ state: "visible" });
  assert.equal(await area.getByRole("heading").textContent(), "Dokumente", "der offene Reiter ist je Run gemerkt");
  assert.equal(await sash.getAttribute("aria-valuenow"), "354", "die Höhe ist je Run gemerkt");

  await page.goto(`http://127.0.0.1:${address.port}/?run=run-b`);
  await rail.waitFor();
  assert.equal(await area.isHidden(), true, "ein anderer Run beginnt mit geschlossener Fläche");

  await page.goto(`http://127.0.0.1:${address.port}/?run=run-a`);
  await area.waitFor({ state: "visible" });
  await area.getByRole("button", { name: "Arbeitsbereich schließen", exact: true }).click();
  await area.waitFor({ state: "hidden" });
  assert.deepEqual(await stored("run-a"), { tab: null, height: 354 });

  await page.goto(`http://127.0.0.1:${address.port}/?run=run-a&layout=app`);
  await page.getByText("Der Run wird geladen ...", { exact: true }).waitFor();
  assert.equal(await rail.count(), 0, "im Layout app gibt es keine Leiste");
  assert.equal(await area.count(), 0);
  assert.deepEqual(errors, []);
});
