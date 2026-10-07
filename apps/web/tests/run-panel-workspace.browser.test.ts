import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";

test("the VS Code run panel toolbar opens and closes the sidebar as a pop-out, remembers the tab per run and is missing in the app layout", {
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
import { RunPanelHostProvider, createBrowserHost } from './apps/web/src/run-panel/host';
import { PluginRegistry } from './apps/web/src/PluginRegistry';
import { Badge } from './apps/web/src/ui';
import './apps/web/src/ui/tailwind.css';
const icon = (text) => () => <svg data-icon={text} viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>;
function FilesPanel({ active, navigation }) {
  return <div><p>Files panel</p><button onClick={() => navigation.openTab('documents')}>Open documents</button><span>{active ? 'Files active' : 'Files inactive'}</span></div>;
}
function DocumentsPanel() {
  const [count, setCount] = useState(0);
  return <div><p>Documents panel</p><button onClick={() => setCount((value) => value + 1)}>Count</button><output>{count}</output></div>;
}
const registry = new PluginRegistry({ brand: { title: 'Test' }, product: { id: 'test', title: 'Test' }, startEntries: [], plugins: [{ id: 'test', workspaceTabs: [
  { id: 'files', label: 'Files', order: 2, Icon: icon('files'), Panel: FilesPanel },
  { id: 'documents', label: 'Documents', order: 1, keepMounted: true, Icon: icon('documents'), Panel: DocumentsPanel, Badge: () => <Badge variant="secondary">3</Badge> },
] }] });
const query = new URLSearchParams(location.search);
const layout = query.get('layout') === 'app' ? { element: 'board' } : 'panel';
const runId = query.get('run') ?? 'run-a';
createRoot(document.getElementById('root')).render(<div style={{ width: 600, height: 800, display: 'flex' }}><RunPanelHostProvider value={{ ...createBrowserHost(window), kind: "vscode" }}><PluginChat key={runId} layout={layout} registry={registry} session={{ id: runId, title: 'Run', updatedAt: 0 }}/></RunPanelHostProvider></div>);
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
  const rail = page.getByRole("navigation", { name: "Sidebar tabs" });
  const area = page.locator("#run-panel-workspace");
  const button = (label: string) => rail.getByRole("button", { name: label, exact: true });
  const stored = (runId: string) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), `ragents.run-panel.workspace-tab:${runId}`);
  await rail.waitFor();
  // A badge sits beside its icon-only rail button, inside the same rail entry.
  assert.deepEqual(await rail.locator(":scope > div").allTextContents().then((texts) => texts.map((text) => text.trim())), ["3", ""], "Documents with badge first, then files");
  assert.deepEqual(await rail.getByRole("button").evaluateAll((buttons) => buttons.map((entry) => entry.getAttribute("aria-label"))), ["Documents", "Files"]);
  assert.equal(await area.isHidden(), true, "the sidebar is initially closed");
  assert.equal(await stored("run-a"), null);

  await button("Files").click();
  await area.waitFor({ state: "visible" });
  assert.equal(await area.getByRole("heading").textContent(), "Files");
  assert.equal(await button("Files").getAttribute("aria-pressed"), "true");
  assert.equal(await button("Documents").getAttribute("aria-pressed"), "false");
  await area.getByText("Files active", { exact: true }).waitFor();
  assert.deepEqual(await stored("run-a"), { tab: "files" });

  await button("Files").click();
  await area.waitFor({ state: "hidden" });
  assert.equal(await button("Files").getAttribute("aria-pressed"), "false");
  assert.deepEqual(await stored("run-a"), { tab: null });

  await button("Documents").click();
  await area.getByText("Documents panel", { exact: true }).waitFor();
  await area.getByRole("button", { name: "Count", exact: true }).click();
  assert.equal(await area.locator("output").textContent(), "1");
  await button("Files").click();
  await area.getByText("Files active", { exact: true }).waitFor();
  assert.equal(await area.locator("output").count(), 1, "Documents stays mounted with keepMounted");
  await area.getByRole("button", { name: "Open documents", exact: true }).click();
  await area.getByText("Documents panel", { exact: true }).waitFor();
  assert.equal(await area.getByRole("heading").textContent(), "Documents", "navigation.openTab opens the tab");
  assert.equal(await area.locator("output").textContent(), "1", "the tab state survives the switch");
  assert.equal(await area.getByText(/Files (active|inactive)/).count(), 0, "the hidden tab without keepMounted is unmounted");

  const areaBox = await area.boundingBox();
  const railBox = await rail.boundingBox();
  assert.ok(areaBox && railBox);
  assert.ok(areaBox.height > 700 && areaBox.x + areaBox.width <= railBox.x, "the pop-out fills almost the full height to the left of the toolbar");
  await area.press("Escape");
  await area.waitFor({ state: "hidden" });
  assert.deepEqual(await stored("run-a"), { tab: null });
  await button("Documents").click();
  await area.waitFor({ state: "visible" });
  await page.mouse.click(railBox.x - 3, railBox.y + railBox.height - 3);
  await area.waitFor({ state: "hidden" });
  assert.deepEqual(await stored("run-a"), { tab: null }, "a click outside closes it");
  await button("Documents").click();
  await area.waitFor({ state: "visible" });
  assert.deepEqual(await stored("run-a"), { tab: "documents" });

  await page.reload();
  await area.waitFor({ state: "visible" });
  assert.equal(await area.getByRole("heading").textContent(), "Documents", "the open tab is remembered per run");

  await page.goto(`http://127.0.0.1:${address.port}/?run=run-b`);
  await rail.waitFor();
  assert.equal(await area.isHidden(), true, "another run starts with a closed surface");

  await page.goto(`http://127.0.0.1:${address.port}/?run=run-a`);
  await area.waitFor({ state: "visible" });
  await page.mouse.move(20, 400);
  await area.getByRole("button", { name: "Close sidebar", exact: true }).click();
  await area.waitFor({ state: "hidden" });
  assert.deepEqual(await stored("run-a"), { tab: null });

  await page.goto(`http://127.0.0.1:${address.port}/?run=run-a&layout=app`);
  await page.getByText("Loading run ...", { exact: true }).waitFor();
  assert.equal(await rail.count(), 0, "the app layout has no sidebar");
  assert.equal(await area.count(), 0);
  assert.deepEqual(errors, []);
});
