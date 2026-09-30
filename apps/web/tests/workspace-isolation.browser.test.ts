import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

test("sidebar tabs stay with their run and hidden files stay with their browser", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1",
  timeout: 120_000,
}, async context => {
  await mkdir("/private/tmp/ragents-ui-state", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-ui-state/check-");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    stdin: {
      resolveDir: root,
      loader: "tsx",
      contents: `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RunPanelWorkspace } from './apps/web/src/run-panel/RunPanelWorkspace';
import { useRunPanelWorkspaceState, saveRunPanelWorkspaceState } from './apps/web/src/run-panel/workspace-state';
import { FileBrowserPanel } from './plugins/ragents.workspace/web/FileBrowser';
const tabs = [{id:"files", label:"Files", keepMounted:true, Panel:()=> <input aria-label="Sidebar draft"/>}];
function Run({ id }) {
  const state = useRunPanelWorkspaceState(id);
  const update = (tab) => saveRunPanelWorkspaceState(id, {tab});
  const session = { session: { id }, messages: [] };
  const navigation = { activeTabId: state.tab ?? '', openTab: () => update('files'), selectionFor: () => undefined };
  return <section aria-label={id}>
    <button onClick={() => update(null)}>Collapse</button>
    <button onClick={() => navigation.openTab('files')}>Open tab</button>
    <RunPanelWorkspace session={session} navigation={navigation} open={state.tab !== null} onClose={() => update(null)} tabs={tabs}/>
    <FileBrowserPanel session={session} active={true}/>
  </section>;
}
function App() {
  const [run, setRun] = useState('run-a');
  return <><button onClick={() => setRun('run-a')}>Run A</button><button onClick={() => setRun('run-b')}>Run B</button><Run key={run} id={run}/></>;
}
createRoot(document.getElementById('root')).render(<App/>);
`,
    },
    outfile: `${directory}/fixture.js`,
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  const server = createServer(async (request, response) => {
    if (request.url === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(await readFile(`${directory}/fixture.js`));
      return;
    }
    if (request.url === "/rpc/stream") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write('event: hello\ndata: {"connection":"fixture"}\n\n');
      return;
    }
    if (request.url === "/rpc") {
      const body = JSON.parse(await new Promise<string>(resolve => {
        let text = "";
        request.on("data", chunk => { text += String(chunk); });
        request.on("end", () => resolve(text || "{}"));
      })) as { id?: number; method?: string };
      const listing = { root: "workspace", location: "fixture", path: "", truncated: false, entries: [
        { name: "visible.txt", kind: "file", size: 1, modifiedAt: "2026-01-01" },
        { name: ".hidden.txt", kind: "file", size: 1, modifiedAt: "2026-01-01" },
      ] };
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? null, result: body.method === "rpc.subscribe" ? { subscription: "fixture" } : listing }));
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><head><link rel="icon" href="data:,"><style>[role="separator"]{width:12px;height:60px}section{width:1400px}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH, headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}`);
  const sidebar = page.getByRole("region", { name: "Sidebar" });
  await page.getByRole("button", { name: "Open tab", exact: true }).click();
  await sidebar.waitFor();
  await page.getByRole("textbox", { name: "Sidebar draft" }).fill("Keep this draft");
  await page.getByRole("button", { name: "Close sidebar" }).click();
  await page.getByRole("button", { name: "Show hidden entries", exact: true }).click();
  await page.getByText(".hidden.txt", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Open tab", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Sidebar draft" }).inputValue(), "Keep this draft");
  await page.getByRole("button", { name: "Close sidebar" }).click();
  await page.getByRole("button", { name: "Run B", exact: true }).click();
  assert.equal(await sidebar.count(), 0);
  await page.getByRole("button", { name: "Show hidden entries", exact: true }).waitFor();
  assert.equal(await page.getByText(".hidden.txt", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Open tab", exact: true }).click();
  await sidebar.waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Run B", exact: true }).click();
  await sidebar.waitFor();
  assert.deepEqual(errors, []);
});
