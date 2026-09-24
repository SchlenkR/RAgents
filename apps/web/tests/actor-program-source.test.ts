import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { tailwindPlugin } from "./tailwind-plugin";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { actorProgramSourceFrom, type ActorProgramsApi } from "../../../plugins/ragents.actor-programs/web/api.ts";
import { actorProgramSourceView } from "../../../plugins/ragents.actor-programs/web/ProgramSource";
import { ProgramSlotContext, type ProgramSlot } from "../../../plugins/ragents.orchestration/web/program-slot";
import { ACTOR_PROGRAMS_STATE_ID } from "../../../apps/server/src/plugin-support/actor-programs/contract";
import { FlowInspector } from "../../../plugins/ragents.orchestration/web/FlowInspector";
import type { RunActor, RunView } from "../src/run-view";
import { AccessContext } from "../src/AccessContext";
import { createAccessContext } from "../../../packages/ragents/src/access";

const files = [
  { path: "package.json", content: "{}" },
  { path: "src/server.ts", content: "export default defineActor({ functions: {} });" },
];

test("die Quellenliste behält die Reihenfolge des installierten Builds", () => {
  assert.deepEqual(actorProgramSourceFrom({ files }), files);
  assert.deepEqual(actorProgramSourceFrom({ files: [] }), []);
});

test("eine unvollständige Quellenliste ist ein Fehler", () => {
  assert.throws(() => actorProgramSourceFrom({}), /Vertrag/);
  assert.throws(() => actorProgramSourceFrom({ files: [{ path: "a.ts" }] }), /content/);
  assert.throws(() => actorProgramSourceFrom({ files: [{ content: "x" }] }), /path/);
  assert.throws(() => actorProgramSourceFrom({ files: [files[0], files[0]] }), /doppelte/);
});

const actor: RunActor = {
  id: "setup-actor", handle: "setup", kind: "script", displayName: "Development setup", grants: [],
  createdAt: "2026-09-14T10:00:00Z", lifecycle: { kind: "idle", since: "2026-09-14T10:00:00Z" }, toolNames: [],
};
const program = { name: "development-setup", actorId: actor.id, actorHandle: actor.handle, revision: "build-a", backendFile: "server.mjs", views: [], functions: [] };
const view = {
  id: "source-test", ownerId: "owner", primaryActorId: actor.id, actors: [actor],
  inputs: [], turns: [], actions: [], subscriptions: [], artifacts: [],
  pluginStates: [{ pluginId: ACTOR_PROGRAMS_STATE_ID, scope: { kind: "actor", actorId: actor.id }, state: { version: 1, program } }],
} as unknown as RunView;
const props = { view, selection: { type: "actor" as const, id: actor.id }, canGoBack: false, composerVisible: false,
  onNavigate: () => {}, onBack: () => {}, primaryMessages: [], primaryRunning: false };
const api = { source: () => assert.fail("Source is loaded only after opening its tab") } as unknown as ActorProgramsApi;
const slot: ProgramSlot = { runId: view.id, needsAnswer: () => false, openFullscreen: () => {}, source: (current, actorId) => actorProgramSourceView(api, current, actorId) };
const withProgram = (children: ReactNode) => createElement(ProgramSlotContext.Provider, { value: slot }, children);

test("headless TypeScript actors expose their installed source without views, tools or actor.source", () => {
  const html = renderToStaticMarkup(withProgram(createElement(FlowInspector, props)));
  assert.match(html, /aria-label="Quelltext"/);
  assert.doesNotMatch(html, /Quelle des installierten Builds|Quellcode wird geladen|export default/);
  const chat = html.match(/<button[^>]*aria-label="Chat anzeigen"[^>]*>(.*?)<\/button>/)?.[1];
  assert.ok(chat);
  assert.match(chat, /<svg/);
  assert.match(chat, /M21 11a8 8/);
  assert.doesNotMatch(chat, /M18 6 6 18|m6 6 12 12/);
});

test("the installed-source tab requires a provider, a program and inspection rights", () => {
  const noProvider = renderToStaticMarkup(createElement(FlowInspector, props));
  const noProgram = renderToStaticMarkup(withProgram(createElement(FlowInspector, { ...props, view: { ...view, pluginStates: [] } })));
  const restricted = createAccessContext({ enabled: true, user: { id: "reader", label: "Reader", rights: ["runs.read"], startEntries: [] } });
  const noInspection = renderToStaticMarkup(createElement(AccessContext.Provider, { value: { ...restricted, logout: async () => {} } },
    withProgram(createElement(FlowInspector, props))));
  for (const html of [noProvider, noProgram, noInspection]) assert.doesNotMatch(html, /aria-label="Quelltext"|Quelle des installierten Builds/);
});

test("opening an actor source loads the installed files and replaces stale responses after a program revision", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async (context) => {
  const scratch = "/private/tmp/ragents-actor-source-ui";
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(`${scratch}/run-`);
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    stdin: { contents: `
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { FlowInspector } from "./plugins/ragents.orchestration/web/FlowInspector";
import { ProgramSlotContext } from "./plugins/ragents.orchestration/web/program-slot";
import { actorProgramSourceView } from "./plugins/ragents.actor-programs/web/ProgramSource";
import { AccessContext } from "./apps/web/src/AccessContext";
import { createAccessContext } from "./packages/ragents/src/access";
import "./apps/web/src/ui/tailwind.css";
const initialView = ${JSON.stringify(view)};
const fixture = window.sourceFixture = { revision: "build-a", provider: true, program: true, inspect: true, calls: [], update: () => {} };
const api = { source: async (runId, moduleId, signal) => new Promise(resolve => {
  const revision = fixture.revision;
  const call = { runId, moduleId, signal, revision, resolve: () => resolve([
    { path: "package.json", content: JSON.stringify({ name: "development-setup" }) },
    { path: "src/helper.ts", content: 'export const helper = "helper-' + revision + '";' },
    { path: "src/server.ts", content: ['export const build = "source-' + revision + '";', 'export const longValue = "' + 'x'.repeat(300) + '";'].join(String.fromCharCode(10)) },
  ]) };
  fixture.calls.push(call);
}) };
const value = { runId: initialView.id, needsAnswer: () => false, openFullscreen: () => {}, source: (view, actorId) => actorProgramSourceView(api, view, actorId) };
function Harness() {
  const [, update] = useState(0);
  fixture.update = changes => { Object.assign(fixture, changes); update(value => value + 1); };
  const view = { ...initialView, pluginStates: fixture.program ? initialView.pluginStates.map(entry => ({ ...entry, state: { ...entry.state, program: { ...entry.state.program, revision: fixture.revision } } })) : [] };
  const access = createAccessContext({ enabled: true, user: { id: "reader", label: "Reader", rights: fixture.inspect ? ["runs.read", "runs.inspect"] : ["runs.read"], startEntries: [] } });
  const inspector = createElement(FlowInspector, { view, selection: { type: "actor", id: ${JSON.stringify(actor.id)} }, canGoBack: false, composerVisible: false, onNavigate: () => {}, onBack: () => {}, primaryMessages: [], primaryRunning: false });
  return createElement(AccessContext.Provider, { value: { ...access, logout: async () => {} } }, fixture.provider ? createElement(ProgramSlotContext.Provider, { value }, inspector) : inspector);
}
createRoot(document.getElementById("root")).render(createElement(Harness));`, resolveDir: root, loader: "tsx" },
    outfile: `${directory}/fixture.js`, bundle: true, platform: "browser", format: "iife", jsx: "automatic", plugins: [tailwindPlugin([`${root}plugins/ragents.orchestration/web`, `${root}plugins/ragents.actor-programs/web`])], logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const server = createServer(async (request, response) => {
    if (request.url === "/fixture.js" || request.url === "/fixture.css") {
      response.setHeader("Content-Type", request.url.endsWith("js") ? "text/javascript" : "text/css");
      response.end(await readFile(`${directory}${request.url}`));
      return;
    }
    if (request.url !== "/") { response.writeHead(404); response.end(); return; }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:24px"><div id="root" style="width:800px;max-width:100%;height:650px"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  context.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH, headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 740 } });
  page.setDefaultTimeout(7000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByRole("tab", { name: "Quelltext", exact: true }).waitFor();
  assert.equal(await page.evaluate("window.sourceFixture.calls.length"), 0);
  const chat = page.getByRole("tab", { name: "Chat anzeigen", exact: true });
  assert.match(await chat.innerHTML(), /M21 11a8 8/);
  await page.getByRole("tab", { name: "Quelltext", exact: true }).click();
  await page.waitForFunction("window.sourceFixture.calls.length === 1");
  assert.deepEqual(await page.evaluate("window.sourceFixture.calls.map(({ runId, moduleId }) => ({ runId, moduleId }))"), [{ runId: view.id, moduleId: program.name }]);
  await page.evaluate("window.sourceFixture.calls[0].resolve()");
  await page.waitForFunction("document.querySelector('[data-slot=source-code]')?.textContent.includes('source-build-a')");
  assert.equal(await page.getByRole("button", { name: "Quellcode anzeigen", exact: true }).count(), 0);
  await page.getByRole("button", { name: "src/helper.ts", exact: true }).click();
  assert.match(await page.locator("[data-slot=source-code]").innerText(), /helper-build-a/);
  await page.evaluate("window.sourceFixture.update({ revision: 'build-b' })");
  await page.waitForFunction("window.sourceFixture.calls.length === 2");
  assert.equal(await page.locator("[data-slot=source-code]").count(), 0);
  await page.evaluate("window.sourceFixture.calls[1].resolve()");
  await page.waitForFunction("document.querySelector('[data-slot=source-code]')?.textContent.includes('source-build-b')");
  await page.evaluate("window.sourceFixture.update({ revision: 'build-c' })");
  await page.waitForFunction("window.sourceFixture.calls.length === 3");
  await page.evaluate("window.sourceFixture.update({ revision: 'build-d' })");
  await page.waitForFunction("window.sourceFixture.calls.length === 4");
  assert.equal(await page.evaluate("window.sourceFixture.calls[2].signal.aborted"), true);
  await page.evaluate("window.sourceFixture.calls[3].resolve()");
  await page.waitForFunction("document.querySelector('[data-slot=source-code]')?.textContent.includes('source-build-d')");
  await page.evaluate("window.sourceFixture.calls[2].resolve()");
  assert.match(await page.locator("[data-slot=source-code]").innerText(), /source-build-d/);
  assert.doesNotMatch(await page.locator("[data-slot=source-code]").innerText(), /source-build-c/);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: `${directory}/installed-source.png` });
  for (const width of [320, 480]) {
    await page.setViewportSize({ width, height: 740 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator("[data-slot=source-code]").evaluate((element) => element.scrollWidth > element.clientWidth), true);
    assert.equal(await page.getByRole("button", { name: "src/server.ts", exact: true }).isVisible(), true);
    if (width === 320) await page.screenshot({ path: `${directory}/installed-source-narrow.png` });
  }
  await chat.click();
  assert.equal(await chat.getAttribute("aria-selected"), "true");
  assert.equal(await page.getByRole("heading", { name: "Quellcode", exact: true }).count(), 0);
  for (const changes of [{ provider: false }, { provider: true, program: false }, { program: true, inspect: false }]) {
    await page.evaluate((changes) => (window as any).sourceFixture.update(changes), changes);
    await page.waitForFunction("!document.querySelector('[role=tab][aria-label=Quelltext]')");
    assert.equal(await page.evaluate("window.sourceFixture.calls.length"), 4);
  }
  assert.deepEqual(errors, []);
  context.diagnostic(`Screenshot und Browserfixture: ${directory}`);
});
