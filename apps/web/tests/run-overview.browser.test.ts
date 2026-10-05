import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {tailwindPlugin} from "./tailwind-plugin";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright-core";

test("run rows show the server's read markers, open and highlight as a whole item, and keep their run actions",{skip:process.env.RAGENTS_BROWSER_TESTS!=="1",timeout:60_000},async(context)=>{
  const directory=await mkdtemp(path.join(tmpdir(),"ragents-run-overview-"));const root=fileURLToPath(new URL("../../../",import.meta.url));
  await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{PanelPage}from'${root}apps/web/src/panel/PanelPage.tsx';import{connectionRunOf}from'${root}apps/web/src/run-overview.ts';import'${root}apps/web/src/ui/tailwind.css';
const listed=(run)=>({running:false,state:'idle',pendingActions:0,workspaceAccessible:true,...run});
function App(){const[view,setView]=useState('runs');const now=new Date();const[sessions,setSessions]=useState([listed({id:'running',title:'Ongoing research',updatedAt:now.getTime(),revision:8,running:true,state:'running',ownerLabel:'Alice',listDetails:[{label:'Workspace',text:'/home/user/project',icon:'folder'},{label:'Branch',text:'main',icon:'branch'}]}),listed({id:'new',title:'New draft',updatedAt:now.getTime()-1000,revision:3}),listed({id:'yesterday',title:'Planning from yesterday',updatedAt:new Date(now.getFullYear(),now.getMonth(),now.getDate()-1,12).getTime(),revision:4,state:'waiting',pendingActions:2}),listed({id:'old',title:'Archived run',updatedAt:new Date(now.getFullYear()-1,0,15).getTime(),revision:2,state:'ended'}),listed({id:'locked',title:'locked',updatedAt:now.getTime()-2000,locked:'Journal format 3 is no longer supported.'})]);window.fixture={...window.fixture,setSessions,setView};window.fixture.calls??=[];return <PanelPage state={{page:view,theme:'light',profileSuggestions:[],connections:[{name:'demo',kind:'server',address:'http://localhost',route:{kind:'server',host:'localhost',localHost:false},state:{kind:'connected'},canCreate:true,canDelete:true,entries:[],runs:sessions.map(connectionRunOf)}]}} send={action=>window.fixture.calls.push(action)}/>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:`${root}apps/web`,loader:"tsx"},jsx:"automatic",bundle:true,platform:"browser",format:"iife",outfile:`${directory}/app.js`,plugins:[tailwindPlugin([`${root}apps/web/src`])],logLevel:"silent"});
  await writeFile(`${directory}/index.html`,'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH??"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
  try{
    const page=await browser.newPage({viewport:{width:1200,height:900}});const unread=()=>page.getByTitle(/, (new activity|not viewed yet)$/);await page.goto(`file://${directory}/index.html`);
    await page.getByRole('heading',{name:'Runs',exact:true}).waitFor();assert.equal(await unread().count(),4,'every run without a read marker of this user counts as not viewed');
    await page.evaluate(()=>(window as any).fixture.setSessions((runs:any[])=>runs.map(run=>run.id==='running'?{...run,seenRevision:8}:run.id==='new'?{...run,seenRevision:2}:run)));
    await page.getByTitle(/new activity/i).waitFor();assert.equal(await unread().count(),3,'the server read marker of this user decides');
    const item=page.getByTitle('Ongoing research',{exact:true});const workspace=item.getByTitle('Workspace: /home/user/project');
    assert.equal(await item.getByTitle('Owner: Alice').count(),1,'the owner stands inside the item');assert.equal(await workspace.count(),1,'the lines stand inside the item');assert.equal(await item.getByTitle('Branch: main').count(),1);
    const background=()=>item.evaluate((element)=>getComputedStyle(element).backgroundColor);const resting=await background();
    await workspace.hover();await page.waitForFunction(({row,resting})=>row!==null&&getComputedStyle(row).backgroundColor!==resting,{row:await item.elementHandle(),resting});assert.notEqual(await background(),resting,'hovering the second line highlights the whole item');
    const [titleBox,detailBox]=[await item.getByText('Ongoing research').boundingBox(),await workspace.boundingBox()];assert.ok(titleBox&&detailBox&&detailBox.y-(titleBox.y+titleBox.height)<6,'the second line stays close to the title');
    await workspace.click();assert.deepEqual(await page.evaluate(()=>(window as any).fixture.calls),[{action:'openRun',name:'demo',runId:'running'}],'a click on the second line opens the run');
    const lockedRow=page.getByRole('listitem').filter({hasText:'Journal format 3 is no longer supported.'});
    assert.equal(await lockedRow.getByTitle('locked',{exact:true}).getAttribute('aria-disabled'),'true');
    await lockedRow.getByTitle('locked',{exact:true}).click({force:true});assert.equal((await page.evaluate(()=>(window as any).fixture.calls)).length,1);
    await lockedRow.getByRole('button',{name:'Delete locked',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal((await page.evaluate(()=>(window as any).fixture.calls)).length,1,'locked runs offer deletion without opening the run');
    await page.getByRole('button',{name:'Select',exact:true}).click();
    await item.getByTitle('Owner: Alice').click();assert.equal(await page.getByRole('checkbox',{name:'Select Ongoing research',exact:true}).isChecked(),true,'in selection mode the second line toggles too');
    await page.getByRole('checkbox',{name:'Select Archived run',exact:true}).check();
    await page.getByRole('checkbox',{name:'Select locked',exact:true}).check();
    await page.getByRole('button',{name:'Delete',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();
    assert.deepEqual((await page.evaluate(()=>(window as any).fixture.calls)).at(-1),{action:'deleteRuns',name:'demo',runIds:['running','old','locked']});
    await page.screenshot({path:`${directory}/desktop.png`,fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${directory}/mobile.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);context.diagnostic(`Screenshots: ${directory}`);
    await page.evaluate(()=>(window as any).fixture.setView('start'));
    await page.getByRole('heading',{name:'Continue',exact:true}).waitFor();
    assert.deepEqual(await page.getByRole('heading',{level:2}).allTextContents(),['New1','Continue'],'Start puts templates before the same run rows');
    assert.equal(await page.getByRole('list',{name:'Recent',exact:true}).getByTitle('Workspace: /home/user/project').count(),1,'Start retains the row details');
  }finally{await browser.close()}
});
