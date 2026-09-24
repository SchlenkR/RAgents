import assert from "node:assert/strict";
import test from "node:test";
import { tailwindPlugin } from "./tailwind-plugin";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

test("nested fixed actor popouts own their wheel events independently of the canvas shortcut bar", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async (context) => {
  const scratch = "/private/tmp/ragents-canvas-popout-scroll";
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(`${scratch}/run-`);
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({stdin:{contents:`import React,{useRef,useState}from'react';import{createRoot}from'react-dom/client';
import{CanvasShortcuts}from'${root}apps/web/src/CanvasShortcuts.tsx';
import{ActorPopout}from'${root}plugins/ragents.orchestration/web/ActorPopout.tsx';
import{ChatMessages}from'${root}apps/web/src/chat/ChatMessages.tsx';
import '${root}apps/web/src/ui/tailwind.css';
function App(){const button=useRef(null);const[open,setOpen]=useState(false);const[short,setShort]=useState(false);window.fixture={setShort};const messages=Array.from({length:short?1:30},(_,i)=>({key:String(i),role:'assistant',text:short?'Eine kurze Nachricht.':('Eine ausführliche Nachricht mit mehreren Zeilen. ').repeat(12)}));
return <main style={{width:600,margin:20}}><CanvasShortcuts><div><button ref={button} onClick={()=>setOpen(true)} style={{height:44}}>Actor öffnen</button><ActorPopout open={open} id="actor" label="Actor-Chat" closeLabel="Schließen" buttonRef={button} onClose={()=>setOpen(false)} width={440} height={500} role="dialog"><div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain"><div style={{height:"100%",display:"flex",flexDirection:"column"}}><ChatMessages messages={messages}/></div></div></ActorPopout></div>{Array.from({length:20},(_,i)=><button key={i} style={{width:130}}>Weiterer Actor {i}</button>)}</CanvasShortcuts></main>}
createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:`${root}apps/web`,loader:"tsx"},jsx:"automatic",bundle:true,platform:"browser",format:"iife",outfile:`${directory}/app.js`,plugins: [tailwindPlugin([`${root}plugins/ragents.orchestration/web`])], logLevel:"silent"});
  await writeFile(`${directory}/index.html`,'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
  const browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
  try {
    const page = await browser.newPage({viewport:{width:1100,height:900},reducedMotion:"reduce"});
    page.setDefaultTimeout(5000);
    page.on("pageerror", error => context.diagnostic(error.message));
    await page.goto(`file://${directory}/index.html`);
    const bar = page.getByRole("group",{name:"Apps und Actors durchblättern"});
    const left = () => bar.evaluate(e=>e.scrollLeft);
    await page.getByRole("button",{name:"Apps und Actors nach rechts"}).waitFor();
    assert.ok(await bar.evaluate(e=>e.scrollWidth>e.clientWidth));
    await page.getByRole("button",{name:"Actor öffnen",exact:true}).click();
    const chat = page.getByRole("region",{name:"Chatverlauf"});
    await page.waitForFunction(()=>{const e=document.querySelector<HTMLElement>('[aria-label="Chatverlauf"]')!;return e&&e.scrollHeight-e.clientHeight-e.scrollTop<2;});
    assert.equal(await page.getByRole("dialog",{name:"Actor-Chat"}).count(),1,"The popout opens once.");
    const barBefore = await left();
    const chatBefore = await chat.evaluate(e=>e.scrollTop);
    await chat.hover();await page.mouse.wheel(0,-350);
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    const up = await chat.evaluate(e=>e.scrollTop);
    assert.ok(up<chatBefore,`Upward wheel must scroll chat: before=${chatBefore}, after=${up}, bar=${await left()}`);
    assert.equal(await left(),barBefore);
    await page.mouse.wheel(0,180);
    await page.waitForFunction(previous=>document.querySelector<HTMLElement>('[aria-label="Chatverlauf"]')!.scrollTop>previous,up);
    assert.equal(await left(),barBefore,"Downward wheel stays inside the chat.");
    await page.mouse.wheel(400,0);await page.evaluate(()=>new Promise(requestAnimationFrame));
    assert.equal(await left(),barBefore,"Horizontal trackpad scrolling stays inside the popout.");
    await page.mouse.wheel(0,100000);
    await page.waitForFunction(()=>{const e=document.querySelector<HTMLElement>('[aria-label="Chatverlauf"]')!;return e.scrollHeight-e.clientHeight-e.scrollTop<2;});
    await page.mouse.wheel(0,400);await page.evaluate(()=>new Promise(requestAnimationFrame));
    assert.equal(await left(),barBefore,"The bottom boundary must not forward scrolling to the header.");
    await page.mouse.wheel(0,-100000);await page.waitForFunction(()=>document.querySelector<HTMLElement>('[aria-label="Chatverlauf"]')!.scrollTop===0);
    await page.mouse.wheel(0,-400);await page.evaluate(()=>new Promise(requestAnimationFrame));
    assert.equal(await left(),barBefore,"The top boundary must not forward scrolling to the header.");
    await page.evaluate(()=>(window as any).fixture.setShort(true));
    await page.waitForFunction(()=>{const e=document.querySelector<HTMLElement>('[aria-label="Chatverlauf"]')!;return e.scrollHeight===e.clientHeight;});
    await chat.hover();await page.mouse.wheel(0,400);await page.evaluate(()=>new Promise(requestAnimationFrame));
    assert.equal(await left(),barBefore,"A non-scrollable chat still owns its wheel events.");
    await page.mouse.wheel(400,0);await page.evaluate(()=>new Promise(requestAnimationFrame));
    assert.equal(await left(),barBefore,"Horizontal trackpad scrolling in a short popout does not reach the header.");
    await page.getByRole("button",{name:"Schließen",exact:true}).click();
    await bar.hover();await page.mouse.wheel(0,240);
    await page.waitForFunction(()=>document.querySelector<HTMLElement>('[aria-label="Apps und Actors durchblättern"]')!.scrollLeft>0);
    const afterWheel = await left();
    await page.getByRole("button",{name:"Apps und Actors nach rechts"}).click();
    await page.waitForFunction(previous=>document.querySelector<HTMLElement>('[aria-label="Apps und Actors durchblättern"]')!.scrollLeft>previous,afterWheel);
    const afterRight = await left();
    await page.getByRole("button",{name:"Apps und Actors nach links"}).click();
    await page.waitForFunction(previous=>document.querySelector<HTMLElement>('[aria-label="Apps und Actors durchblättern"]')!.scrollLeft<previous,afterRight);
    context.diagnostic(`Offline fixture: ${directory}`);
  } finally {await browser.close();}
});
