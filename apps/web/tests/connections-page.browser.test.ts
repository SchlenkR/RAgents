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
const suggestions=["/Users/example/repos/RAgents/ragents.config.core.ts","/Users/example/repos/RAgents/ragents.config.developer.ts"];
const server=(name:string,state:unknown,extra:Record<string,unknown>={})=>({name,kind:"server",address:"http://localhost:4715",state,runs:[],entries:[],canCreate:true,...extra});
const core={name:"core",kind:"profile",address:"/Users/example/repos/RAgents/ragents.config.core.ts",state:{kind:"starting"},runs:[],entries:[],canCreate:false};
const patch=(page:Page,values:Record<string,unknown>)=>page.evaluate((next)=>(window as any).fixture.setState((current:any)=>({...current,...next})),values);
const sent=(page:Page)=>page.evaluate(()=>(window as any).fixture.sent.at(-1));

test("the Server page creates in the dialog, keeps input on an error, edits, signs in and removes after a confirmation in the dialog",{skip:process.env.RAGENTS_BROWSER_TESTS!=="1",timeout:120_000},async(context)=>{
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
    assert.equal(await page.getByText('No server yet.').count(),1);
    assert.equal(await page.getByRole('button',{name:'Back to Start'}).count(),1);

    // Creating goes through the dialog, not through a form on the page.
    await page.getByRole('button',{name:'New server'}).click();
    await dialog.waitFor();
    await page.locator('#connection-url').fill('localhost:4715');
    await page.locator('#connection-name').fill('workshop');
    await page.screenshot({path:`${shots}servers-new-420.png`,fullPage:true});
    await page.getByRole('button',{name:'Create'}).click();
    assert.deepEqual(await sent(page),{action:'addServer',name:'workshop',url:'localhost:4715'});

    // A rejected entry stays in the dialog with its input, the reason is shown below the fields.
    await patch(page,{problem:'url: ragents.serverUrl must start with http:// or https://, not localhost:'});
    await dialog.getByRole('alert').waitFor();
    assert.equal(await page.locator('#connection-url').inputValue(),'localhost:4715','the rejected input stays');
    assert.equal(await page.locator('#connection-name').inputValue(),'workshop');
    await page.locator('#connection-url').fill('http://localhost:4715');
    await page.getByRole('button',{name:'Create'}).click();
    await patch(page,{problem:undefined,connections:[server('workshop',{kind:'connected'},{user:'alex',savedLogin:true})]});
    await closed();
    assert.equal(await page.getByText('http://localhost:4715').count(),1);

    // Cancel closes the dialog without sending anything.
    const before=await page.evaluate(()=>(window as any).fixture.sent.length);
    await page.getByRole('button',{name:'New server'}).click();
    await dialog.waitFor();
    await page.getByRole('button',{name:'Cancel'}).click();
    await closed();
    assert.equal(await page.evaluate(()=>(window as any).fixture.sent.length),before);

    // A local profile comes from the suggestions in the host folder; the name comes from the file name.
    await page.getByRole('button',{name:'New server'}).click();
    await page.getByRole('button',{name:'Local profile'}).click();
    await page.getByRole('button',{name:/^core/}).click();
    assert.equal(await page.locator('#connection-name').inputValue(),'core','the chosen file names the profile');
    await page.getByRole('button',{name:'Create'}).click();
    assert.deepEqual(await sent(page),{action:'addProfile',name:'core',profileFile:'/Users/example/repos/RAgents/ragents.config.core.ts'});
    await patch(page,{connections:[server('workshop',{kind:'connected'},{user:'alex',savedLogin:true}),core]});
    await closed();

    // The VS Code file dialog carries its path back into the same dialog.
    await page.getByRole('button',{name:'New server'}).click();
    await patch(page,{pickedProfileFile:'/elsewhere/ragents.config.probe.ts'});
    await page.waitForFunction(()=>(document.getElementById('connection-profile-file') as HTMLInputElement|null)?.value==='/elsewhere/ragents.config.probe.ts');
    assert.equal(await page.locator('#connection-name').inputValue(),'probe');
    await page.getByRole('button',{name:'Cancel'}).click();
    await closed();
    await patch(page,{pickedProfileFile:undefined});

    // The extension starts a local profile itself; there is no Start button and no Stop button.
    assert.equal(await page.getByRole('button',{name:'Start',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Stop',exact:true}).count(),0);
    assert.equal(await page.locator('[title="starting"]').count(),1);
    await page.screenshot({path:`${shots}servers-420.png`,fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);

    // Edit sends update so that the saved credentials survive a rename.
    await page.getByRole('button',{name:'Edit'}).first().click();
    await dialog.waitFor();
    assert.equal(await page.locator('#connection-url').inputValue(),'http://localhost:4715');
    await page.locator('#connection-name').fill('workshop-new');
    await page.getByRole('button',{name:'Save'}).click();
    assert.deepEqual(await sent(page),{action:'updateServer',name:'workshop',newName:'workshop-new',url:'http://localhost:4715'});
    await patch(page,{connections:[server('workshop-new',{kind:'login-required',mode:'password'},{loginUser:'alex',savedLogin:true}),core]});
    await closed();

    // Sign-in is the same dialog as on the Start page.
    await page.getByRole('button',{name:'Sign in'}).click();
    await dialog.getByRole('heading',{name:'Sign in to workshop-new'}).waitFor();
    await page.screenshot({path:`${shots}servers-sign-in-420.png`,fullPage:true});
    await page.getByLabel('Password').fill('secret');
    await dialog.getByRole('button',{name:'Sign in'}).click();
    assert.deepEqual(await sent(page),{action:'login',name:'workshop-new',user:'alex',password:'secret'});
    await patch(page,{connections:[server('workshop-new',{kind:'connected'},{user:'alex',savedLogin:true}),core]});
    await closed();

    // Remove asks for confirmation in the dialog, not in the row.
    await page.getByRole('button',{name:'Remove core'}).click();
    await dialog.getByRole('heading',{name:'Remove core?'}).waitFor();
    await page.screenshot({path:`${shots}servers-remove-420.png`,fullPage:true});
    await dialog.getByRole('button',{name:'Cancel'}).click();
    await closed();
    await page.getByRole('button',{name:'Remove core'}).click();
    await dialog.getByRole('button',{name:'Remove',exact:true}).click();
    assert.deepEqual(await sent(page),{action:'remove',name:'core'});
    await closed();

    // If a value from ragents.hostEnvironment is missing, the page names it and sends it to the command.
    await patch(page,{connections:[server('workshop-new',{kind:'connected'},{user:'alex',savedLogin:true})],missingSecrets:['SERVICE_TOKEN','SERVICE_URL']});
    await page.getByRole('heading',{name:'Missing values'}).waitFor();
    await page.getByRole('button',{name:'Set value for SERVICE_URL'}).click();
    assert.deepEqual(await sent(page),{action:'setSecret',name:'SERVICE_URL'});
    await patch(page,{missingSecrets:[]});
    await page.getByRole('heading',{name:'Missing values'}).waitFor({state:'detached'});
    assert.equal(await page.getByRole('heading',{name:'Missing values'}).count(),0,'with nothing open, there is no empty box');

    await page.setViewportSize({width:900,height:1000});
    await page.waitForFunction(()=>innerWidth===900);
    await patch(page,{connections:[server('workshop-new',{kind:'connected'},{user:'alex',savedLogin:true}),core]});
    await page.screenshot({path:`${shots}servers-900.png`,fullPage:true});
    await page.getByRole('button',{name:'New server'}).click();
    await dialog.waitFor();
    await page.getByRole('button',{name:'Local profile'}).click();
    await page.getByRole('button',{name:/^developer/}).click();
    await page.screenshot({path:`${shots}servers-new-900.png`,fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    context.diagnostic(`Screenshots: ${shots}`);
  }finally{await browser.close()}
});
