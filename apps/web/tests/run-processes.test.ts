import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import nodeProcess from "node:process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { tailwindPlugin } from "./tailwind-plugin";
import { build } from "esbuild";
import { chromium } from "playwright-core";

import type { RunProcess } from "../../../plugins/ragents.processes/contract.ts";
import {
  kindLabel,
  messageFrom,
  serviceUrl,
  titleOf,
  visibleProcesses,
  VISIBLE_PROCESSES,
} from "../../../plugins/ragents.processes/web/processes.ts";

const process = (values: Partial<RunProcess> & { pid: number }): RunProcess => ({
  id: `process-${values.pid}`,
  label: "node vite",
  command: "node /work/node_modules/.bin/vite",
  origin: "background",
  ports: [],
  seenSince: "2026-09-03T10:00:00.000Z",
  ...values,
});

test("eine Nachricht des Stroms wird geprüft und typisiert", () => {
  const snapshot = {
    runId: "run-1",
    observedAt: "2026-09-03T10:00:00.000Z",
    processes: [process({ pid: 7, ports: [{ port: 5173, address: "*" }] })],
  };
  assert.deepEqual(messageFrom({ kind: "snapshot", snapshot }), { kind: "snapshot", snapshot });
  assert.deepEqual(messageFrom({ kind: "error", error: "kaputt" }), { kind: "error", error: "kaputt" });
  assert.throws(() => messageFrom({ kind: "snapshot", snapshot: { runId: "run-1" } }), /unlesbar/);
  assert.throws(() => messageFrom({ kind: "snapshot", snapshot: { ...snapshot, processes: [{ pid: 1 }] } }), /Prozess-Eintrag/);
  assert.throws(() => messageFrom({ kind: "snapshot", snapshot: { ...snapshot, processes: [{ ...snapshot.processes[0], id: "" }] } }), /Prozess-Eintrag/);
  assert.throws(() => messageFrom({ kind: "anders" }), /unbekannte Art/);
});

test("die Dienst-Adresse nutzt den Host der Oberfläche und den Port des Prozesses", () => {
  assert.equal(serviceUrl("localhost", 5173), "http://localhost:5173/");
  assert.equal(serviceUrl("workstation", 10520), "http://workstation:10520/");
  assert.equal(serviceUrl("::1", 8080), "http://[::1]:8080/");
});

test("Beschriftung und Tooltip nennen Art, Befehl, Herkunft und Ports", () => {
  const service = process({ pid: 7, ports: [{ port: 5173, address: "*" }, { port: 5173, address: "::1" }] });
  assert.equal(kindLabel(service), "Dienst");
  assert.equal(kindLabel(process({ pid: 8 })), "Prozess");
  const title = titleOf(service);
  assert.ok(title.startsWith("node /work/node_modules/.bin/vite\nPID 7, läuft im Hintergrund weiter, beobachtet seit "));
  assert.ok(title.endsWith("\nLauscht auf *:5173, ::1:5173"));
  assert.ok(titleOf(process({ pid: 8, origin: "tool-call" })).includes("läuft in einem Werkzeugaufruf"));
});

test("die Kopfzeile zeigt höchstens die ersten Einträge und zählt den Rest", () => {
  const many = Array.from({ length: VISIBLE_PROCESSES + 2 }, (_, index) => process({ pid: index + 1 }));
  const visible = visibleProcesses(many);
  assert.equal(visible.shown.length, VISIBLE_PROCESSES);
  assert.equal(visible.hidden, 2);
  assert.deepEqual(visibleProcesses([]), { shown: [], hidden: 0 });
});

test("process readers see live services and port links while stopping still requires write and inspection rights", {
  skip: nodeProcess.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async (context) => {
  const directory = await mkdtemp("/private/tmp/ragents-process-header-");
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const snapshot = { runId: "preview-run", observedAt: "2026-09-14T12:00:00Z", processes: [
    process({ pid: 11, label: "dotnet ApiService.dll", command: "dotnet /fixture/ApiService.dll", ports: [{ port: 10520, address: "127.0.0.1" }] }),
    process({ pid: 12, label: "dotnet DashboardServer.dll", command: "dotnet /fixture/DashboardServer.dll", ports: [{ port: 10521, address: "127.0.0.1" }] }),
  ] };
  await build({
    stdin: { contents: `
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { AccessContext } from "./apps/web/src/AccessContext";
import { createAccessContext } from "./packages/ragents/src/access";
import "./apps/web/src/ui/tailwind.css";
import { webPlugin } from "./plugins/ragents.processes/web/index";
const snapshot = ${JSON.stringify(snapshot)};
const plugin = webPlugin.activate({});
const header = plugin.sessionHeaders[0];
const fixture = window.processFixture = {
  rights: ["runs.read", "runs.write", "ragents.processes.read"], streams: [], channels: [], stops: [], update: () => {}, readRight: header.readRight,
};
let connections = 0;
window.fetch = async (url, options = {}) => {
  const encoder = new TextEncoder();
  if (url.endsWith("/rpc/stream")) {
    const entry = { url, closed: false, push: () => {} };
    fixture.streams.push(entry);
    const body = new ReadableStream({
      start(controller) {
        entry.push = message => controller.enqueue(encoder.encode("data: " + JSON.stringify(message) + "\\n\\n"));
        controller.enqueue(encoder.encode('event: hello\\ndata: {"connection":"c' + (++connections) + '"}\\n\\n'));
        options.signal?.addEventListener("abort", () => {
          entry.closed = true;
          try { controller.close(); } catch { /* der Strom ist schon zu */ }
        });
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  const message = JSON.parse(options.body);
  const answer = result => new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id ?? null, result }), { status: 200 });
  if (message.method === "rpc.subscribe") {
    fixture.channels.push(message.params.channel);
    const subscription = "s" + fixture.channels.length;
    queueMicrotask(() => fixture.streams.at(-1).push({
      jsonrpc: "2.0", method: "rpc.event", params: { subscription, channel: message.params.channel, message: { kind: "snapshot", snapshot } },
    }));
    return answer({ subscription });
  }
  if (message.method === "ragents.processes.stop") {
    fixture.stops.push({ method: message.method, params: message.params });
    return answer(null);
  }
  return answer(null);
};
function Harness() {
  const [, render] = useState(0);
  fixture.update = rights => { fixture.rights = rights; render(value => value + 1); };
  const access = createAccessContext({ enabled: true, user: { id: "reader", label: "Reader", rights: fixture.rights } });
  return createElement(AccessContext.Provider, { value: { ...access, logout: async () => {} } },
    access.can(header.readRight) ? createElement(header.Header, { session: { session: { id: snapshot.runId } } }) : null);
}
createRoot(document.getElementById("root")).render(createElement(Harness));`, resolveDir: root, loader: "tsx" },
    outfile: `${directory}/fixture.js`, bundle: true, platform: "browser", format: "iife", jsx: "automatic", plugins: [tailwindPlugin([`${root}plugins/ragents.processes/web`])], logLevel: "silent",
  });
  const server = createServer(async (request, response) => {
    if (request.url === "/fixture.js" || request.url === "/fixture.css") {
      response.setHeader("Content-Type", request.url.endsWith("js") ? "text/javascript" : "text/css");
      response.end(await readFile(`${directory}${request.url}`));
      return;
    }
    if (request.url !== "/") { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0;padding:0"><header class="flex min-h-header items-stretch bg-shell"><div id="root" class="flex min-w-0 flex-1 items-stretch"></div></header><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ executablePath: nodeProcess.env.BROWSER_EXECUTABLE_PATH, headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 850, height: 180 } });
  page.setDefaultTimeout(7000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByText("dotnet DashboardServer.dll", { exact: true }).waitFor();
  assert.equal(await page.evaluate("window.processFixture.readRight"), "ragents.processes.read");
  assert.deepEqual(await page.evaluate("window.processFixture.streams.map(stream => stream.url)"), ["/rpc/stream"]);
  assert.deepEqual(await page.evaluate("window.processFixture.channels"), ["ragents.processes"]);
  for (const port of [10520, 10521]) {
    const link = page.getByRole("link", { name: `:${port}`, exact: true });
    assert.equal(await link.getAttribute("href"), `http://127.0.0.1:${port}/`);
    assert.equal(await link.isVisible(), true);
  }
  const stop = page.getByRole("button", { name: "dotnet ApiService.dll beenden", exact: true });
  assert.equal(await stop.isDisabled(), true);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: `${directory}/processes-reader.png` });
  await page.setViewportSize({ width: 320, height: 180 });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert.equal(await page.getByRole("link", { name: ":10520", exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Alle 2", { exact: true }).innerText(), "Alle 2");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByText("Alle 2", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${directory}/processes-reader-narrow.png` });
  await page.setViewportSize({ width: 850, height: 180 });
  await page.evaluate("window.processFixture.update(['runs.read', 'runs.inspect', 'ragents.processes.read'])");
  assert.equal(await stop.isDisabled(), true);
  await page.evaluate("window.processFixture.update(['runs.read', 'runs.write', 'runs.inspect', 'ragents.processes.read'])");
  await stop.click();
  assert.deepEqual(await page.evaluate("window.processFixture.stops"), [{ method: "ragents.processes.stop", params: { runId: "preview-run", processId: "process-11" } }]);
  await page.evaluate("window.processFixture.update(['runs.read', 'runs.write', 'runs.inspect'])");
  await page.waitForFunction(`document.querySelector('[aria-label="Prozesse und Ports des Runs"]') === null`);
  assert.equal(await page.evaluate("window.processFixture.streams[0].closed"), true);
  await page.evaluate("window.processFixture.update(['ragents.processes.read'])");
  assert.equal(await page.locator('[aria-label="Prozesse und Ports des Runs"]').count(), 0);
  assert.equal(await page.evaluate("window.processFixture.streams.length"), 1);
  await page.evaluate("window.processFixture.update(['runs.read', 'ragents.processes.read'])");
  await page.getByText("dotnet DashboardServer.dll", { exact: true }).waitFor();
  assert.equal(await stop.isDisabled(), true);
  assert.equal(await page.evaluate("window.processFixture.streams.length"), 2);
  assert.deepEqual(errors, []);
  context.diagnostic(`Process header screenshots: ${directory}`);
});
