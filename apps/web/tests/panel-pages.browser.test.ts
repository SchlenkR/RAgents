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
const developer={name:"developer",kind:"profile",address:"/Users/example/repos/RAgents/ragents.config.developer.ts",route:{kind:"profile",profile:"developer"},state:{kind:"starting"},runs:[],entries:[],canCreate:false};
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

test("Start shows the servers as split chips with a route line, the recent runs in a grid and the templates, and starts with one click",{skip,timeout:120_000},async(context)=>{
  const url=await preparePage({theme:"dark",page:"start",profileSuggestions:[],connections:all});
  const browser=await launch();
  try{
    const browserContext=await browser.newContext({viewport:{width:420,height:1100}});const page=await browserContext.newPage();await page.goto(url);
    await page.getByRole('heading',{name:'Server'}).waitFor();
    assert.equal(await page.getByRole('heading',{level:1}).count(),0,'Start has no header of its own');
    assert.equal(await page.getByRole('button',{name:'Runs',exact:true}).count(),0,'the actions are only in the VS Code title bar');
    assert.equal(await page.getByRole('button',{name:'Set up server'}).count(),0);

    // One server per row in a narrow panel, two in a wide panel.
    const connectionRows=()=>page.evaluate(()=>
      new Set([...document.querySelectorAll('ul[aria-label="Server"] > li')].map((item)=>Math.round(item.getBoundingClientRect().top))).size);
    assert.equal(await connectionRows(),5,'five servers take five rows at 420 pixels');
    assert.equal(await page.getByRole('button',{name:'New chat on workshop'}).count(),1);
    assert.equal(await page.getByRole('button',{name:'New chat on review'}).count(),0,'no plus without the start right');
    const chip=(name:string)=>page.locator('ul[aria-label="Server"] > li').filter({hasText:name}).first();
    assert.equal(await chip('workshop').locator('[data-cell="route"]').innerText(),'localhost:4715');
    assert.equal(await chip('core').locator('[data-cell="route"]').innerText(),'workshop.example.com \u00b7 local','a distributed profile runs locally');
    assert.equal(await chip('developer').locator('[data-cell="route"]').innerText(),'local \u00b7 developer');
    assert.equal(await chip('nightrun').locator('[data-cell="route"]').innerText(),'nightrun.example.com:8443','a non-default port stays');
    const widths=await page.evaluate(()=>[...document.querySelectorAll('ul[aria-label="Server"] > li')].map((item)=>Math.round(item.getBoundingClientRect().width)));
    assert.equal(new Set(widths).size,1,`all chips are the same width, with and without plus: ${widths.join(', ')}`);
    assert.equal(await page.getByRole('button',{name:'developer is starting'}).isDisabled(),true,'a starting server is not clickable');

    // The left part is a button with an action word: Sign in, Retry, Runs.
    const signIn=page.getByRole('button',{name:'Sign in to review'});
    assert.equal(await signIn.count(),1);
    assert.match(await signIn.innerText(),/Sign in\s+review\.example\.com$/,'the action word is next to the name, the route line below');
    const placement=await chip('review').evaluate((item)=>{
      const state=item.querySelector<HTMLElement>('button[aria-label="Sign-in for review"]')!;
      const icon=state.querySelector<HTMLElement>('svg')!;
      const action=item.querySelector<HTMLElement>('button[aria-label="Sign in to review"]')!;
      const text=action.querySelector<HTMLElement>(':scope > span')!;
      const stateBox=state.getBoundingClientRect();
      const iconBox=icon.getBoundingClientRect();
      return {
        iconOffset:Math.abs(iconBox.left+iconBox.width/2-(stateBox.left+stateBox.width/2)),
        textInset:text.getBoundingClientRect().left-action.getBoundingClientRect().left,
      };
    });
    assert.ok(placement.iconOffset<0.5,`the state icon is centered: ${placement.iconOffset}`);
    assert.ok(placement.textInset>=7.5,`the text has a nominal 8 pixel inset: ${placement.textInset}`);
    await signIn.click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role=dialog]',{state:'detached'});
    await page.getByRole('button',{name:'Retry nightrun'}).click();
    assert.deepEqual(await sent(page),{action:'retry',name:'nightrun'});
    await page.getByRole('button',{name:'Runs on workshop'}).click();
    assert.deepEqual(await sent(page),{action:'page',page:'runs',connection:'workshop'});

    // Continue shows five lines of all servers in the grid, New all templates flat.
    assert.equal(await page.getByRole('button',{name:/^All 5 runs/}).count(),1);
    assert.equal(await page.locator('button[title="Editorial workshop: landing page (workshop)"]').count(),1);
    assert.equal(await columnEdges(page,'Recent','time'),1,'the time column is at the same edge in all lines');
    assert.equal(await columnEdges(page,'Recent','connection'),1,'the server column is at the same edge in all lines');
    assert.equal(await page.locator('ul[aria-label="Templates on core"] button[data-tile="Word game"]').count(),1,'every template of every server is in its server group');
    assert.equal(await page.getByLabel('Search templates').count(),0,'Start has no search');
    await shoot(page,`${shots}start-420.png`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);

    // One click is one click: the template creates the run, the plus the empty chat, the line opens the run.
    await page.locator('ul[aria-label="Templates on core"] button[data-tile="Discussion circle"]').click();
    assert.deepEqual(await sent(page),{action:'newRun',name:'core',entryId:'ragents.reference.circle'});
    await page.getByRole('button',{name:'New chat on workshop'}).click();
    assert.deepEqual(await sent(page),{action:'newRun',name:'workshop'});
    await page.locator('button[title="Balcony plan south side (workshop)"]').click();
    assert.deepEqual(await sent(page),{action:'openRun',name:'workshop',runId:'run-b'});

    // New groups per reachable server and starts each group with New chat; with a default, its template comes first and marked, and the plus takes it.
    const groups=()=>page.evaluate(()=>[...document.querySelectorAll('ul[aria-label^="Templates on "]')].map((list)=>({
      connection:list.getAttribute('aria-label')!.replace('Templates on ',''),
      heading:list.parentElement?.previousElementSibling?.textContent?.trim(),
      titles:[...list.querySelectorAll(':scope > li > button')].map((item)=>item.getAttribute('data-tile')),
    })));
    const tilesOf=async(connection:string)=>(await groups()).find((group)=>group.connection===connection)!;
    assert.deepEqual((await groups()).map((group)=>group.connection),['workshop','core'],'one group per reachable server, in the order of the chips');
    assert.match((await tilesOf('workshop')).heading??'',/workshop$/,'the group carries the server name as its heading');
    assert.equal((await tilesOf('workshop')).titles[0],'New chat');
    assert.equal((await tilesOf('core')).titles[0],'New chat');
    assert.equal((await groups()).flatMap((group)=>group.titles).length,10,'New chat twice before the eight templates');
    await page.locator('ul[aria-label="Templates on core"] button[data-tile="New chat"]').click();
    assert.deepEqual(await sent(page),{action:'newRun',name:'core'});
    const firstTile=(connection:string,title:string)=>page.waitForFunction(([list,expected])=>document.querySelector(`ul[aria-label="Templates on ${list}"] > li > button`)?.getAttribute('data-tile')===expected,[connection,title]);
    await setConnections(page,[{...workshop,defaultEntry:'ragents.reference.circle'},core,developer,review,nightrun]);
    await firstTile('workshop','Discussion circle');
    assert.deepEqual((await tilesOf('workshop')).titles.slice(0,1),['Discussion circle']);
    assert.equal((await groups()).flatMap((group)=>group.titles).length,9,'the default does not appear a second time');
    const standardTile=page.locator('ul[aria-label="Templates on workshop"] button[data-tile="Discussion circle"]');
    assert.equal(await standardTile.getByText('Default').count(),1);
    await standardTile.click();
    assert.deepEqual(await sent(page),{action:'newRun',name:'workshop',entryId:'ragents.reference.circle'});
    await page.getByRole('button',{name:'New run from Discussion circle on workshop'}).click();
    assert.deepEqual(await sent(page),{action:'newRun',name:'workshop',entryId:'ragents.reference.circle'});
    await shoot(page,`${shots}start-default-420.png`);
    await setConnections(page,all);
    await firstTile('workshop','New chat');

    // The state icon of a failed server opens the message with Open output and Retry; the lock opens the sign-in.
    await page.getByRole('button',{name:'Show error of nightrun'}).click();
    const failure=page.getByRole('dialog',{name:'unreachable'});
    await failure.waitFor();
    await failure.getByText('fetch failed').waitFor();
    await page.evaluate(()=>Promise.all(document.getAnimations().map((animation)=>animation.finished)));
    await page.screenshot({path:`${shots}start-error-420.png`});
    await failure.getByRole('button',{name:'Open output'}).click();
    assert.deepEqual(await sent(page),{action:'showOutput'});
    await failure.getByRole('button',{name:'Retry'}).click();
    assert.deepEqual(await sent(page),{action:'retry',name:'nightrun'});
    await page.waitForSelector('[role=dialog]',{state:'detached'});
    await page.getByRole('button',{name:'Sign-in for review'}).click();
    await page.getByRole('dialog',{name:'Sign in to review'}).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role=dialog]',{state:'detached'});

    await page.setViewportSize({width:900,height:1100});
    await page.waitForFunction(()=>innerWidth===900);
    assert.equal(await connectionRows(),3,'wide panels use two server columns');
    await shoot(page,`${shots}start-900.png`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    context.diagnostic(`Screenshots: ${shots}`);
  }finally{await browser.close()}
});

test("Runs brings all runs together, searches, hides ended ones and deletes after a confirmation",{skip,timeout:120_000},async(context)=>{
  const url=await preparePage({theme:"dark",page:"runs",profileSuggestions:[],connections:all});
  const browser=await launch();
  try{
    const browserContext=await browser.newContext({viewport:{width:420,height:1100}});const page=await browserContext.newPage();await page.goto(url);
    await page.getByRole('heading',{name:'Runs'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Server',exact:true}).count(),0,'the header carries only back and the title');
    const lines=()=>page.locator('ul[aria-label="Runs"] > li').count();
    assert.equal(await lines(),5,'all runs of all servers are here');
    assert.equal(await columnEdges(page,'Runs','time'),1,'the time column is at the same edge in all lines');
    assert.equal(await columnEdges(page,'Runs','connection'),1,'the server column is at the same edge in all lines');
    const edgesBefore=await page.evaluate(()=>['time','connection'].map((name)=>Math.round(document.querySelector(`ul[aria-label="Runs"] [data-cell="${name}"]`)!.getBoundingClientRect().left)));
    await shoot(page,`${shots}runs-420.png`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);

    await page.getByRole('button',{name:'Hide ended'}).click();
    await page.waitForFunction(()=>document.querySelectorAll('button[title*="Word game: sun"]').length===0);
    assert.equal(await lines(),3);
    await page.getByRole('button',{name:'Hide ended'}).click();

    await page.getByLabel('Search runs').fill('balcony');
    await page.waitForFunction(()=>document.querySelectorAll('button[title*="Editorial workshop"]').length===0);
    assert.equal(await lines(),1);
    await page.getByLabel('Search runs').fill('core');
    await page.waitForFunction(()=>document.querySelectorAll('button[title*="Balcony"]').length===0);
    assert.equal(await lines(),2,'the search also knows the server name');
    await page.getByLabel('Search runs').fill('doesnotexist');
    await page.getByRole('status').filter({hasText:'No matching run.'}).waitFor();
    await page.getByLabel('Search runs').fill('');

    // Select, mark two runs, confirm in the dialog.
    await page.getByRole('button',{name:'Select'}).click();
    await page.getByRole('checkbox',{name:'Select Balcony plan south side'}).click();
    await page.getByRole('checkbox',{name:'Select Word game: sun'}).click();
    await page.getByText('2 selected').waitFor();
    assert.equal(await columnEdges(page,'Runs','time'),1,'the time stays at one edge with checkboxes too');
    assert.equal(await columnEdges(page,'Runs','connection'),1);
    const edgesSelecting=await page.evaluate(()=>['time','connection'].map((name)=>Math.round(document.querySelector(`ul[aria-label="Runs"] [data-cell="${name}"]`)!.getBoundingClientRect().left)));
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
    await page.getByRole('heading',{name:'Server'}).waitFor();
    await page.setViewportSize({width:420,height:1100});
    assert.equal(await page.getByRole('button',{name:'Back to Start'}).count(),0);
    context.diagnostic(`Screenshots: ${shots}`);
  }finally{await browser.close()}
});

test("the chip on Start filters the Runs page to its server; the toggle removes the filter",{skip,timeout:120_000},async()=>{
  const url=await preparePage({theme:"dark",page:"runs",runsConnection:"core",profileSuggestions:[],connections:all});
  const browser=await launch();
  try{
    const browserContext=await browser.newContext({viewport:{width:420,height:1100}});const page=await browserContext.newPage();await page.goto(url);
    await page.getByRole('heading',{name:'Runs'}).waitFor();
    const lines=()=>page.locator('ul[aria-label="Runs"] > li').count();
    assert.equal(await lines(),2,'only the runs of core');
    const filter=page.getByRole('button',{name:'Only core'});
    assert.equal(await filter.getAttribute('aria-pressed'),'true');
    await filter.click();
    await page.waitForFunction(()=>document.querySelectorAll('ul[aria-label="Runs"] > li').length===5);
    assert.equal(await filter.count(),0,'without a filter the toggle disappears');
  }finally{await browser.close()}
});

test("a long run title stays within the panel width and the page scrolls vertically",{skip,timeout:120_000},async()=>{
  const longTitle="ReadTASKmdAndCarryOutExactlyThisTask".repeat(5);
  const connection={...workshop,runs:[run("run-long",longTitle,"running",1),...workshop.runs]};
  const url=await preparePage({theme:"dark",page:"start",profileSuggestions:[],connections:[connection]});
  const browser=await launch();
  try{
    const browserContext=await browser.newContext({viewport:{width:420,height:380}});const page=await browserContext.newPage();await page.goto(url);
    await page.getByRole('heading',{name:'Server'}).waitFor();
    await page.locator('button[data-tile="Word game"]').waitFor();

    const metrics=await page.evaluate((title)=>{
      const main=document.querySelector('main')!;
      const tiles=document.querySelector('ul[aria-label="Templates"]')!;
      const span=document.querySelector(`button[title="${title}"] span.truncate`)!;
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
