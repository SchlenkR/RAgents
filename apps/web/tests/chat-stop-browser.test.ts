import assert from "node:assert/strict";
import test from "node:test";
import { tailwindPlugin } from "./tailwind-plugin";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

test("a chat's stop interrupts only the running turn of its own actor, and a stopped actor's chat offers the restart", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async context => {
  await mkdir("/private/tmp/ragents-chat-stop", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-chat-stop/check-");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ChatInputToolbar} from './apps/web/src/chat/ChatInputToolbar';
import {primaryChatState} from './apps/web/src/chat/chat-target';
import {interruptActorTurn} from './apps/web/src/api';
import {ActorChatControls} from './plugins/ragents.orchestration/web/ActorChatControls';
import './apps/web/src/ui/tailwind.css';
const running={kind:'running',turnId:'t',inputId:'i',startedAt:'now'};
const idle={kind:'idle',since:'now'};
const runView=(coordinator,worker)=>({id:'run-a',primaryActorId:'coordinator',ownerId:'owner',inputs:[],turns:[],subscriptions:[],pluginStates:[],actions:[],artifacts:[],
  actors:[{id:'coordinator',handle:'coordinator',kind:'agent',lifecycle:coordinator},{id:'worker',handle:'worker',kind:'agent',lifecycle:worker}]});
function RunChat({name,view}) {
  const partner=primaryChatState(view,'run-a',false);
  return <section aria-label={name}><ChatInputToolbar running onSend={()=>{}} onStop={partner.kind==='active'&&partner.turnRunning?()=>void interruptActorTurn('run-a',partner.actorId):undefined}/></section>;
}
function Actor({run,id,lifecycle,presentation='surface'}) {
  const actor={id,handle:id,kind:'agent',lifecycle};
  const view={id:run,primaryActorId:'coordinator',ownerId:'owner',actors:[actor],inputs:[],turns:[],artifacts:[]};
  return <section aria-label={run+'/'+id}><ActorChatControls actor={actor} view={view} composerVisible running presentation={presentation}/></section>;
}
createRoot(document.getElementById('root')).render(<>
  <RunChat name="run-chat" view={runView(running,idle)}/>
  <RunChat name="run-chat-worker-busy" view={runView(idle,running)}/>
  <Actor run="run-a" id="implementer" lifecycle={running}/>
  <Actor run="run-b" id="implementer" lifecycle={running} presentation="inspector"/>
  <Actor run="run-a" id="waiting" lifecycle={idle}/>
  <Actor run="run-a" id="stopped" lifecycle={{kind:'stopped',stoppedAt:'now',reason:'Versehentlich gestoppt'}} presentation="panel"/>
</>);
` },
    outfile: `${directory}/fixture.js`, bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, plugins: [tailwindPlugin([`${root}apps/web/src/chat`])], logLevel: "silent",
  });
  const server = createServer(async (request, response) => {
    if (request.url === "/fixture.js" || request.url === "/fixture.css") {
      response.setHeader("Content-Type", request.url.endsWith(".js") ? "text/javascript" : "text/css");
      response.end(await readFile(`${directory}${request.url}`));
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"><link rel="icon" href="data:,"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
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
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const requests: string[] = [];
  await page.route("**/rpc", async route => {
    const message = route.request().postDataJSON() as { id: number; method: string; params: { runId: string; actorId: string } };
    if (message.method !== "ragents.runs.interruptTurn" && message.method !== "ragents.runs.restartActor") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Im Test nicht verfügbar" } }) });
      return;
    }
    requests.push(`${message.method} ${message.params.runId}/${message.params.actorId}`);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(requests.length === 1
        ? { jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "Unterbrechen nicht möglich" } }
        : { jsonrpc: "2.0", id: message.id, result: null }),
    });
  });
  await page.goto(`http://127.0.0.1:${address.port}`);
  const chat = (name: string) => page.getByRole("region", { name, exact: true });
  const stop = (name: string) => chat(name).getByRole("button", { name: "Arbeit stoppen", exact: true });
  await stop("run-a/implementer").waitFor();
  assert.equal(await stop("run-a/waiting").count(), 0, "ohne eigenen Turn bietet die Eingabe keinen Stopp an");
  assert.equal(await stop("run-chat-worker-busy").count(), 0, "arbeitet ein anderer Actor, stoppt der Run-Chat nichts");
  await chat("run-a/stopped").getByRole("status").filter({ hasText: "@stopped gestoppt: Versehentlich gestoppt" }).waitFor();
  assert.equal(await chat("run-a/stopped").getByRole("textbox").count(), 0);

  await stop("run-a/implementer").click();
  await chat("run-a/implementer").getByRole("alert").filter({ hasText: "Unterbrechen nicht möglich" }).waitFor();
  assert.equal(await chat("run-b/implementer").getByRole("alert").count(), 0);
  await stop("run-a/implementer").click();
  await stop("run-b/implementer").click();
  await stop("run-chat").click();
  await chat("run-a/implementer").getByRole("textbox").fill("Weitere Anweisung");
  assert.equal(await stop("run-a/implementer").count(), 0);
  assert.equal(await chat("run-a/implementer").getByRole("button", { name: "Senden", exact: true }).isEnabled(), true);
  await chat("run-a/stopped").getByRole("button", { name: "Neu starten", exact: true }).click();
  for (let attempt = 0; attempt < 50 && requests.length < 5; attempt += 1) await page.waitForTimeout(50);
  assert.deepEqual(requests, [
    "ragents.runs.interruptTurn run-a/implementer",
    "ragents.runs.interruptTurn run-a/implementer",
    "ragents.runs.interruptTurn run-b/implementer",
    "ragents.runs.interruptTurn run-a/coordinator",
    "ragents.runs.restartActor run-a/stopped",
  ]);
  assert.deepEqual(errors, []);
});
