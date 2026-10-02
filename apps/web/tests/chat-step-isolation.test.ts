import assert from "node:assert/strict";
import test from "node:test";
import { tailwindPlugin } from "./tailwind-plugin";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

test("chat detail levels start grouped and stay separate per run, actor, and display location", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async context => {
  await mkdir("/private/tmp/ragents-chat-tool-mode", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-chat-tool-mode/check-");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ChatStepsProvider,defaultChatDisplayPolicy,useChatSteps,primaryChatActor} from './apps/web/src/PluginRegistry';
import {ChatInputToolbar, ChatMessages, DetailModeSwitch} from 'quassel';
import {QuasselHost} from './apps/web/src/chat/QuasselHost';
import {ActorChat} from './plugins/ragents.orchestration/web/ActorChat';
import {ActorChatControls} from './plugins/ragents.orchestration/web/ActorChatControls';
import './apps/web/src/ui/tailwind.css';
const messages=[{key:'tool',role:'tool',text:'Read file',closed:true,tool:{id:'read',name:'read',arguments:'{}',result:'File content'}}];
function NormalChat() {
  const steps=useChatSteps('run-a',primaryChatActor({primaryActorId:'coordinator'}));
  return <section aria-label="normal"><DetailModeSwitch mode={steps.mode('coordinator')} onChange={mode=>steps.setMode('coordinator',mode)}/><ChatMessages messages={messages} detailMode={steps.mode('coordinator')}/><ChatInputToolbar running onSend={()=>{}}/></section>;
}
function Actor({run,id,name,presentation}) {
  const actor={id,handle:id,kind:'agent'};
  const view={id:run,primaryActorId:'coordinator',ownerId:'owner',actors:[actor],inputs:[],turns:[],artifacts:[]};
  return <section aria-label={name}><ActorChatControls actor={actor} view={view} composerVisible running={id !== "idle"} presentation={presentation}/><ActorChat actor={actor} view={view} presentation={presentation} primaryMessages={messages} conversation={messages} onNavigate={()=>{}}/></section>;
}
createRoot(document.getElementById('root')).render(<QuasselHost><ChatStepsProvider policy={{...defaultChatDisplayPolicy,selectable:true}}>
  <NormalChat/>
  <Actor run="run-a" id="coordinator" name="coordinator-surface" presentation="panel"/>
  <Actor run="run-a" id="implementer" name="implementer" presentation="panel"/>
  <Actor run="run-a" id="implementer" name="inspector" presentation="inspector"/>
  <Actor run="run-a" id="idle" name="idle" presentation="panel"/>
  <Actor run="run-b" id="implementer" name="other-run" presentation="panel"/>
</ChatStepsProvider></QuasselHost>);
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
  await page.addInitScript(() => {
    localStorage.setItem("ragents.chat-steps.agents", "full");
    localStorage.setItem("ragents.chat-steps.coordinator", "full");
  });
  await page.goto(`http://127.0.0.1:${address.port}`);
  const chat = (name: string) => page.getByRole("region", { name, exact: true });
  const mode = async (name: string, label: string) => {
    await chat(name).getByRole("button", { name: `Step detail level: ${label}`, exact: true }).waitFor();
  };
  const advance = (name: string, label: string) => chat(name).getByRole("button", { name: `Step detail level: ${label}`, exact: true }).click();
  const steps = (name: string) => chat(name).locator("[data-step]").evaluateAll(elements => elements.map(element => element.getAttribute("data-step")));
  const chats = ["normal", "coordinator-surface", "implementer", "inspector", "idle", "other-run"];
  for (const name of chats) await mode(name, "grouped");
  for (const name of chats) assert.deepEqual(await steps(name), ["group"], `${name} starts grouped; scope-wide entries are no choice of this chat`);
  await advance("implementer", "grouped");
  await mode("implementer", "single line");
  assert.deepEqual(await steps("implementer"), ["line"]);
  for (const name of ["normal", "coordinator-surface", "inspector", "idle", "other-run"]) await mode(name, "grouped");
  assert.deepEqual(await steps("inspector"), ["group"], "The inspector of the same chat keeps its own level.");
  await advance("inspector", "grouped");
  await advance("inspector", "single line");
  await mode("inspector", "everything");
  assert.deepEqual(await steps("inspector"), ["detail"]);
  await mode("implementer", "single line");
  await advance("normal", "grouped");
  await mode("normal", "single line");
  for (const name of ["coordinator-surface", "idle", "other-run"]) await mode(name, "grouped");
  await page.reload();
  await mode("normal", "single line");
  await mode("implementer", "single line");
  await mode("inspector", "everything");
  for (const name of ["coordinator-surface", "idle", "other-run"]) await mode(name, "grouped");
  assert.deepEqual(errors, []);
});
