import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";

interface StatusSubscription {
  readonly id: string;
  readonly params: { runId: string };
  readonly active: boolean;
}

interface McpStatusFixture {
  readonly subscriptions: readonly StatusSubscription[];
  readonly select: (runId: string, active: boolean) => void;
  readonly emit: (runId: string, status: unknown) => void;
  readonly fail: (runId: string, error: string) => void;
}

declare global {
  interface Window { mcpStatusFixture: McpStatusFixture; }
}

const screenshotDirectory = path.join(tmpdir(), "ragents-browser-shots");

test("the MCP panel shows live run-scoped status and errors without server definitions or credentials", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1",
  timeout: 60_000,
}, async (context) => {
  await mkdir(screenshotDirectory, { recursive: true });
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-mcp-ui-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const source = path.join(root, "apps/web/src");
  await build({
    stdin: {
      loader: "tsx",
      resolveDir: root,
      contents: `
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { webPlugin } from "./plugins/ragents.mcp/web/index";
import "./apps/web/src/ui/tailwind.css";
const tab = webPlugin.workspaceTabs.find((entry) => entry.id === "ragents.mcp.servers");
if (!tab) throw new Error("MCP status tab is missing");
const Panel = tab.Panel;
const subscriptions = [];
window.mcpStatusFixture = {
  subscriptions,
  subscribe: (contract, params, onMessage, onError) => {
    const subscription = { id: contract.id, params, active: true, onMessage, onError };
    subscriptions.push(subscription);
    return () => { subscription.active = false; };
  },
  emit: (runId, status) => subscriptions.filter((entry) => entry.active && entry.params.runId === runId).forEach((entry) => entry.onMessage(status)),
  fail: (runId, error) => subscriptions.filter((entry) => entry.active && entry.params.runId === runId).forEach((entry) => entry.onError(error)),
};
function App() {
  const [selection, setSelection] = useState({ runId: "run-alpha", active: true });
  window.mcpStatusFixture.select = (runId, active) => setSelection({ runId, active });
  const session = {
    session: { id: selection.runId },
    runId: "incorrect-flat-run-id",
    config: { "ragents.mcp": { MCP_SERVERS: { docs: { url: "https://fixture.example/mcp", headers: { Authorization: "Bearer fixture-header-secret" }, env: { SERVICE_TOKEN: "fixture-environment-secret" } } } } },
  };
  return <Panel active={selection.active} session={session} navigation={{ activeTabId: tab.id }} selection={null}/>;
}
createRoot(document.getElementById("root")).render(<App/>);
`,
    },
    outfile: path.join(directory, "fixture.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "mcp-status-services",
        setup(builder) {
          builder.onResolve({ filter: /^@ragents\/web\/rpc$/ }, () => ({ path: "mcp-rpc", namespace: "mcp-status" }));
          builder.onLoad({ filter: /^mcp-rpc$/, namespace: "mcp-status" }, () => ({
            contents: "export const rpc = { subscribe: (...args) => window.mcpStatusFixture.subscribe(...args) };",
            loader: "js",
          }));
        },
      },
      tailwindPlugin([source, path.join(root, "plugins/ragents.mcp/web")]),
    ],
    logLevel: "silent",
  });
  await writeFile(path.join(directory, "index.html"), '<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="fixture.css"><style>html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined),
  });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 760, height: 600 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(pathToFileURL(path.join(directory, "index.html")).href);
  const panel = page.getByRole("region", { name: "MCP servers" });
  await panel.getByText("Loading MCP server status...", { exact: true }).waitFor();
  await page.waitForFunction(() => window.mcpStatusFixture.subscriptions.length === 1);
  assert.deepEqual(await page.evaluate(() => window.mcpStatusFixture.subscriptions.map(({ id, params, active }) => ({ id, params, active }))), [
    { id: "ragents.mcp.status", params: { runId: "run-alpha" }, active: true },
  ]);
  await page.evaluate(() => window.mcpStatusFixture.emit("run-alpha", { servers: [] }));
  await panel.getByText("No MCP servers configured for this run.", { exact: true }).waitFor();

  await page.evaluate(() => window.mcpStatusFixture.emit("run-alpha", { servers: [
    { name: "files", transport: "stdio", protocolVersion: "2024-11-05", state: "connected", toolCount: 3 },
    { name: "docs", transport: "http", protocolVersion: "2026-07-28", state: "connected", toolCount: 7, headers: { Authorization: "Bearer fixture-header-secret" }, env: { SERVICE_TOKEN: "fixture-environment-secret" }, command: "fixture-server-command", args: ["fixture-server-argument"] },
    { name: "legacy", transport: "sse", state: "failed", error: "Connection refused by the MCP server.", toolCount: 0 },
  ] }));
  await panel.getByText("files", { exact: true }).waitFor();
  await panel.getByText("docs", { exact: true }).waitFor();
  await panel.getByText("legacy", { exact: true }).waitFor();
  await panel.getByText("stdio 2024-11-05 - 3 tools", { exact: true }).waitFor();
  await panel.getByText("http 2026-07-28 - 7 tools", { exact: true }).waitFor();
  await panel.getByText("sse - 0 tools", { exact: true }).waitFor();
  await panel.getByText("Connection refused by the MCP server.", { exact: true }).waitFor();
  assert.equal(await panel.getByText("connected", { exact: true }).count(), 2);
  assert.equal(await panel.getByText("failed", { exact: true }).count(), 1);
  const initialText = await panel.innerText();
  for (const privateValue of ["Authorization", "SERVICE_TOKEN", "fixture-header-secret", "fixture-environment-secret", "fixture-server-command", "fixture-server-argument", "https://fixture.example/mcp"]) {
    assert.equal(initialText.includes(privateValue), false, `${privateValue} must not appear in MCP status`);
  }

  await page.evaluate(() => window.mcpStatusFixture.emit("run-alpha", { servers: [
    { name: "files", transport: "stdio", protocolVersion: "2024-11-05", state: "connected", toolCount: 4 },
    { name: "docs", transport: "http", protocolVersion: "2026-07-28", state: "connecting", toolCount: 7 },
    { name: "legacy", transport: "sse", protocolVersion: "2024-11-05", state: "connected", toolCount: 2 },
  ] }));
  await panel.getByText("stdio 2024-11-05 - 4 tools", { exact: true }).waitFor();
  await panel.getByText("connecting", { exact: true }).waitFor();
  await panel.getByText("sse 2024-11-05 - 2 tools", { exact: true }).waitFor();
  assert.equal(await panel.getByText("Connection refused by the MCP server.", { exact: true }).count(), 0);

  await page.evaluate(() => window.mcpStatusFixture.fail("run-alpha", "MCP status subscription is unavailable."));
  await panel.getByRole("alert").getByText("MCP status subscription is unavailable.", { exact: true }).waitFor();
  await page.evaluate(() => window.mcpStatusFixture.select("run-alpha", false));
  await page.waitForFunction(() => window.mcpStatusFixture.subscriptions.every((entry) => !entry.active));
  assert.equal(await page.evaluate(() => window.mcpStatusFixture.subscriptions.length), 1, "an inactive panel must not create a background subscription");
  await page.evaluate(() => window.mcpStatusFixture.select("run-beta", true));
  await page.waitForFunction(() => window.mcpStatusFixture.subscriptions.length === 2);
  assert.deepEqual(await page.evaluate(() => window.mcpStatusFixture.subscriptions.map(({ id, params, active }) => ({ id, params, active }))), [
    { id: "ragents.mcp.status", params: { runId: "run-alpha" }, active: false },
    { id: "ragents.mcp.status", params: { runId: "run-beta" }, active: true },
  ]);
  assert.equal(await panel.getByRole("alert").count(), 0);
  await panel.getByText("Loading MCP server status...", { exact: true }).waitFor();
  for (const previousServer of ["files", "docs", "legacy"]) {
    assert.equal(await panel.getByText(previousServer, { exact: true }).count(), 0, "the new run must show no rows from the previous run before its initial message");
  }
  assert.equal(await panel.getByText("No MCP servers configured for this run.", { exact: true }).count(), 0);
  await page.evaluate(() => window.mcpStatusFixture.emit("run-beta", { servers: [] }));
  await panel.getByText("No MCP servers configured for this run.", { exact: true }).waitFor();
  assert.equal(await panel.getByText("docs", { exact: true }).count(), 0);
  await page.evaluate(() => window.mcpStatusFixture.emit("run-alpha", { servers: [{ name: "old-run-only", transport: "stdio", state: "connected", toolCount: 1 }] }));
  assert.equal(await panel.getByText("old-run-only", { exact: true }).count(), 0);

  await page.evaluate(() => window.mcpStatusFixture.emit("run-beta", { servers: [
    { name: "files", transport: "stdio", protocolVersion: "2026-07-28", state: "connected", toolCount: 4 },
    { name: "docs", transport: "http", protocolVersion: "2026-07-28", state: "connected", toolCount: 7 },
    { name: "legacy", transport: "sse", state: "failed", error: "Connection refused by the MCP server.", toolCount: 0 },
  ] }));
  await panel.getByText("Connection refused by the MCP server.", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(screenshotDirectory, "mcp-status.png") });
  assert.deepEqual(errors, []);
});
