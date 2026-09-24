import assert from "node:assert/strict";
import test from "node:test";
import {mkdir,mkdtemp,writeFile} from "node:fs/promises";
import {tailwindPlugin} from "./tailwind-plugin";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright-core";

test("run overview reacts to per-user persistent read revisions while preserving run actions",{skip:process.env.RAGENTS_BROWSER_TESTS!=="1",timeout:60_000},async(context)=>{
  const scratch="/private/tmp/ragents-run-overview";await mkdir(scratch,{recursive:true});const directory=await mkdtemp(`${scratch}/run-`);const root=fileURLToPath(new URL("../../../",import.meta.url));
  await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{SessionList}from'${root}apps/web/src/SessionList.tsx';import{useRunReadState}from'${root}apps/web/src/run-read-state.ts';import'${root}apps/web/src/ui/tailwind.css';
function App(){const[user,setUser]=useState('alice');const[selectMode,setSelectMode]=useState(false);const[selected,setSelected]=useState(new Set());const now=new Date();const[sessions,setSessions]=useState([{id:'running',title:'Laufende Recherche',updatedAt:now.getTime(),createdAt:now.getTime()-3600000,revision:8,running:true},{id:'new',title:'Neuer Entwurf',updatedAt:now.getTime()-1000,revision:3},{id:'yesterday',title:'Gestrige Planung',updatedAt:new Date(now.getFullYear(),now.getMonth(),now.getDate()-1,12).getTime(),revision:4},{id:'old',title:'Archivierter Run',updatedAt:new Date(now.getFullYear()-1,0,15).getTime(),revision:2}]);const read=useRunReadState(user);window.fixture={...window.fixture,setUser,setSessions,setSelectMode,markViewed:read.markViewed,revisions:read.revisions};window.fixture.calls??=[];return <main style={{padding:20}}><h1>Runs</h1><SessionList sessions={sessions} activeId="running" seenRevisions={read.revisions} registry={{sessionMetadata:[]}} selectMode={selectMode} selectedIds={selected} onSelect={id=>window.fixture.calls.push(['select',id])} onDelete={id=>window.fixture.calls.push(['delete',id])} onToggleSelected={id=>{window.fixture.calls.push(['toggle',id]);setSelected(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next})}}/></main>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:`${root}apps/web`,loader:"tsx"},jsx:"automatic",bundle:true,platform:"browser",format:"iife",outfile:`${directory}/app.js`,plugins:[tailwindPlugin([])],logLevel:"silent"});
  await writeFile(`${directory}/index.html`,'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH??"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
  try{
    const browserContext=await browser.newContext({viewport:{width:1200,height:900}});const page=await browserContext.newPage();const url=`file://${directory}/index.html`;const unread=()=>page.getByText(/^(Neue Aktivität|Nicht angesehen)$/);await page.goto(url);
    await page.getByRole('heading',{name:'Heute',exact:false}).waitFor();assert.equal(await unread().count(),4);
    await page.getByRole('button',{name:'Neuer Entwurf'}).first().click();assert.deepEqual(await page.evaluate(()=>(window as any).fixture.calls),[['select','new']]);assert.equal(await unread().count(),4,'Selecting a list row alone is not proof of viewing loaded content.');
    await page.evaluate(()=>{const f=(window as any).fixture;f.markViewed('running',8);f.markViewed('new',3);f.markViewed('new',1)});
    await page.waitForFunction(()=>(window as any).fixture.revisions.new===3);assert.equal(await unread().count(),2);
    await page.evaluate(()=>(window as any).fixture.setSessions((runs:any[])=>runs.map(run=>run.id==='new'?{...run,revision:4}:run)));
    await page.getByText('Neue Aktivität',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>(window as any).fixture.revisions.new),3,'List polling does not mark new revisions as read.');
    await page.screenshot({path:`${directory}/desktop.png`,fullPage:true});
    await page.evaluate(()=>(window as any).fixture.setUser('bob'));await page.waitForFunction(()=>Object.keys((window as any).fixture.revisions).length===0);assert.equal(await unread().count(),4);
    await page.evaluate(()=>(window as any).fixture.markViewed('old',2));await page.evaluate(()=>(window as any).fixture.setUser('alice'));await page.waitForFunction(()=>(window as any).fixture.revisions.new===3);assert.equal(await page.evaluate(()=>(window as any).fixture.revisions.old),undefined);
    const second=await browserContext.newPage();await second.goto(url);await second.waitForFunction(()=>(window as any).fixture?.revisions.new===3);
    await second.evaluate(()=>(window as any).fixture.markViewed('new',9));await page.waitForFunction(()=>(window as any).fixture.revisions.new===9);
    await page.evaluate(()=>(window as any).fixture.markViewed('new',4));assert.equal(await page.evaluate(()=>(window as any).fixture.revisions.new),9);
    await page.reload();await page.waitForFunction(()=>(window as any).fixture?.revisions.new===9);
    await page.getByRole('button',{name:'Archivierter Run löschen',exact:true}).click();assert.deepEqual(await page.evaluate(()=>(window as any).fixture.calls),[['delete','old']]);
    await page.evaluate(()=>(window as any).fixture.setSelectMode(true));const check=page.getByRole('checkbox',{name:'Neuer Entwurf zum Löschen auswählen'});await check.check();assert.equal(await check.isChecked(),true);assert.equal(await page.getByRole('button',{name:'löschen'}).count(),0);assert.deepEqual(await page.evaluate(()=>(window as any).fixture.calls),[['delete','old'],['toggle','new']]);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${directory}/mobile.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);context.diagnostic(`Screenshots: ${directory}`);
  }finally{await browser.close()}
});
