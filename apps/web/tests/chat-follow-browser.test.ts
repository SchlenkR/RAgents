import assert from "node:assert/strict";
import test from "node:test";
import { tailwindPlugin } from "./tailwind-plugin";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

test("chat following survives browser clamping, streaming and working scenes while real upward input pauses", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async () => {
  const scratch = "/private/tmp/ragents-chat-follow";
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(`${scratch}/run-`);
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{ChatMessages}from'${root}apps/web/src/chat/ChatMessages.tsx';import{ChatPanel}from'${root}apps/web/src/chat/ChatPanel.tsx';
import '${root}apps/web/src/ui/tailwind.css';
const root=createRoot(document.getElementById('app'));
window.fixture={mode:'all',composer:40,messages:Array.from({length:20},(_,i)=>({key:String(i),role:'assistant',text:('Dies ist eine längere Nachricht mit mehreren Zeilen und einem konkreten Inhalt. ').repeat(8)}))};
window.update=()=>flushSync(()=>root.render(<ChatPanel composer={<div style={{height:window.fixture.composer}}>Eingabe</div>}><ChatMessages running detailMode={window.fixture.mode} messages={[...window.fixture.messages]}/></ChatPanel>));window.update();`,resolveDir:`${root}apps/web`,loader:"tsx"},bundle:true,platform:"browser",format:"iife",outfile:`${directory}/app.js`,plugins: [tailwindPlugin([`${root}apps/web/src/chat`])], logLevel:"silent"});
  await writeFile(`${directory}/index.html`,'<!doctype html><html><head><link rel="stylesheet" href="app.css"><style>#app{width:420px;height:500px;display:flex;flex-direction:column}#app>[data-chat=panel]{height:100%;width:100%}</style></head><body><div id="app"></div><script src="app.js"></script></body></html>');
  const browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
  try {
    const page = await browser.newPage({viewport:{width:1300,height:900}});
    await page.goto(`file://${directory}/index.html`);
    const bottom = () => page.waitForFunction(() => {const e=document.querySelector<HTMLElement>("[aria-label=Chatverlauf]")!;return e.scrollHeight-e.clientHeight-e.scrollTop<2;});
    const stream = () => page.evaluate(() => {const w=window as any;w.fixture.messages.push({key:String(w.fixture.messages.length),role:"assistant",text:"Ein weiterer Absatz. ".repeat(20)});w.update();});
    await bottom();
    const clamped = await page.evaluate(() => {
      const e=document.querySelector<HTMLElement>("[aria-label=Chatverlauf]")!;const app=document.querySelector<HTMLElement>("#app")!;const before=e.scrollTop;
      app.style.width="1200px";void e.scrollHeight;const reduced=e.scrollTop;app.style.width="420px";
      const w=window as any;w.fixture.messages.push({key:"resize",role:"assistant",text:"Neue Nachricht"});w.update();return {before,reduced,gap:e.scrollHeight-e.clientHeight-e.scrollTop};
    });
    assert.ok(clamped.reduced < clamped.before,"Browser hat den Scrollwert tatsächlich geklemmt.");
    assert.ok(clamped.gap < 2,JSON.stringify(clamped));
    await page.locator("[aria-label=Chatverlauf]").hover();
    await page.mouse.wheel(0,-600);
    await page.waitForFunction(() => !!document.querySelector("[aria-label='Zum Ende springen']"));
    const beforeStream = await page.locator("[aria-label=Chatverlauf]").evaluate(e=>e.scrollTop);
    await stream();
    assert.equal(await page.locator("[aria-label=Chatverlauf]").evaluate(e=>e.scrollTop),beforeStream,"Echtes Aufwärtsscrollen bleibt erhalten.");
    await page.mouse.wheel(0,100000);
    await bottom();
    const scene = await page.locator("[data-chat=working]").last().textContent();
    await page.waitForFunction(previous=>document.querySelector("[data-chat=working]")?.textContent!==previous,scene);
    for(let i=0;i<4;i++){await stream();await bottom();}
    assert.equal(await page.locator("[aria-label='Zum Ende springen']").count(),0);
    await page.evaluate(()=>{const w=window as any;w.fixture.composer=180;w.update();});await bottom();
    await page.evaluate(()=>{const w=window as any;w.fixture.messages.push({key:"tool",role:"tool",text:"Werkzeug läuft",tool:{id:"tool",name:"read",arguments:"{}"}});w.fixture.mode="off";w.update();});await bottom();
    await page.evaluate(()=>{const w=window as any;w.fixture.mode="all";w.update();});await bottom();
    await page.evaluate(()=>{const app=document.querySelector<HTMLElement>("#app")!;app.style.display="none";(window as any).update();});
    await stream();
    await page.evaluate(()=>{document.querySelector<HTMLElement>("#app")!.style.display="flex";});await bottom();
    await page.locator("[aria-label=Chatverlauf]").focus();await page.keyboard.press("PageUp");
    await page.waitForFunction(()=>!!document.querySelector("[aria-label='Zum Ende springen']"));
    await stream();assert.equal(await page.locator("[aria-label='Zum Ende springen']").count(),1);
    await page.evaluate(()=>{document.querySelector<HTMLElement>("#app")!.style.display="none";(window as any).update();});
    await stream();
    await page.evaluate(()=>{document.querySelector<HTMLElement>("#app")!.style.display="flex";});
    await page.waitForFunction(()=>document.querySelector<HTMLElement>("[aria-label=Chatverlauf]")!.clientHeight>0);
    await stream();assert.equal(await page.locator("[aria-label='Zum Ende springen']").count(),1,"Leseposition bleibt über inaktive Tabs erhalten.");
    await page.locator("[aria-label=Chatverlauf]").hover();await page.mouse.wheel(0,100000);await bottom();await stream();await bottom();
    await page.screenshot({path:`${directory}/following.png`});
  } finally {await browser.close();}
});
