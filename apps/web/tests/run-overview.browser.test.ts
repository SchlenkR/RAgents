import assert from "node:assert/strict";
import test from "node:test";
import {mkdir,mkdtemp,writeFile} from "node:fs/promises";
import {tailwindPlugin} from "./tailwind-plugin";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright-core";

test("run overview reacts to per-user persistent read revisions while preserving run actions",{skip:process.env.RAGENTS_BROWSER_TESTS!=="1",timeout:60_000},async(context)=>{
  const scratch="/private/tmp/ragents-run-overview";await mkdir(scratch,{recursive:true});const directory=await mkdtemp(`${scratch}/run-`);const root=fileURLToPath(new URL("../../../",import.meta.url));
  await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{PanelPage}from'${root}apps/web/src/panel/PanelPage.tsx';import{runActivityNotice}from'${root}apps/web/src/run-overview.ts';import{useRunReadState}from'${root}apps/web/src/run-read-state.ts';import'${root}apps/web/src/ui/tailwind.css';
function App(){const[user,setUser]=useState('alice');const[selectMode,setSelectMode]=useState(false);const[selected,setSelected]=useState(new Set());const now=new Date();const[sessions,setSessions]=useState([{id:'running',title:'Ongoing research',updatedAt:now.getTime(),createdAt:now.getTime()-3600000,revision:8,running:true},{id:'new',title:'New draft',updatedAt:now.getTime()-1000,revision:3},{id:'yesterday',title:'Planning from yesterday',updatedAt:new Date(now.getFullYear(),now.getMonth(),now.getDate()-1,12).getTime(),revision:4},{id:'old',title:'Archived run',updatedAt:new Date(now.getFullYear()-1,0,15).getTime(),revision:2},{id:'locked',title:'locked',updatedAt:now.getTime()-2000,running:false,locked:'Journal format 3 is no longer supported.'}]);const read=useRunReadState(user);window.fixture={...window.fixture,setUser,setSessions,setSelectMode,markViewed:read.markViewed,revisions:read.revisions};window.fixture.calls??=[];return <PanelPage state={{page:'runs',theme:'light',profileSuggestions:[],connections:[{name:'demo',kind:'server',address:'http://localhost',route:{kind:'server',host:'localhost',localHost:false},state:{kind:'connected'},canCreate:true,canDelete:true,entries:[],runs:sessions.map(run=>({...run,state:run.running?'running':'idle',pendingActions:0,notice:runActivityNotice(run,read.revisions[run.id])}))}]}} send={action=>window.fixture.calls.push(action)}/>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:`${root}apps/web`,loader:"tsx"},jsx:"automatic",bundle:true,platform:"browser",format:"iife",outfile:`${directory}/app.js`,plugins:[tailwindPlugin([])],logLevel:"silent"});
  await writeFile(`${directory}/index.html`,'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH??"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
  try{
    const browserContext=await browser.newContext({viewport:{width:1200,height:900}});const page=await browserContext.newPage();const url=`file://${directory}/index.html`;const unread=()=>page.getByLabel(/^(New activity|Not viewed yet)$/);await page.goto(url);
    await page.getByRole('heading',{name:'Runs',exact:true}).waitFor();assert.equal(await unread().count(),4);
    await page.getByRole('button',{name:'New draft'}).first().click();assert.deepEqual(await page.evaluate(()=>(window as any).fixture.calls),[{action:'openRun',name:'demo',runId:'new'}]);assert.equal(await unread().count(),4,'Selecting a list row alone is not proof of viewing loaded content.');
    await page.evaluate(()=>{const f=(window as any).fixture;f.markViewed('running',8);f.markViewed('new',3);f.markViewed('new',1)});
    await page.waitForFunction(()=>(window as any).fixture.revisions.new===3);assert.equal(await unread().count(),2);
    await page.evaluate(()=>(window as any).fixture.setSessions((runs:any[])=>runs.map(run=>run.id==='new'?{...run,revision:4}:run)));
    await page.getByLabel('New activity',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>(window as any).fixture.revisions.new),3,'List polling does not mark new revisions as read.');
    await page.screenshot({path:`${directory}/desktop.png`,fullPage:true});
    await page.evaluate(()=>(window as any).fixture.setUser('bob'));await page.waitForFunction(()=>Object.keys((window as any).fixture.revisions).length===0);assert.equal(await unread().count(),4);
    await page.evaluate(()=>(window as any).fixture.markViewed('old',2));await page.evaluate(()=>(window as any).fixture.setUser('alice'));await page.waitForFunction(()=>(window as any).fixture.revisions.new===3);assert.equal(await page.evaluate(()=>(window as any).fixture.revisions.old),undefined);
    const second=await browserContext.newPage();await second.goto(url);await second.waitForFunction(()=>(window as any).fixture?.revisions.new===3);
    await second.evaluate(()=>(window as any).fixture.markViewed('new',9));await page.waitForFunction(()=>(window as any).fixture.revisions.new===9);
    await page.evaluate(()=>(window as any).fixture.markViewed('new',4));assert.equal(await page.evaluate(()=>(window as any).fixture.revisions.new),9);
    await page.reload();await page.waitForFunction(()=>(window as any).fixture?.revisions.new===9);
    const lockedRow = page.getByRole('listitem').filter({hasText:'Journal format 3 is no longer supported.'});
    assert.equal(await lockedRow.getByRole('button').getAttribute('aria-disabled'),'true');
    await lockedRow.getByRole('button').click({force:true});
    assert.deepEqual(await page.evaluate(()=>(window as any).fixture.calls),[]);
    await page.getByRole('button',{name:'Select',exact:true}).click();
    await page.getByRole('checkbox',{name:'Select Archived run',exact:true}).check();
    await page.getByRole('checkbox',{name:'Select locked',exact:true}).check();
    await page.getByRole('button',{name:'Delete',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>(window as any).fixture.calls),[{action:'deleteRuns',name:'demo',runIds:['old','locked']}]);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${directory}/mobile.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);context.diagnostic(`Screenshots: ${directory}`);
  }finally{await browser.close()}
});
