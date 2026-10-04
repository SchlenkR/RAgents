import assert from "node:assert/strict";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {mkdir,mkdtemp,writeFile} from "node:fs/promises";
import {tailwindPlugin} from "./tailwind-plugin";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright-core";
import type {Page} from "playwright-core";

const shots=`${join(tmpdir(),"ragents-browser-shots")}/`;

const entry=(id:string,title:string,description:string,kind:string,category:string)=>({id,title,description,kind,category});
const entries=[
  entry("ragents.reference.board","Collection board","A list helper with its own function, mini-app and shared state.","skill","Mini-apps"),
  entry("ragents.reference.notes","Notes board","Hide notes and find them again without losing the actor.","skill","Mini-apps"),
  entry("ragents.reference.circle","Discussion circle","Four helpers speak in turn, the coordinator leads the rounds.","script","Moderation"),
  entry("ragents.reference.word","Word game","Four models pass words along, an actor ends after twelve.","script","Games"),
];
const MINUTE=60_000;
const run=(id:string,title:string,state:string,minutes:number)=>({id,title,state,pendingActions:state==="waiting"?2:0,updatedAt:Date.now()-minutes*MINUTE});
const workshop={name:"workshop",kind:"server",address:"http://localhost:4715",route:{kind:"server",host:"localhost:4715",localHost:false},state:{kind:"connected"},user:"alex",
  runs:[run("run-a","Editorial workshop: landing page","running",0),run("run-b","Balcony plan south side","waiting",5),run("run-c","Word game: sun","ended",1440*3)],entries,canCreate:true};
const core={name:"core",kind:"server",address:"https://workshop.example.com",route:{kind:"server",host:"workshop.example.com",localHost:true},state:{kind:"connected"},
  runs:[run("run-d","Moderated round: good collaboration","idle",180),run("run-e","Clarify decision: hosting","ended",1440*5)],entries,canCreate:true};
const developer={name:"developer",kind:"profile",address:"/home/user/project/ragents.config.developer.ts",route:{kind:"profile",profile:"developer"},state:{kind:"starting"},runs:[],entries:[],canCreate:false};
const review={name:"review",kind:"server",address:"https://review.example.com",route:{kind:"server",host:"review.example.com",localHost:false},state:{kind:"login-required",mode:"password"},runs:[],entries:[],canCreate:false};
const nightrun={name:"nightrun",kind:"server",address:"https://nightrun.example.com:8443",route:{kind:"server",host:"nightrun.example.com:8443",localHost:false},state:{kind:"unreachable",message:"fetch failed"},runs:[],entries:[],canCreate:false};
const all=[workshop,core,developer,review,nightrun];

const skip=process.env.RAGENTS_BROWSER_TESTS!=="1";
const launch=()=>chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH??"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});

/** The panel scrolls in main instead of the document; for a full-page image the viewport briefly grows to the content height. */
const shoot=async(page:Page,path:string)=>{
  const {width,height}=page.viewportSize()!;
  const content=await page.evaluate(()=>document.querySelector('main')!.scrollHeight);
  await page.setViewportSize({width,height:Math.max(height,content)});
  await page.screenshot({path});
  await page.setViewportSize({width,height});
};

/** Bundles the panel with Tailwind into a fresh folder and puts the page with the initial state next to it. */
const preparePage=async(initial:unknown):Promise<string>=>{
  const scratch="/private/tmp/ragents-panel-pages";await mkdir(scratch,{recursive:true});const directory=await mkdtemp(`${scratch}/page-`);const root=fileURLToPath(new URL("../../../",import.meta.url));
  await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{PanelPage}from'${root}apps/web/src/panel/PanelPage.tsx';import'${root}apps/web/src/ui/tailwind.css';
function App(){const[state,setState]=useState(window.fixture.initial);window.fixture={...window.fixture,setState};window.fixture.sent??=[];return <PanelPage state={state} send={action=>window.fixture.sent.push(action)}/>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:`${root}apps/web`,loader:"tsx"},jsx:"automatic",bundle:true,platform:"browser",format:"iife",outfile:`${directory}/app.js`,plugins:[tailwindPlugin([])],logLevel:"silent"});
  await writeFile(`${directory}/index.html`,`<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"><script>window.fixture={initial:${JSON.stringify(initial)}}</script></head><body><div id="root"></div><script src="app.js"></script></body></html>`);
  return `file://${directory}/index.html`;
};

const setPage=(page:Page,next:string)=>page.evaluate((value)=>(window as any).fixture.setState((current:any)=>({...current,page:value})),next);
const setConnections=(page:Page,connections:unknown[])=>page.evaluate((value)=>(window as any).fixture.setState((current:any)=>({...current,connections:value})),connections);
const sent=(page:Page)=>page.evaluate(()=>(window as any).fixture.sent.at(-1));
/** The left edges of a run list column; a grid has exactly one per column. */
const columnEdges=(page:Page,list:string,cell:string)=>page.evaluate(([label,name])=>
  new Set([...document.querySelectorAll(`ul[aria-label="${label}"] [data-cell="${name}"]`)].map((item)=>Math.round(item.getBoundingClientRect().left))).size,[list,cell]);

test("Start shows only one server's recent runs and templates and sends each action to that server",{skip,timeout:120_000},async(context)=>{
  const url=await preparePage({theme:"dark",page:"start",profileSuggestions:[],connections:[workshop]});
  const browser=await launch();
  try{
    const page=await browser.newPage({viewport:{width:420,height:1100}});await page.goto(url);
    await page.getByRole('heading',{name:'Continue'}).waitFor();
    assert.equal(await page.getByRole('heading',{level:1}).count(),0,'Start has no header of its own');
    assert.equal(await page.getByRole('list',{name:'Server',exact:true}).count(),0);
    assert.equal(await page.getByRole('heading',{name:'Server',exact:true}).count(),0);
    assert.equal(await page.locator('[data-cell="route"], [data-cell="connection"]').count(),0);
    assert.equal(await page.getByRole('button',{name:/^All 3 runs/}).count(),1);
    assert.equal(await page.locator('button[title="Editorial workshop: landing page"]').count(),1);
    assert.equal(await columnEdges(page,'Recent','time'),1);
    assert.equal(await page.getByLabel('Search templates').count(),0);
    const templates=page.getByRole('list',{name:'Templates',exact:true});
    const tile=(title:string)=>templates.locator(`button[data-tile="${title}"]`);
    assert.deepEqual(await templates.getByRole('button').evaluateAll((items)=>items.map((item)=>item.getAttribute('data-tile'))),
      ['New chat','Collection board','Notes board','Discussion circle','Word game']);
    await mkdir(shots,{recursive:true});
    await shoot(page,`${shots}start-420.png`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);

    await tile('Discussion circle').click();
    assert.deepEqual(await sent(page),{action:'newRun',name:'workshop',entryId:'ragents.reference.circle'});
    assert.equal(await tile('Discussion circle').getAttribute('aria-busy'),'true');
    assert.equal(await templates.getByRole('button',{disabled:false}).count(),0,'every other start waits for the next state');
    await page.evaluate(()=>(window as any).fixture.setState((current:any)=>({...current})));
    await tile('New chat').click();
    assert.deepEqual(await sent(page),{action:'newRun',name:'workshop'});
    await page.evaluate(()=>(window as any).fixture.setState((current:any)=>({...current})));
    await page.locator('button[title="Balcony plan south side"]').click();
    assert.deepEqual(await sent(page),{action:'openRun',name:'workshop',runId:'run-b'});
    await page.getByRole('button',{name:/^All 3 runs/}).click();
    assert.deepEqual(await sent(page),{action:'page',page:'runs'});

    await setConnections(page,[{...core,defaultEntry:'ragents.reference.circle'}]);
    await page.locator('button[title="Moderated round: good collaboration"]').waitFor();
    assert.equal(await page.locator('button[title="Editorial workshop: landing page"]').count(),0,'replacing the server replaces its content');
    assert.equal(await page.getByRole('button',{name:/^All 2 runs/}).count(),1);
    assert.equal(await templates.locator(':scope > li > button').first().getAttribute('data-tile'),'Discussion circle');
    assert.equal(await tile('Discussion circle').getByText('Default').count(),1);
    assert.equal(await tile('Discussion circle').count(),1,'the default is shown once');
    assert.equal(await tile('New chat').count(),0);
    await tile('Discussion circle').click();
    assert.deepEqual(await sent(page),{action:'newRun',name:'core',entryId:'ragents.reference.circle'});
    await page.setViewportSize({width:900,height:1100});
    await shoot(page,`${shots}start-default-900.png`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    context.diagnostic(`Screenshots: ${shots}`);
  }finally{await browser.close()}
});

test("Runs searches, hides ended runs and deletes confirmed selections on the current server",{skip,timeout:120_000},async(context)=>{
  const url=await preparePage({theme:"dark",page:"runs",profileSuggestions:[],connections:[workshop]});
  const browser=await launch();
  try{
    const browserContext=await browser.newContext({viewport:{width:420,height:1100}});const page=await browserContext.newPage();await page.goto(url);
    await page.getByRole('heading',{name:'Runs'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Server',exact:true}).count(),0,'the header carries only back and the title');
    const lines=()=>page.locator('ul[aria-label="Runs"] > li').count();
    assert.equal(await lines(),3,"only the selected server's runs are here");
    assert.equal(await page.getByRole('button',{name:/^Only /}).count(),0,'there is no server filter');
    assert.equal(await columnEdges(page,'Runs','time'),1,'the time column is at the same edge in all lines');
    assert.equal(await columnEdges(page,'Runs','connection'),0,'rows need no server column');
    const edgesBefore=await page.evaluate(()=>['time'].map((name)=>Math.round(document.querySelector(`ul[aria-label="Runs"] [data-cell="${name}"]`)!.getBoundingClientRect().left)));
    await shoot(page,`${shots}runs-420.png`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);

    await page.getByRole('button',{name:'Hide ended'}).click();
    await page.waitForFunction(()=>document.querySelectorAll('button[title*="Word game: sun"]').length===0);
    assert.equal(await lines(),2);
    await page.getByRole('button',{name:'Hide ended'}).click();

    await page.getByLabel('Search runs').fill('balcony');
    await page.waitForFunction(()=>document.querySelectorAll('button[title*="Editorial workshop"]').length===0);
    assert.equal(await lines(),1);
    await page.getByLabel('Search runs').fill('doesnotexist');
    await page.getByRole('status').filter({hasText:'No matching run.'}).waitFor();
    await page.getByLabel('Search runs').fill('');

    // Select, mark two runs, confirm in the dialog.
    await page.getByRole('button',{name:'Select'}).click();
    await page.getByRole('checkbox',{name:'Select Balcony plan south side'}).click();
    await page.getByRole('checkbox',{name:'Select Word game: sun'}).click();
    await page.getByText('2 selected').waitFor();
    assert.equal(await columnEdges(page,'Runs','time'),1,'the time stays at one edge with checkboxes too');
    assert.equal(await columnEdges(page,'Runs','connection'),0);
    const edgesSelecting=await page.evaluate(()=>['time'].map((name)=>Math.round(document.querySelector(`ul[aria-label="Runs"] [data-cell="${name}"]`)!.getBoundingClientRect().left)));
    assert.deepEqual(edgesSelecting,edgesBefore,'the checkbox does not move the right columns');
    await shoot(page,`${shots}runs-selection-420.png`);
    await page.getByRole('button',{name:'Delete'}).click();
    const dialog=page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('heading',{name:'Delete 2 runs?'}).waitFor();
    await page.screenshot({path:`${shots}runs-delete-420.png`});
    await dialog.getByRole('button',{name:'Delete'}).click();
    assert.deepEqual(await sent(page),{action:'deleteRuns',name:'workshop',runIds:['run-b','run-c']});
    await page.waitForSelector('[role=dialog]',{state:'detached'});
    assert.equal(await page.getByText('selected').count(),0,'after deleting the selection mode ends');

    await page.setViewportSize({width:900,height:1100});
    await page.waitForFunction(()=>innerWidth===900);
    await shoot(page,`${shots}runs-900.png`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);

    await setPage(page,'start');
    await page.getByRole('heading',{name:'Continue'}).waitFor();
    await page.setViewportSize({width:420,height:1100});
    assert.equal(await page.getByRole('button',{name:'Back to Start'}).count(),0);
    context.diagnostic(`Screenshots: ${shots}`);
  }finally{await browser.close()}
});

test("a long run title stays within the panel width and the page scrolls vertically",{skip,timeout:120_000},async()=>{
  const longTitle="ReadTASKmdAndCarryOutExactlyThisTask".repeat(5);
  const connection={...workshop,runs:[run("run-long",longTitle,"running",1),...workshop.runs]};
  const url=await preparePage({theme:"dark",page:"start",profileSuggestions:[],connections:[connection]});
  const browser=await launch();
  try{
    const browserContext=await browser.newContext({viewport:{width:420,height:380}});const page=await browserContext.newPage();await page.goto(url);
    await page.getByRole('heading',{name:'Continue'}).waitFor();
    await page.locator('button[data-tile="Word game"]').waitFor();

    const metrics=await page.evaluate((title)=>{
      const main=document.querySelector('main')!;
      const tiles=document.querySelector('ul[aria-label="Templates"]')!;
      const span=[...document.querySelectorAll(`button[title="${title}"] span`)].find((item)=>item.childElementCount===0&&item.textContent===title)!;
      main.scrollTop=100;
      return {
        documentOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        tilesOverflow:tiles.getBoundingClientRect().width-main.getBoundingClientRect().width,
        titleClipped:span.scrollWidth-span.clientWidth,
        scrollRoom:main.scrollHeight-main.clientHeight,
        scrollTop:main.scrollTop,
      };
    },longTitle);
    assert.ok(metrics.documentOverflow<=0,`the page overflows ${metrics.documentOverflow}px to the right`);
    assert.ok(metrics.tilesOverflow<=0,`the template grid is ${metrics.tilesOverflow}px wider than the panel`);
    assert.ok(metrics.titleClipped>0,'the long run title is cut off with an ellipsis');
    assert.ok(metrics.scrollRoom>0,'the page has a vertical scroll area');
    assert.ok(metrics.scrollTop>0,'the page can be scrolled down');
  }finally{await browser.close()}
});

for (const width of [380, 900, 1600, 2600]) {
  test(`Server uses the shared centered panel column at ${width}px`, {skip, timeout:120_000}, async () => {
    const url = await preparePage({theme:"dark", page:"connections", profileSuggestions:[], connections:all});
    const browser = await launch();
    try {
      const page = await browser.newPage({viewport:{width, height:1100}});
      await page.goto(url);
      await page.getByRole("button", {name:"New server", exact:true}).waitFor();
      const metrics = await page.locator("main ul").first().evaluate((list) => {
        const rect = list.getBoundingClientRect();
        const main = document.querySelector("main")!;
        return {width:rect.width, left:rect.left, hostWidth:main.clientWidth,
          overflow:main.scrollWidth > main.clientWidth || document.documentElement.scrollWidth > innerWidth};
      });
      await mkdir(shots, {recursive:true});
      await page.screenshot({path:`${shots}panel-servers-${width}.png`});
      assert.ok(metrics.width > 0 && metrics.width <= 1280);
      assert.ok(Math.abs(metrics.left - (metrics.hostWidth - metrics.width) / 2) < 2);
      assert.equal(metrics.overflow, false);
    } finally { await browser.close(); }
  });
}

test("Runs offers Share ... per shareable row, the dialog edits and sends the sharing, and the host's refusal stays in it",{skip,timeout:120_000},async()=>{
  const sharedRuns=[
    {...run("own","Own review","idle",1),canShare:true,shared:true},
    {...run("plain","Plain run","idle",2),canShare:true},
    {...run("viewed","Viewed run","idle",3),owner:"Alice",sharedAccess:"read"},
    {...run("joined","Joined run","idle",4),owner:"Alice",sharedAccess:"write"},
  ];
  const url=await preparePage({theme:"dark",page:"runs",profileSuggestions:[],connections:[{...workshop,runs:sharedRuns,canDelete:true}]});
  const loaded={sharing:{everyone:null,users:[{userId:"bob",label:"Bob",access:"read"}]},users:[{id:"bob",label:"Bob"},{id:"carol",label:"Carol"}]};
  const setSharing=(page:Page,value:unknown)=>page.evaluate((next)=>(window as any).fixture.setState((current:any)=>({...current,sharing:next})),value);
  const browser=await launch();
  try{
    const page=await browser.newPage({viewport:{width:420,height:900}});await page.goto(url);
    await page.getByRole('heading',{name:'Runs'}).waitFor();
    assert.equal(await columnEdges(page,'Runs','time'),1,'the action column keeps the time column aligned');
    assert.equal(await columnEdges(page,'Runs','share'),1,'every row has its action cell at the same edge');
    assert.equal(await page.getByRole('button',{name:'Share Viewed run'}).count(),0,'a sharee never changes the sharing');
    assert.equal(await page.locator('button[title="Viewed run"] [title="Shared with you - view only"]').count(),1);
    assert.equal(await page.locator('button[title="Own review"] [title="Shared"]').count(),1);
    await mkdir(shots,{recursive:true});
    await shoot(page,`${shots}runs-shared-420.png`);
    await page.getByRole('button',{name:'Share Own review'}).focus();
    await page.keyboard.press('Enter');
    assert.deepEqual(await sent(page),{action:'openSharing',name:'workshop',runId:'own'});

    await setSharing(page,{connection:'workshop',runId:'own',pending:true});
    const dialog=page.getByRole('dialog',{name:'Share run'});
    await dialog.getByText('Loading ...').waitFor();
    await setSharing(page,{connection:'workshop',runId:'own',result:loaded});
    const save=dialog.getByRole('button',{name:'Save'});
    await save.waitFor();
    assert.equal(await save.isDisabled(),true,'nothing changed yet');
    assert.match(await dialog.innerText(),/Own review/,'the dialog names the run');
    assert.equal(await dialog.getByRole('combobox').count(),0,'the dialog is a list, without dropdowns');
    assert.deepEqual((await dialog.getByRole('list',{name:'Shared with'}).getByRole('listitem').allInnerTexts()).map((row)=>row.split('\n')[0]),['Everyone','Bob','Carol'],'every user is a row');
    const choose=(name:string,access:string)=>dialog.getByRole('group',{name:`Access for ${name}`}).getByRole('button',{name:access}).click();
    await choose('Everyone','Can view');
    await choose('Bob','Can operate');
    await choose('Carol','Can view');
    await page.screenshot({path:`${shots}share-dialog-420.png`});
    await save.click();
    assert.deepEqual(await sent(page),{action:'share',name:'workshop',runId:'own',sharing:{everyone:'read',users:[{userId:'bob',access:'write'},{userId:'carol',access:'read'}]}});

    await setSharing(page,{connection:'workshop',runId:'own',result:loaded,pending:true});
    await dialog.getByRole('button',{name:'Saving ...'}).waitFor();
    await setSharing(page,{connection:'workshop',runId:'own',result:loaded,error:'carol is not a user of this profile'});
    await dialog.getByRole('alert').filter({hasText:'carol is not a user of this profile'}).waitFor();
    const pressed=(name:string,access:string)=>dialog.getByRole('group',{name:`Access for ${name}`}).getByRole('button',{name:access}).getAttribute('aria-pressed');
    assert.equal(await pressed('Carol','Can view'),'true','the draft survives the refusal');
    await choose('Carol','Off');
    assert.equal(await pressed('Carol','Off'),'true');
    await page.keyboard.press('Escape');
    assert.deepEqual(await sent(page),{action:'closeSharing'});
    await setSharing(page,undefined);
    await page.waitForSelector('[role=dialog]',{state:'detached'});

    await page.getByRole('button',{name:'Select'}).click();
    assert.equal(await page.getByRole('checkbox',{name:'Select Own review'}).count(),1);
    assert.equal(await page.getByRole('checkbox',{name:'Select Viewed run'}).count(),0,'a run shared with the user is never deleted');
    assert.equal(await columnEdges(page,'Runs','time'),1,'rows without a checkbox stay in their columns');
  }finally{await browser.close()}
});
