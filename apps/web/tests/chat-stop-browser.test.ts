import assert from "node:assert/strict";
import test from "node:test";
import { tailwindPlugin } from "./tailwind-plugin";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

test("a chat's stop pauses the whole run while any actor works, the paused line resumes it, and a stopped actor's chat offers the restart", {
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
import {ChatInputToolbar} from 'quassel';
import {QuasselHost} from './apps/web/src/chat/QuasselHost';
import {runPausable} from './apps/web/src/chat/chat-target';
import {PausedRunNotice} from './apps/web/src/chat/PausedRunNotice';
import {pauseRun} from './apps/web/src/api';
import {ActorChatControls} from './plugins/ragents.orchestration/web/ActorChatControls';
import './apps/web/src/ui/tailwind.css';
const running={kind:'running',turnId:'t',inputId:'i',startedAt:'now'};
const idle={kind:'idle',since:'now'};
const pause={pausedAt:'now',reason:'Paused by the operator',userId:null};
const waiting={id:'input-1',actorId:'coordinator',content:'Next',artifactIds:[],sourceEventIds:[],subscriptionId:null,enqueuedBy:'owner',enqueuedAt:'now',sequence:1,lifecycle:{kind:'pending'}};
const runView=(run,coordinator,worker,paused=null,inputs=[])=>({id:run,primaryActorId:'coordinator',ownerId:'owner',inputs,turns:[],subscriptions:[],pluginStates:[],actions:[],artifacts:[],pause:paused,
  actors:[{id:'coordinator',handle:'coordinator',kind:'agent',lifecycle:coordinator},{id:'worker',handle:'worker',kind:'agent',lifecycle:worker}]});
function RunChat({name,view}) {
  const [error,setError]=React.useState();
  return <section aria-label={name}>
    <PausedRunNotice runId={view.id} view={view}/>
    {error&&<p role="alert">{error}</p>}
    <ChatInputToolbar running onSend={()=>{}} onStop={runPausable(view,view.id,false)?()=>void pauseRun(view.id).catch((cause)=>setError(cause.message)):undefined}/>
  </section>;
}
function Actor({run,id,lifecycle,others=[],presentation='surface'}) {
  const actor={id,handle:id,kind:'agent',lifecycle};
  const view={id:run,primaryActorId:'coordinator',ownerId:'owner',actors:[actor,...others],inputs:[],turns:[],subscriptions:[],pluginStates:[],actions:[],artifacts:[],pause:null};
  return <section aria-label={run+'/'+id}><ActorChatControls actor={actor} view={view} composerVisible running={lifecycle.kind==='running'} presentation={presentation}/></section>;
}
createRoot(document.getElementById('root')).render(<QuasselHost>
  <RunChat name="run-chat" view={runView('run-a',running,idle)}/>
  <RunChat name="run-chat-worker-busy" view={runView('run-c',idle,running)}/>
  <RunChat name="run-chat-paused" view={runView('run-p',idle,running,pause,[waiting])}/>
  <Actor run="run-a" id="implementer" lifecycle={running}/>
  <Actor run="run-b" id="implementer" lifecycle={running} presentation="inspector"/>
  <Actor run="run-d" id="helper" lifecycle={idle} others={[{id:'coordinator',handle:'coordinator',kind:'agent',lifecycle:running}]}/>
  <Actor run="run-a" id="waiting" lifecycle={idle}/>
  <Actor run="run-a" id="stopped" lifecycle={{kind:'stopped',stoppedAt:'now',reason:'Stopped by mistake'}} presentation="panel"/>
</QuasselHost>);
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
    const message = route.request().postDataJSON() as { id: number; method: string; params: { runId: string; actorId?: string; reason?: string } };
    if (!["ragents.runs.pause", "ragents.runs.resume", "ragents.runs.restartActor"].includes(message.method)) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Not available in the test" } }) });
      return;
    }
    requests.push(`${message.method} ${message.params.runId}${message.params.actorId === undefined ? "" : `/${message.params.actorId}`}${message.params.reason === undefined ? "" : ` (${message.params.reason})`}`);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(requests.length === 1
        ? { jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "Pause not possible" } }
        : { jsonrpc: "2.0", id: message.id, result: { id: message.params.runId } }),
    });
  });
  await page.goto(`http://127.0.0.1:${address.port}`);
  const chat = (name: string) => page.getByRole("region", { name, exact: true });
  const stop = (name: string) => chat(name).getByRole("button", { name: "Stop work", exact: true });
  await stop("run-a/implementer").waitFor();
  assert.equal(await stop("run-a/waiting").count(), 0, "without any running turn the input offers no stop");
  assert.equal(await stop("run-chat-worker-busy").count(), 1, "another actor's turn is enough for the run chat's stop");
  assert.equal(await stop("run-d/helper").count(), 1, "another actor's turn is enough for an actor chat's stop");
  assert.equal(await stop("run-chat-paused").count(), 0, "a paused run is not paused again");
  await chat("run-chat-paused").getByRole("status").filter({ hasText: "Paused - 1 input waiting" }).waitFor();
  assert.equal(await chat("run-chat").getByRole("status").count(), 0, "no paused line in a run that works");
  await chat("run-a/stopped").getByRole("status").filter({ hasText: "@stopped stopped: Stopped by mistake" }).waitFor();
  assert.equal(await chat("run-a/stopped").getByRole("textbox").count(), 0);

  await stop("run-a/implementer").click();
  await chat("run-a/implementer").getByRole("alert").filter({ hasText: "Pause not possible" }).waitFor();
  assert.equal(await chat("run-b/implementer").getByRole("alert").count(), 0);
  await stop("run-a/implementer").click();
  await stop("run-b/implementer").click();
  await stop("run-chat").click();
  await stop("run-chat-worker-busy").click();
  await stop("run-d/helper").click();
  await chat("run-chat-paused").getByRole("button", { name: "Resume", exact: true }).click();
  await chat("run-a/implementer").getByRole("textbox").fill("Further instruction");
  assert.equal(await stop("run-a/implementer").count(), 0);
  assert.equal(await chat("run-a/implementer").getByRole("button", { name: "Send", exact: true }).isEnabled(), true);
  await chat("run-a/stopped").getByRole("button", { name: "Restart", exact: true }).click();
  for (let attempt = 0; attempt < 50 && requests.length < 8; attempt += 1) await page.waitForTimeout(50);
  assert.deepEqual(requests, [
    "ragents.runs.pause run-a",
    "ragents.runs.pause run-a",
    "ragents.runs.pause run-b",
    "ragents.runs.pause run-a",
    "ragents.runs.pause run-c",
    "ragents.runs.pause run-d",
    "ragents.runs.resume run-p",
    "ragents.runs.restartActor run-a/stopped",
  ]);
  assert.deepEqual(errors, []);
});
