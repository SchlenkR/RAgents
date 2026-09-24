import assert from "node:assert/strict";
import test from "node:test";
import {mkdir,mkdtemp,writeFile} from "node:fs/promises";
import {tailwindPlugin} from "./tailwind-plugin";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {chromium} from "playwright-core";
import type {Page} from "playwright-core";

const shots=fileURLToPath(new URL("../../../docs/ui-drafts/",import.meta.url));
const suggestions=["/Users/example/repos/RAgents/ragents.config.core.ts","/Users/example/repos/RAgents/ragents.config.developer.ts"];
const server=(name:string,state:unknown,extra:Record<string,unknown>={})=>({name,kind:"server",address:"http://localhost:4715",state,runs:[],entries:[],canCreate:true,...extra});
const core={name:"core",kind:"profile",address:"/Users/example/repos/RAgents/ragents.config.core.ts",state:{kind:"starting"},runs:[],entries:[],canCreate:false};
const patch=(page:Page,values:Record<string,unknown>)=>page.evaluate((next)=>(window as any).fixture.setState((current:any)=>({...current,...next})),values);
const sent=(page:Page)=>page.evaluate(()=>(window as any).fixture.sent.at(-1));

test("die Seite Server legt im Dialog an, behält Eingaben bei einem Fehler, bearbeitet, meldet an und entfernt nach einer Rückfrage im Dialog",{skip:process.env.RAGENTS_BROWSER_TESTS!=="1",timeout:120_000},async(context)=>{
  const scratch="/private/tmp/ragents-connections-page";await mkdir(scratch,{recursive:true});const directory=await mkdtemp(`${scratch}/page-`);const root=fileURLToPath(new URL("../../../",import.meta.url));
  await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{PanelPage}from'${root}apps/web/src/panel/PanelPage.tsx';import'${root}apps/web/src/ui/tailwind.css';
function App(){const[state,setState]=useState(window.fixture.initial);window.fixture={...window.fixture,setState};window.fixture.sent??=[];return <PanelPage state={state} send={action=>window.fixture.sent.push(action)}/>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:`${root}apps/web`,loader:"tsx"},jsx:"automatic",bundle:true,platform:"browser",format:"iife",outfile:`${directory}/app.js`,plugins:[tailwindPlugin([])],logLevel:"silent"});
  const initial={theme:"dark",page:"connections",connections:[],profileSuggestions:suggestions};
  await writeFile(`${directory}/index.html`,`<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"><script>window.fixture={initial:${JSON.stringify(initial)}}</script></head><body><div id="root"></div><script src="app.js"></script></body></html>`);
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE_PATH??"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
  try{
    const browserContext=await browser.newContext({viewport:{width:420,height:1000}});const page=await browserContext.newPage();await page.goto(`file://${directory}/index.html`);
    const dialog=page.getByRole('dialog');
    const closed=()=>page.waitForSelector('[role=dialog]',{state:'detached'});
    await page.getByRole('heading',{name:'Server'}).waitFor();
    assert.equal(await page.getByText('Noch kein Server.').count(),1);
    assert.equal(await page.getByRole('button',{name:'Zur Start-Seite'}).count(),1);

    // Anlegen läuft über den Dialog, nicht über ein Formular auf der Seite.
    await page.getByRole('button',{name:'Neuer Server'}).click();
    await dialog.waitFor();
    await page.locator('#connection-url').fill('localhost:4715');
    await page.locator('#connection-name').fill('werkstatt');
    await page.screenshot({path:`${shots}app-2026-09-22-umgebungen-neu-420.png`,fullPage:true});
    await page.getByRole('button',{name:'Anlegen'}).click();
    assert.deepEqual(await sent(page),{action:'addServer',name:'werkstatt',url:'localhost:4715'});

    // Ein abgelehnter Eintrag bleibt mit seinen Eingaben im Dialog, der Grund steht unter den Feldern.
    await patch(page,{problem:'url: ragents.serverUrl muss mit http:// oder https:// beginnen, nicht localhost:'});
    await dialog.getByRole('alert').waitFor();
    assert.equal(await page.locator('#connection-url').inputValue(),'localhost:4715','die abgelehnte Eingabe bleibt stehen');
    assert.equal(await page.locator('#connection-name').inputValue(),'werkstatt');
    await page.locator('#connection-url').fill('http://localhost:4715');
    await page.getByRole('button',{name:'Anlegen'}).click();
    await patch(page,{problem:undefined,connections:[server('werkstatt',{kind:'connected'},{user:'alex',savedLogin:true})]});
    await closed();
    assert.equal(await page.getByText('http://localhost:4715').count(),1);

    // Abbrechen schließt den Dialog, ohne etwas zu schicken.
    const before=await page.evaluate(()=>(window as any).fixture.sent.length);
    await page.getByRole('button',{name:'Neuer Server'}).click();
    await dialog.waitFor();
    await page.getByRole('button',{name:'Abbrechen'}).click();
    await closed();
    assert.equal(await page.evaluate(()=>(window as any).fixture.sent.length),before);

    // Ein lokales Profil kommt über die Vorschläge aus dem Host-Ordner; der Name kommt aus dem Dateinamen.
    await page.getByRole('button',{name:'Neuer Server'}).click();
    await page.getByRole('button',{name:'Lokales Profil'}).click();
    await page.getByRole('button',{name:/^core/}).click();
    assert.equal(await page.locator('#connection-name').inputValue(),'core','die gewählte Datei benennt das Profil');
    await page.getByRole('button',{name:'Anlegen'}).click();
    assert.deepEqual(await sent(page),{action:'addProfile',name:'core',profileFile:'/Users/example/repos/RAgents/ragents.config.core.ts'});
    await patch(page,{connections:[server('werkstatt',{kind:'connected'},{user:'alex',savedLogin:true}),core]});
    await closed();

    // Der Dateidialog von VS Code trägt seinen Pfad in denselben Dialog zurück.
    await page.getByRole('button',{name:'Neuer Server'}).click();
    await patch(page,{pickedProfileFile:'/anderswo/ragents.config.pruef.ts'});
    await page.waitForFunction(()=>(document.getElementById('connection-profile-file') as HTMLInputElement|null)?.value==='/anderswo/ragents.config.pruef.ts');
    assert.equal(await page.locator('#connection-name').inputValue(),'pruef');
    await page.getByRole('button',{name:'Abbrechen'}).click();
    await closed();
    await patch(page,{pickedProfileFile:undefined});

    // Ein lokales Profil startet die Erweiterung selbst; es gibt keinen Knopf Starten und keinen Knopf Stoppen.
    assert.equal(await page.getByRole('button',{name:'Starten',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Stoppen',exact:true}).count(),0);
    assert.equal(await page.locator('[title="startet"]').count(),1);
    await page.screenshot({path:`${shots}app-2026-09-22-umgebungen-420.png`,fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);

    // Bearbeiten schickt update, damit die gespeicherten Anmeldedaten ein Umbenennen überleben.
    await page.getByRole('button',{name:'Bearbeiten'}).first().click();
    await dialog.waitFor();
    assert.equal(await page.locator('#connection-url').inputValue(),'http://localhost:4715');
    await page.locator('#connection-name').fill('werkstatt-neu');
    await page.getByRole('button',{name:'Speichern'}).click();
    assert.deepEqual(await sent(page),{action:'updateServer',name:'werkstatt',newName:'werkstatt-neu',url:'http://localhost:4715'});
    await patch(page,{connections:[server('werkstatt-neu',{kind:'login-required',mode:'password'},{loginUser:'alex',savedLogin:true}),core]});
    await closed();

    // Die Anmeldung ist derselbe Dialog wie auf der Start-Seite.
    await page.getByRole('button',{name:'Anmelden'}).click();
    await dialog.getByRole('heading',{name:'Anmelden an werkstatt-neu'}).waitFor();
    await page.screenshot({path:`${shots}app-2026-09-22-umgebungen-anmelden-420.png`,fullPage:true});
    await page.getByLabel('Passwort').fill('geheim');
    await dialog.getByRole('button',{name:'Anmelden'}).click();
    assert.deepEqual(await sent(page),{action:'login',name:'werkstatt-neu',user:'alex',password:'geheim'});
    await patch(page,{connections:[server('werkstatt-neu',{kind:'connected'},{user:'alex',savedLogin:true}),core]});
    await closed();

    // Entfernen fragt im Dialog zurück, nicht in der Zeile.
    await page.getByRole('button',{name:'core entfernen'}).click();
    await dialog.getByRole('heading',{name:'core entfernen?'}).waitFor();
    await page.screenshot({path:`${shots}app-2026-09-22-umgebungen-entfernen-420.png`,fullPage:true});
    await dialog.getByRole('button',{name:'Abbrechen'}).click();
    await closed();
    await page.getByRole('button',{name:'core entfernen'}).click();
    await dialog.getByRole('button',{name:'Entfernen',exact:true}).click();
    assert.deepEqual(await sent(page),{action:'remove',name:'core'});
    await closed();

    // Fehlt ein Wert aus ragents.hostEnvironment, nennt die Seite den Namen und schickt ihn an den Befehl.
    await patch(page,{connections:[server('werkstatt-neu',{kind:'connected'},{user:'alex',savedLogin:true})],missingSecrets:['SERVICE_TOKEN','SERVICE_URL']});
    await page.getByRole('heading',{name:'Fehlende Werte'}).waitFor();
    await page.getByRole('button',{name:'Wert für SERVICE_URL setzen'}).click();
    assert.deepEqual(await sent(page),{action:'setSecret',name:'SERVICE_URL'});
    await patch(page,{missingSecrets:[]});
    await page.getByRole('heading',{name:'Fehlende Werte'}).waitFor({state:'detached'});
    assert.equal(await page.getByRole('heading',{name:'Fehlende Werte'}).count(),0,'ist nichts offen, steht dort kein leerer Kasten');

    await page.setViewportSize({width:900,height:1000});
    await page.waitForFunction(()=>innerWidth===900);
    await patch(page,{connections:[server('werkstatt-neu',{kind:'connected'},{user:'alex',savedLogin:true}),core]});
    await page.screenshot({path:`${shots}app-2026-09-22-umgebungen-900.png`,fullPage:true});
    await page.getByRole('button',{name:'Neuer Server'}).click();
    await dialog.waitFor();
    await page.getByRole('button',{name:'Lokales Profil'}).click();
    await page.getByRole('button',{name:/^developer/}).click();
    await page.screenshot({path:`${shots}app-2026-09-22-umgebungen-neu-900.png`,fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    context.diagnostic(`Screenshots: ${shots}`);
  }finally{await browser.close()}
});
