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
  await writeFile(`${directory}/index.html`,`<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"><script>window.fixture={initial:${JSON.stringify(initial)}};document.documentElement.dataset.theme=window.fixture.initial.theme</script></head><body><div id="root"></div><script src="app.js"></script></body></html>`);
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
    assert.deepEqual(await page.getByRole('heading',{level:2}).allTextContents(),['New5','Continue'],'templates appear before recent runs');
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

    await page.getByRole('button',{name:'Delete Balcony plan south side',exact:true}).click();
    const deletion=page.getByRole('dialog',{name:'Delete one run?'});
    await deletion.getByText('The run "Balcony plan south side"',{exact:false}).waitFor();
    await deletion.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.deepEqual(await sent(page),{action:'page',page:'runs'},'cancel keeps the run');
    await page.getByRole('button',{name:'Delete Balcony plan south side',exact:true}).click();
    await deletion.getByRole('button',{name:'Delete',exact:true}).click();
    assert.deepEqual(await sent(page),{action:'deleteRuns',name:'workshop',runIds:['run-b']});
    await setConnections(page,[{...workshop,canDelete:false}]);
    await page.getByRole('button',{name:'Delete Balcony plan south side',exact:true}).waitFor({state:'detached'});
    assert.equal(await page.getByRole('button',{name:/^Delete /}).count(),0,'the server permission controls deletion');

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

    await page.getByRole('button',{name:'Delete Word game: sun',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();
    assert.deepEqual(await sent(page),{action:'deleteRuns',name:'workshop',runIds:['run-c']});
    await page.evaluate(()=>(window as any).fixture.setState((current:any)=>({...current,problem:'The run could not be deleted.'})));
    await page.getByRole('alert').getByText('The run could not be deleted.',{exact:true}).waitFor();

    await page.getByRole('button',{name:'Select'}).click();
    const toolbar=page.getByRole('group',{name:'Run actions',exact:true});
    assert.deepEqual(await toolbar.getByRole('button').allTextContents(),['Select all','Delete','Cancel']);
    assert.equal(await toolbar.getByRole('button',{name:'Delete',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:/^Delete /}).count(),0,'selection mode keeps only the bulk action');
    await page.getByRole('checkbox',{name:'Select Balcony plan south side'}).click();
    await page.getByRole('checkbox',{name:'Select Word game: sun'}).click();
    await page.getByText('2 selected').waitFor();
    assert.equal(await columnEdges(page,'Runs','time'),1,'the time stays at one edge with checkboxes too');
    assert.equal(await columnEdges(page,'Runs','connection'),0);
    await shoot(page,`${shots}runs-selection-420.png`);
    await toolbar.getByRole('button',{name:'Delete',exact:true}).click();
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

for (const theme of ["light", "dark"]) {
  test(`Runs selection toolbar stays reachable and toggles only visible deletable runs in ${theme}`, {skip, timeout:120_000}, async () => {
    const runs = [
      {...run("own", "Review plan", "running", 0), shared:true},
      {...run("locked", "Review locked", "idle", 1), locked:"Unsupported journal format"},
      run("ended", "Archive review", "ended", 2),
      {...run("viewed", "Shared notes", "idle", 3), sharedAccess:"read"},
      {...run("joined", "Shared edits", "idle", 4), sharedAccess:"write"},
    ];
    const connection = {...workshop, runs};
    const url = await preparePage({theme, page:"runs", profileSuggestions:[], connections:[connection]});
    const browser = await launch();
    try {
      for (const width of [380, 900]) {
        const page = await browser.newPage({viewport:{width, height:620}});
        await page.goto(url);
        const search = page.getByRole("searchbox", {name:"Search runs"});
        const toolbar = page.getByRole("group", {name:"Run actions", exact:true});
        const button = (name:string) => toolbar.getByRole("button", {name, exact:true});
        const count = (value:number) => toolbar.getByRole("status").filter({hasText:`${value} selected`}).waitFor();
        await button("Hide ended").click();
        await button("Select").click();
        await count(0);
        assert.deepEqual(await toolbar.locator(":scope > *").allTextContents(), ["Select all", "0 selected", "Delete", "Cancel"]);
        assert.equal(await button("Delete").isDisabled(), true);
        assert.equal(await page.getByRole("checkbox").count(), 2, "locked runs can be selected, sharees cannot");
        await search.focus();
        await page.keyboard.press("Tab");
        assert.equal(await button("Select all").evaluate((item) => item === document.activeElement), true);
        await page.keyboard.press("Space");
        await count(2);
        assert.equal(await page.getByRole("checkbox", {name:"Select Review locked"}).isChecked(), true);
        await button("Select none").click();
        await count(0);
        assert.equal(await page.getByRole("checkbox", {checked:true}).count(), 0);
        await button("Select all").click();
        await button("Delete").focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", {name:"Delete 2 runs?"});
        await dialog.waitFor();
        await page.keyboard.press("Escape");
        await dialog.waitFor({state:"detached"});
        await count(2);
        assert.equal(await sent(page), undefined, "dismissing confirmation sends no deletion");
        await button("Cancel").focus();
        await page.keyboard.press("Space");
        await button("Select").waitFor();
        assert.equal(await toolbar.getByRole("status").count(), 0);
        assert.equal(await page.getByRole("checkbox").count(), 0);
        assert.equal(await button("Hide ended").getAttribute("aria-pressed"), "true", "leaving selection keeps the filter");
        await button("Hide ended").click();
        await button("Select").click();
        await count(0);
        await button("Select all").click();
        await count(3);
        await search.fill("Review plan");
        await button("Select none").click();
        await count(2);
        await button("Select all").click();
        await count(3);
        await search.fill("Shared");
        await button("Select all").waitFor();
        assert.equal(await button("Select all").isDisabled(), true, "sharees do not make Select all available");
        await search.fill("no matching title");
        await page.getByText("No matching run.", {exact:true}).waitFor();
        assert.equal(await button("Select all").isDisabled(), true);
        await search.fill("");
        await button("Select none").waitFor();
        await count(3);
        assert.deepEqual(await toolbar.locator(":scope > *").allTextContents(), ["Select none", "3 selected", "Delete", "Cancel"]);
        assert.equal(await button("Delete").evaluate((item) => getComputedStyle(item).boxShadow), "none");
        if (width === 900) {
          const directory = process.env.RAGENTS_SCREENSHOT_DIR ?? shots;
          await mkdir(directory, {recursive:true});
          await page.screenshot({path:join(directory, `runs-select-${theme}.png`)});
        }
        await setConnections(page, [{...connection, runs:[...runs, ...Array.from({length:45}, (_, index) => run(`extra-${index}`, `Planning task ${index + 1}`, "idle", index + 10))]}]);
        await page.getByRole("list", {name:"Runs", exact:true}).getByRole("button", {name:/Planning task 45/}).waitFor();
        await page.locator("main").evaluate((main) => { main.scrollTop = 350; });
        await page.waitForFunction(() => document.querySelector("main")!.scrollTop > 300);
        const bounds = await toolbar.evaluate((item) => {
          const rect = item.getBoundingClientRect();
          const search = document.querySelector('[aria-label="Search runs"]')!.getBoundingClientRect();
          const first = item.querySelector("button")!.getBoundingClientRect();
          return {top:rect.top, bottom:rect.bottom, searchTop:search.top, searchBottom:search.bottom,
            unobstructed:item.contains(document.elementFromPoint(first.x + first.width / 2, first.y + first.height / 2)),
            overflow:document.querySelector("main")!.scrollWidth > document.querySelector("main")!.clientWidth};
        });
        assert.ok(bounds.searchTop >= 0 && bounds.top >= 0 && bounds.bottom < 620, "the search and the actions stay at the top of the page");
        assert.equal(bounds.unobstructed, true, "scrolling rows cannot cover the actions");
        assert.equal(bounds.overflow, false, "the toolbar fits narrow and wide panels");
        await button("Delete").click();
        await page.getByRole("dialog", {name:"Delete 3 runs?"}).getByRole("button", {name:"Delete", exact:true}).click();
        assert.deepEqual(await sent(page), {action:"deleteRuns", name:"workshop", runIds:["own", "locked", "ended"]});
        await button("Select").waitFor();
        await page.close();
      }
    } finally { await browser.close(); }
  });
}

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

test("Runs saves every sharing choice immediately, keeps the returned state open and restores a refused change",{skip,timeout:120_000},async()=>{
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
    assert.equal(await page.getByRole('button',{name:'Delete Viewed run'}).count(),0,'a sharee never deletes the run');
    assert.equal(await page.getByRole('button',{name:'Delete Joined run'}).count(),0,'operating a shared run does not allow deleting it');
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
    assert.notEqual(await dialog.getAttribute('aria-modal'),'true','the Runs sharing panel uses the non-modal header dropdown shell');
    await setSharing(page,{connection:'workshop',runId:'own',result:loaded});
    await dialog.getByRole('list',{name:'Shared with'}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:/^(Save|Cancel)$/}).count(),0,'access choices need no confirmation');
    assert.match(await dialog.innerText(),/Own review/,'the dialog names the run');
    assert.equal(await dialog.getByRole('combobox').count(),0,'the dialog is a list, without dropdowns');
    assert.deepEqual((await dialog.getByRole('list',{name:'Shared with'}).getByRole('listitem').allInnerTexts()).map((row)=>row.split('\n')[0]),['Everyone','Bob','Carol'],'every user is a row');
    const access=(name:string,value:string)=>dialog.getByRole('group',{name:`Access for ${name}`,exact:true}).getByRole('button',{name:value,exact:true});
    const choose=(name:string,value:string)=>access(name,value).click();
    const pressed=(name:string,value:string)=>access(name,value).getAttribute('aria-pressed');
    assert.deepEqual(await dialog.getByRole('group',{name:'Access for Everyone',exact:true}).getByRole('button').allTextContents(),['Off','View','Operate']);
    assert.equal(await access('Everyone','View').getAttribute('title'),'Sees the run');
    assert.equal(await access('Everyone','Operate').getAttribute('title'),"Also works in it, within the user's own permissions");
    assert.equal(await dialog.getByText("Can view sees the run. Can operate also works in it, within the user's own permissions.",{exact:true}).count(),0);
    await choose('Everyone','View');
    assert.deepEqual(await sent(page),{action:'share',name:'workshop',runId:'own',sharing:{everyone:'read',users:[{userId:'bob',access:'read'}]}});
    await setSharing(page,{connection:'workshop',runId:'own',result:loaded,pending:true});
    await dialog.locator('[aria-busy="true"]').waitFor();
    assert.equal(await dialog.getByRole('group').getByRole('button',{disabled:false}).count(),0,'all rows wait while a save is pending');
    const accepted={...loaded,sharing:{everyone:'read',users:[{userId:'bob',label:'Bob',access:'write'}]}};
    await setSharing(page,{connection:'workshop',runId:'own',result:accepted});
    await access('Bob','Operate').waitFor();
    assert.equal(await pressed('Everyone','View'),'true');
    assert.equal(await pressed('Bob','Operate'),'true','the returned server state replaces the displayed values');
    assert.equal(await dialog.isVisible(),true,'saving keeps the dropdown open');
    await choose('Carol','View');
    assert.deepEqual(await sent(page),{action:'share',name:'workshop',runId:'own',sharing:{everyone:'read',users:[{userId:'bob',access:'write'},{userId:'carol',access:'read'}]}},'the next row change preserves the whole saved sharing');
    await setSharing(page,{connection:'workshop',runId:'own',result:accepted,pending:true});
    await dialog.locator('[aria-busy="true"]').waitFor();
    await setSharing(page,{connection:'workshop',runId:'own',result:accepted,error:'carol is not a user of this profile'});
    await dialog.getByRole('alert').filter({hasText:'carol is not a user of this profile'}).waitFor();
    assert.equal(await pressed('Carol','Off'),'true','a refused change restores the last saved access');
    assert.equal(await pressed('Bob','Operate'),'true','a refusal preserves other saved rows');
    await choose('Bob','Off');
    assert.deepEqual(await sent(page),{action:'share',name:'workshop',runId:'own',sharing:{everyone:'read',users:[]}},'Off removes the user while preserving Everyone');
    await setSharing(page,{connection:'workshop',runId:'own',result:{...accepted,sharing:{everyone:'read',users:[]}}});
    await page.screenshot({path:`${shots}share-panel-420.png`});
    await page.keyboard.press('Escape');
    assert.deepEqual(await sent(page),{action:'closeSharing'});
    await setSharing(page,undefined);
    await page.waitForSelector('[role=dialog]',{state:'detached'});
    assert.equal(await page.getByRole('button',{name:'Share Own review'}).evaluate((button)=>button===document.activeElement),true,'closing restores the row share button');

    await page.getByRole('button',{name:'Select'}).click();
    assert.equal(await page.getByRole('checkbox',{name:'Select Own review'}).count(),1);
    assert.equal(await page.getByRole('checkbox',{name:'Select Viewed run'}).count(),0,'a run shared with the user is never deleted');
    assert.equal(await columnEdges(page,'Runs','time'),1,'rows without a checkbox stay in their columns');
  }finally{await browser.close()}
});

for(const width of [1400,360,320]){
  test(`Runs sharing uses the same square dropdown content at ${width}px and a page anchor if its row disappears`,{skip,timeout:90_000},async()=>{
    const own={...run('own','Own review','idle',1),canShare:true};
    const connection={...workshop,runs:[own],canDelete:true};
    const url=await preparePage({theme:'light',page:'runs',profileSuggestions:[],connections:[connection]});
    const longName='Carol with a deliberately long display name';
    const loaded={sharing:{everyone:null,users:[]},users:[{id:'bob',label:'Bob'},{id:'carol',label:longName}]};
    const update=(page:Page,value:unknown)=>page.evaluate((sharing)=>(window as any).fixture.setState((current:any)=>({...current,sharing})),value);
    const browser=await launch();
    try{
      const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
      page.setDefaultTimeout(8000);
      const errors:string[]=[];
      page.on('pageerror',(error)=>errors.push(error.message));
      await page.goto(url);
      const trigger=page.getByRole('button',{name:'Share Own review',exact:true});
      await trigger.click();
      await update(page,{connection:'workshop',runId:'own',result:loaded});
      const panel=page.getByRole('dialog',{name:'Share run',exact:true});
      await panel.getByRole('group',{name:'Access for Bob',exact:true}).waitFor();
      await panel.evaluate(async(element)=>{await Promise.all(element.getAnimations().map((animation)=>animation.finished.catch(()=>undefined)))});
      const row=await trigger.boundingBox();
      const bounds=await panel.boundingBox();
      assert.ok(row&&bounds);
      assert.ok(Math.abs(bounds.y-row.y-row.height-8)<1,'sharing opens below its row button');
      assert.ok(bounds.x>=7&&bounds.x+bounds.width<=width-7,'the sharing dropdown stays in the viewport');
      const style=await panel.evaluate((element)=>{
        const computed=getComputedStyle(element);
        return{corners:[computed.borderTopLeftRadius,computed.borderTopRightRadius,computed.borderBottomLeftRadius,computed.borderBottomRightRadius],
          padding:[computed.paddingTop,computed.paddingRight,computed.paddingBottom,computed.paddingLeft],overflow:element.scrollWidth>element.clientWidth};
      });
      assert.deepEqual(style.corners,['0px','0px','0px','0px']);
      assert.deepEqual(style.padding,['8px','8px','8px','8px']);
      assert.equal(style.overflow,false);
      assert.notEqual(await panel.getAttribute('aria-modal'),'true');
      assert.equal(await page.locator('[data-slot="popover-backdrop"]:visible').count(),1);
      assert.equal(await trigger.getAttribute('aria-expanded'),'true');
      assert.equal(await trigger.getAttribute('aria-controls'),await panel.getAttribute('id'));
      const rows=await panel.getByRole('list',{name:'Shared with',exact:true}).getByRole('listitem').evaluateAll((items)=>items.map((item)=>{
        const name=item.querySelector('span')!;
        const group=item.querySelector('[role="group"]')!;
        const nameBounds=name.getBoundingClientRect();
        const groupBounds=group.getBoundingClientRect();
        const buttons=[...group.querySelectorAll('button')].map((button)=>button.getBoundingClientRect());
        return{left:Math.round(groupBounds.left),sameRow:Math.abs(nameBounds.top+nameBounds.height/2-groupBounds.top-groupBounds.height/2)<1,
          controlRows:new Set(buttons.map((button)=>Math.round(button.top))).size,nameWrap:getComputedStyle(name).whiteSpace,
          title:name.getAttribute('title'),truncated:name.scrollWidth>name.clientWidth};
      }));
      assert.equal(new Set(rows.map((row)=>row.left)).size,1,'every control shares one grid column');
      assert.ok(rows.every((row)=>row.sameRow&&row.controlRows===1&&row.nameWrap==='nowrap'),'names and controls stay on one line');
      assert.equal(rows[2]!.title,`${longName} (carol)`,'a truncated name keeps its full tooltip');
      if(width<=360)assert.equal(rows[2]!.truncated,true,'narrow panels truncate long names');
      await mkdir(shots,{recursive:true});
      await page.screenshot({path:`${shots}share-dropdown-${width}.png`});
      await trigger.click();
      assert.deepEqual(await sent(page),{action:'closeSharing'},'the row share button toggles its dropdown closed');
      await update(page,undefined);
      await panel.waitFor({state:'detached'});
      await trigger.click();
      await update(page,{connection:'workshop',runId:'own',result:loaded});
      await panel.getByRole('group',{name:'Access for Bob',exact:true}).waitFor();
      await panel.getByRole('group',{name:'Access for Bob',exact:true}).getByRole('button',{name:'Operate',exact:true}).click();
      assert.deepEqual(await sent(page),{action:'share',name:'workshop',runId:'own',sharing:{everyone:null,users:[{userId:'bob',access:'write'}]}});
      await update(page,{connection:'workshop',runId:'own',result:{...loaded,sharing:{everyone:null,users:[{userId:'bob',label:'Bob',access:'write'}]}}});
      assert.equal(await panel.isVisible(),true,'successful sharing stays open');
      await page.mouse.click(2,898);
      assert.deepEqual(await sent(page),{action:'closeSharing'},'clicking outside closes without another sharing change');
      await update(page,undefined);
      await panel.waitFor({state:'detached'});
      assert.equal(await trigger.evaluate((element)=>element===document.activeElement),true,'closing restores the row button');

      await page.evaluate(()=>(window as any).fixture.setState((current:any)=>({...current,connections:current.connections.map((entry:any)=>({...entry,runs:[]})),sharing:{connection:'workshop',runId:'own',result:{sharing:{everyone:null,users:[]},users:[]}}})));
      await panel.getByText('This profile has no other users to share with.',{exact:true}).waitFor();
      await panel.getByRole('group',{name:'Access for Everyone',exact:true}).getByRole('button',{name:'View',exact:true}).click();
      assert.deepEqual(await sent(page),{action:'share',name:'workshop',runId:'own',sharing:{everyone:'read',users:[]}});
      await page.keyboard.press('Escape');
      assert.deepEqual(await sent(page),{action:'closeSharing'});
      await update(page,undefined);
      await panel.waitFor({state:'detached'});
      await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Back to Start').catch(async(error)=>{
        const focused=await page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id,label:document.activeElement?.getAttribute('aria-label')}));
        throw new Error(`The page's first control did not receive focus: ${JSON.stringify(focused)}.`,{cause:error});
      });
      assert.equal(await page.getByRole('button',{name:'Back to Start',exact:true}).evaluate((element)=>element===document.activeElement),true,'a vanished row restores the page first control');
      assert.deepEqual(errors,[]);
    }finally{await browser.close()}
  });
}
