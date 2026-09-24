import assert from "node:assert/strict";
import test from "node:test";
import {mkdir,mkdtemp,writeFile} from "node:fs/promises";
import {tailwindPlugin} from "./tailwind-plugin";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright-core";
import type {Page} from "playwright-core";

const shots=fileURLToPath(new URL("../../../docs/ui-drafts/",import.meta.url));

const entry=(id:string,title:string,description:string,kind:string,category:string)=>({id,title,description,kind,category});
const entries=[
  entry("ragents.reference.board","Sammelboard","Ein Listenhelfer mit eigener Funktion, Mini-App und gemeinsamem Zustand.","skill","Mini-Apps"),
  entry("ragents.reference.notes","Notizbrett","Notizen ausblenden und wiederfinden, ohne den Actor zu verlieren.","skill","Mini-Apps"),
  entry("ragents.reference.circle","Gesprächsrunde","Vier Helfer sprechen reihum, der Koordinator führt die Runden.","script","Moderation"),
  entry("ragents.reference.word","Wortspiel","Vier Modelle reichen Wörter weiter, ein Actor beendet nach zwölf.","script","Spiele"),
];
const MINUTE=60_000;
const run=(id:string,title:string,state:string,minutes:number)=>({id,title,state,pendingActions:state==="waiting"?2:0,updatedAt:Date.now()-minutes*MINUTE});
const workshop={name:"workshop",kind:"server",address:"http://localhost:4715",route:{kind:"server",host:"localhost:4715",localHost:false},state:{kind:"connected"},user:"alex",
  runs:[run("run-a","Redaktionswerkstatt: Landingpage","running",0),run("run-b","Balkon-Planung Südseite","waiting",5),run("run-c","Wortspiel: Sonne","ended",1440*3)],entries,canCreate:true};
const core={name:"core",kind:"server",address:"https://workshop.example.com",route:{kind:"server",host:"workshop.example.com",localHost:true},state:{kind:"connected"},
  runs:[run("run-d","Moderierte Runde: Gute Zusammenarbeit","idle",180),run("run-e","Entscheidung klären: Hosting","ended",1440*5)],entries,canCreate:true};
const developer={name:"developer",kind:"profile",address:"/Users/example/repos/RAgents/ragents.config.developer.ts",route:{kind:"profile",profile:"developer"},state:{kind:"starting"},runs:[],entries:[],canCreate:false};
const review={name:"review",kind:"server",address:"https://review.example.com",route:{kind:"server",host:"review.example.com",localHost:false},state:{kind:"login-required",mode:"password"},runs:[],entries:[],canCreate:false};
const nachtlauf={name:"nachtlauf",kind:"server",address:"https://nachtlauf.example.com:8443",route:{kind:"server",host:"nachtlauf.example.com:8443",localHost:false},state:{kind:"unreachable",message:"fetch failed"},runs:[],entries:[],canCreate:false};
const all=[workshop,core,developer,review,nachtlauf];

const skip=process.env.RAGENTS_BROWSER_TESTS!=="1";
const launch=()=>chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH??"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});

/** Das Panel scrollt in main statt im Dokument; für ein Bild der ganzen Seite wächst der Viewport kurz auf die Inhaltshöhe. */
const shoot=async(page:Page,path:string)=>{
  const {width,height}=page.viewportSize()!;
  const content=await page.evaluate(()=>document.querySelector('main')!.scrollHeight);
  await page.setViewportSize({width,height:Math.max(height,content)});
  await page.screenshot({path});
  await page.setViewportSize({width,height});
};

/** Bündelt das Panel mit Tailwind in einen frischen Ordner und legt die Seite mit dem Anfangszustand daneben. */
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
/** Die linken Kanten einer Spalte der Run-Liste; ein Raster hat je Spalte genau eine. */
const columnEdges=(page:Page,list:string,cell:string)=>page.evaluate(([label,name])=>
  new Set([...document.querySelectorAll(`ul[aria-label="${label}"] [data-cell="${name}"]`)].map((item)=>Math.round(item.getBoundingClientRect().left))).size,[list,cell]);

test("Start zeigt die Server als geteilte Chips mit Zielzeile, die letzten Runs im Raster und die Vorlagen und startet mit einem Klick",{skip,timeout:120_000},async(context)=>{
  const url=await preparePage({theme:"dark",page:"start",profileSuggestions:[],connections:all});
  const browser=await launch();
  try{
    const browserContext=await browser.newContext({viewport:{width:420,height:1100}});const page=await browserContext.newPage();await page.goto(url);
    await page.getByRole('heading',{name:'Server'}).waitFor();
    assert.equal(await page.getByRole('heading',{level:1}).count(),0,'Start hat keine eigene Kopfzeile');
    assert.equal(await page.getByRole('button',{name:'Runs',exact:true}).count(),0,'die Aktionen stehen nur in der Titelzeile von VS Code');
    assert.equal(await page.getByRole('button',{name:'Server einrichten'}).count(),0);

    // Zwei Server je Zeile bei 420 Pixeln, alle in einer ab 560.
    const connectionRows=()=>page.evaluate(()=>
      new Set([...document.querySelectorAll('ul[aria-label="Server"] > li')].map((item)=>Math.round(item.getBoundingClientRect().top))).size);
    assert.equal(await connectionRows(),3,'fünf Server stehen bei 420 Pixeln in drei Zeilen');
    assert.equal(await page.getByRole('button',{name:'Neuer Chat auf workshop'}).count(),1);
    assert.equal(await page.getByRole('button',{name:'Neuer Chat auf review'}).count(),0,'ohne Startrecht kein Plus');
    const chip=(name:string)=>page.locator('ul[aria-label="Server"] > li').filter({hasText:name}).first();
    assert.equal(await chip('workshop').locator('[data-cell="route"]').innerText(),'localhost:4715');
    assert.equal(await chip('core').locator('[data-cell="route"]').innerText(),'workshop.example.com \u00b7 lokal','ein verteiltes Profil läuft lokal');
    assert.equal(await chip('developer').locator('[data-cell="route"]').innerText(),'lokal \u00b7 developer');
    assert.equal(await chip('nachtlauf').locator('[data-cell="route"]').innerText(),'nachtlauf.example.com:8443','ein Port außer dem Standard bleibt stehen');
    const widths=await page.evaluate(()=>[...document.querySelectorAll('ul[aria-label="Server"] > li')].map((item)=>Math.round(item.getBoundingClientRect().width)));
    assert.equal(new Set(widths).size,1,`alle Chips sind gleich breit, mit und ohne Plus: ${widths.join(', ')}`);
    assert.equal(await page.getByRole('button',{name:'developer startet'}).isDisabled(),true,'ein startender Server ist nicht klickbar');

    // Der linke Teil ist ein Knopf mit Aktionswort: Anmelden, Erneut versuchen, Runs.
    const anmelden=page.getByRole('button',{name:'An review anmelden'});
    assert.equal(await anmelden.count(),1);
    assert.match(await anmelden.innerText(),/Anmelden\s+review\.example\.com$/,'das Aktionswort steht neben dem Namen, die Zielzeile darunter');
    const placement=await chip('review').evaluate((item)=>{
      const state=item.querySelector<HTMLElement>('button[aria-label="Anmeldung an review"]')!;
      const icon=state.querySelector<HTMLElement>('svg')!;
      const action=item.querySelector<HTMLElement>('button[aria-label="An review anmelden"]')!;
      const text=action.querySelector<HTMLElement>(':scope > span')!;
      const stateBox=state.getBoundingClientRect();
      const iconBox=icon.getBoundingClientRect();
      return {
        iconOffset:Math.abs(iconBox.left+iconBox.width/2-(stateBox.left+stateBox.width/2)),
        textInset:text.getBoundingClientRect().left-action.getBoundingClientRect().left,
      };
    });
    assert.ok(placement.iconOffset<0.5,`das Zustandssymbol ist mittig: ${placement.iconOffset}`);
    assert.ok(placement.textInset>=7.5,`der Text hat nominell 8 Pixel Abstand: ${placement.textInset}`);
    await anmelden.click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role=dialog]',{state:'detached'});
    await page.getByRole('button',{name:'nachtlauf erneut versuchen'}).click();
    assert.deepEqual(await sent(page),{action:'retry',name:'nachtlauf'});
    await page.getByRole('button',{name:'Runs auf workshop'}).click();
    assert.deepEqual(await sent(page),{action:'page',page:'runs',connection:'workshop'});

    // Weiter zeigt fünf Zeilen aller Server im Raster, Neu alle Vorlagen flach.
    assert.equal(await page.getByRole('button',{name:/^Alle 5 Runs/}).count(),1);
    assert.equal(await page.locator('button[title="Redaktionswerkstatt: Landingpage (workshop)"]').count(),1);
    assert.equal(await columnEdges(page,'Zuletzt','time'),1,'die Zeitspalte steht in allen Zeilen an derselben Kante');
    assert.equal(await columnEdges(page,'Zuletzt','connection'),1,'die Serverspalte steht in allen Zeilen an derselben Kante');
    assert.equal(await page.locator('ul[aria-label="Vorlagen auf core"] button[title="Wortspiel"]').count(),1,'jede Vorlage jedes Servers steht in der Gruppe ihres Servers');
    assert.equal(await page.getByLabel('Vorlagen suchen').count(),0,'auf Start gibt es keine Suche');
    await shoot(page,`${shots}app-2026-09-22-start-420.png`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);

    // Ein Klick ist ein Klick: die Vorlage legt den Run an, das Plus den leeren Chat, die Zeile öffnet den Run.
    await page.locator('ul[aria-label="Vorlagen auf core"] button[title="Gesprächsrunde"]').click();
    assert.deepEqual(await sent(page),{action:'newRun',name:'core',entryId:'ragents.reference.circle'});
    await page.getByRole('button',{name:'Neuer Chat auf workshop'}).click();
    assert.deepEqual(await sent(page),{action:'newRun',name:'workshop'});
    await page.locator('button[title="Balkon-Planung Südseite (workshop)"]').click();
    assert.deepEqual(await sent(page),{action:'openRun',name:'workshop',runId:'run-b'});

    // Neu gruppiert je erreichbarem Server und beginnt jede Gruppe mit Neuer Chat; mit Default steht dessen Vorlage markiert zuerst, und das Plus nimmt ihn.
    const groups=()=>page.evaluate(()=>[...document.querySelectorAll('ul[aria-label^="Vorlagen auf "]')].map((list)=>({
      connection:list.getAttribute('aria-label')!.replace('Vorlagen auf ',''),
      heading:list.previousElementSibling?.textContent?.trim(),
      titles:[...list.querySelectorAll(':scope > li > button')].map((item)=>item.getAttribute('title')),
    })));
    const tilesOf=async(connection:string)=>(await groups()).find((group)=>group.connection===connection)!;
    assert.deepEqual((await groups()).map((group)=>group.connection),['workshop','core'],'eine Gruppe je erreichbarem Server, Reihenfolge wie die Chips');
    assert.match((await tilesOf('workshop')).heading??'',/workshop$/,'die Gruppe trägt den Servernamen als Überschrift');
    assert.equal((await tilesOf('workshop')).titles[0],'Neuer Chat');
    assert.equal((await tilesOf('core')).titles[0],'Neuer Chat');
    assert.equal((await groups()).flatMap((group)=>group.titles).length,10,'zweimal Neuer Chat vor den acht Vorlagen');
    await page.locator('ul[aria-label="Vorlagen auf core"] button[title="Neuer Chat"]').click();
    assert.deepEqual(await sent(page),{action:'newRun',name:'core'});
    const firstTile=(connection:string,title:string)=>page.waitForFunction(([list,expected])=>document.querySelector(`ul[aria-label="Vorlagen auf ${list}"] > li > button`)?.getAttribute('title')===expected,[connection,title]);
    await setConnections(page,[{...workshop,defaultEntry:'ragents.reference.circle'},core,developer,review,nachtlauf]);
    await firstTile('workshop','Gesprächsrunde');
    assert.deepEqual((await tilesOf('workshop')).titles.slice(0,1),['Gesprächsrunde']);
    assert.equal((await groups()).flatMap((group)=>group.titles).length,9,'der Default steht nicht ein zweites Mal');
    const standardTile=page.locator('ul[aria-label="Vorlagen auf workshop"] button[title="Gesprächsrunde"]');
    assert.equal(await standardTile.getByText('Standard').count(),1);
    await standardTile.click();
    assert.deepEqual(await sent(page),{action:'newRun',name:'workshop',entryId:'ragents.reference.circle'});
    await page.getByRole('button',{name:'Neuer Run aus Gesprächsrunde auf workshop'}).click();
    assert.deepEqual(await sent(page),{action:'newRun',name:'workshop',entryId:'ragents.reference.circle'});
    await shoot(page,`${shots}app-2026-09-22-start-standard-420.png`);
    await setConnections(page,all);
    await firstTile('workshop','Neuer Chat');

    // Das Zustandssymbol eines gescheiterten Servers öffnet die Meldung mit Ausgabe öffnen und Erneut versuchen; das Schloss die Anmeldung.
    await page.getByRole('button',{name:'Fehler von nachtlauf anzeigen'}).click();
    const failure=page.getByRole('dialog',{name:'nicht erreichbar'});
    await failure.waitFor();
    await failure.getByText('fetch failed').waitFor();
    await page.evaluate(()=>Promise.all(document.getAnimations().map((animation)=>animation.finished)));
    await page.screenshot({path:`${shots}app-2026-09-22-start-fehler-420.png`});
    await failure.getByRole('button',{name:'Ausgabe öffnen'}).click();
    assert.deepEqual(await sent(page),{action:'showOutput'});
    await failure.getByRole('button',{name:'Erneut versuchen'}).click();
    assert.deepEqual(await sent(page),{action:'retry',name:'nachtlauf'});
    await page.waitForSelector('[role=dialog]',{state:'detached'});
    await page.getByRole('button',{name:'Anmeldung an review'}).click();
    await page.getByRole('dialog',{name:'Anmelden an review'}).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role=dialog]',{state:'detached'});

    await page.setViewportSize({width:900,height:1100});
    await page.waitForFunction(()=>innerWidth===900);
    assert.equal(await connectionRows(),1,'ab 560 Pixeln stehen alle Server in einer Zeile');
    await shoot(page,`${shots}app-2026-09-22-start-900.png`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    context.diagnostic(`Screenshots: ${shots}`);
  }finally{await browser.close()}
});

test("Runs führt alle Runs zusammen, sucht, blendet Beendete aus und löscht nach einer Rückfrage",{skip,timeout:120_000},async(context)=>{
  const url=await preparePage({theme:"dark",page:"runs",profileSuggestions:[],connections:all});
  const browser=await launch();
  try{
    const browserContext=await browser.newContext({viewport:{width:420,height:1100}});const page=await browserContext.newPage();await page.goto(url);
    await page.getByRole('heading',{name:'Runs'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Server',exact:true}).count(),0,'die Kopfzeile trägt nur Zurück und Titel');
    const lines=()=>page.locator('ul[aria-label="Runs"] > li').count();
    assert.equal(await lines(),5,'alle Runs aller Server stehen hier');
    assert.equal(await columnEdges(page,'Runs','time'),1,'die Zeitspalte steht in allen Zeilen an derselben Kante');
    assert.equal(await columnEdges(page,'Runs','connection'),1,'die Serverspalte steht in allen Zeilen an derselben Kante');
    const edgesBefore=await page.evaluate(()=>['time','connection'].map((name)=>Math.round(document.querySelector(`ul[aria-label="Runs"] [data-cell="${name}"]`)!.getBoundingClientRect().left)));
    await shoot(page,`${shots}app-2026-09-22-runs-420.png`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);

    await page.getByRole('button',{name:'Beendete ausblenden'}).click();
    await page.waitForFunction(()=>document.querySelectorAll('button[title*="Wortspiel: Sonne"]').length===0);
    assert.equal(await lines(),3);
    await page.getByRole('button',{name:'Beendete ausblenden'}).click();

    await page.getByLabel('Runs suchen').fill('balkon');
    await page.waitForFunction(()=>document.querySelectorAll('button[title*="Redaktionswerkstatt"]').length===0);
    assert.equal(await lines(),1);
    await page.getByLabel('Runs suchen').fill('core');
    await page.waitForFunction(()=>document.querySelectorAll('button[title*="Balkon"]').length===0);
    assert.equal(await lines(),2,'die Suche kennt auch den Namen des Servers');
    await page.getByLabel('Runs suchen').fill('gibtesnicht');
    await page.getByRole('status').filter({hasText:'Kein passender Run.'}).waitFor();
    await page.getByLabel('Runs suchen').fill('');

    // Auswählen, zwei Runs markieren, im Dialog bestätigen.
    await page.getByRole('button',{name:'Auswählen'}).click();
    await page.getByRole('checkbox',{name:'Balkon-Planung Südseite auswählen'}).click();
    await page.getByRole('checkbox',{name:'Wortspiel: Sonne auswählen'}).click();
    await page.getByText('2 ausgewählt').waitFor();
    assert.equal(await columnEdges(page,'Runs','time'),1,'auch mit Kontrollkästchen steht die Zeit in einer Kante');
    assert.equal(await columnEdges(page,'Runs','connection'),1);
    const edgesSelecting=await page.evaluate(()=>['time','connection'].map((name)=>Math.round(document.querySelector(`ul[aria-label="Runs"] [data-cell="${name}"]`)!.getBoundingClientRect().left)));
    assert.deepEqual(edgesSelecting,edgesBefore,'das Kontrollkästchen verschiebt die rechten Spalten nicht');
    await shoot(page,`${shots}app-2026-09-22-runs-auswahl-420.png`);
    await page.getByRole('button',{name:'Löschen'}).click();
    const dialog=page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('heading',{name:'2 Runs löschen?'}).waitFor();
    await page.screenshot({path:`${shots}app-2026-09-22-runs-loeschen-420.png`});
    await dialog.getByRole('button',{name:'Löschen'}).click();
    assert.deepEqual(await sent(page),{action:'deleteRuns',name:'workshop',runIds:['run-b','run-c']});
    await page.waitForSelector('[role=dialog]',{state:'detached'});
    assert.equal(await page.getByText('ausgewählt').count(),0,'nach dem Löschen endet der Auswahlmodus');

    await page.setViewportSize({width:900,height:1100});
    await page.waitForFunction(()=>innerWidth===900);
    await shoot(page,`${shots}app-2026-09-22-runs-900.png`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);

    await setPage(page,'start');
    await page.getByRole('heading',{name:'Server'}).waitFor();
    await page.setViewportSize({width:420,height:1100});
    assert.equal(await page.getByRole('button',{name:'Zur Start-Seite'}).count(),0);
    context.diagnostic(`Screenshots: ${shots}`);
  }finally{await browser.close()}
});

test("der Chip auf Start filtert die Seite Runs auf seinen Server; der Schalter hebt den Filter auf",{skip,timeout:120_000},async()=>{
  const url=await preparePage({theme:"dark",page:"runs",runsConnection:"core",profileSuggestions:[],connections:all});
  const browser=await launch();
  try{
    const browserContext=await browser.newContext({viewport:{width:420,height:1100}});const page=await browserContext.newPage();await page.goto(url);
    await page.getByRole('heading',{name:'Runs'}).waitFor();
    const lines=()=>page.locator('ul[aria-label="Runs"] > li').count();
    assert.equal(await lines(),2,'nur die Runs von core');
    const filter=page.getByRole('button',{name:'Nur core'});
    assert.equal(await filter.getAttribute('aria-pressed'),'true');
    await filter.click();
    await page.waitForFunction(()=>document.querySelectorAll('ul[aria-label="Runs"] > li').length===5);
    assert.equal(await filter.count(),0,'ohne Filter verschwindet der Schalter');
  }finally{await browser.close()}
});

test("ein langer Run-Titel bleibt in der Panelbreite und die Seite scrollt in der Höhe",{skip,timeout:120_000},async()=>{
  const longTitle="LiesAUFTRAGmdUndFühreGenauDiesenAuftragAus".repeat(5);
  const connection={...workshop,runs:[run("run-long",longTitle,"running",1),...workshop.runs]};
  const url=await preparePage({theme:"dark",page:"start",profileSuggestions:[],connections:[connection]});
  const browser=await launch();
  try{
    const browserContext=await browser.newContext({viewport:{width:420,height:380}});const page=await browserContext.newPage();await page.goto(url);
    await page.getByRole('heading',{name:'Server'}).waitFor();
    await page.locator('button[title="Wortspiel"]').waitFor();

    const metrics=await page.evaluate((title)=>{
      const main=document.querySelector('main')!;
      const tiles=document.querySelector('ul[aria-label="Vorlagen"]')!;
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
    assert.ok(metrics.documentOverflow<=0,`die Seite läuft ${metrics.documentOverflow}px nach rechts über`);
    assert.ok(metrics.tilesOverflow<=0,`das Raster der Vorlagen ist ${metrics.tilesOverflow}px breiter als das Panel`);
    assert.ok(metrics.titleClipped>0,'der lange Run-Titel wird mit Ellipsis abgeschnitten');
    assert.ok(metrics.scrollRoom>0,'die Seite hat einen Scrollbereich in der Höhe');
    assert.ok(metrics.scrollTop>0,'die Seite lässt sich nach unten scrollen');
  }finally{await browser.close()}
});
