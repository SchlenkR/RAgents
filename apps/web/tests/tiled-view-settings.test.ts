import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { hostStylesheet, tailwindPlugin } from "./tailwind-plugin";
import { chromium } from "playwright-core";
import { canvasProgramBasis, currentCanvasOverride, initialTileLayout, parseCanvasPresentation, type CanvasPresentation } from "../../../plugins/ragents.orchestration/web/tiled-view-settings";
import { canvasTileEntities } from "../../../plugins/ragents.orchestration/tiled-layout";

test("no personal arrangement follows the program while an empty personal arrangement remains empty", () => {
  assert.equal(parseCanvasPresentation(null), null);
  assert.equal(parseCanvasPresentation("null"), null);
  assert.deepEqual(parseCanvasPresentation('{"mode":"tiled","root":null}'), { mode: "tiled", root: null });
});

test("personal mode changes preserve nested weights and participants across serialization", () => {
  const root = { direction: "vertical", weights: [1, 1], children: [
    { entity: "@coordinator" },
    { direction: "horizontal", weights: [2, 1], children: [{ entity: "app:workspace/main" }, { entity: "@helper" }] },
  ] };
  for (const mode of ["free", "tiled"]) {
    assert.deepEqual(parseCanvasPresentation(JSON.stringify({ mode, root })), { mode, root });
  }
});

test("corrupt personal layouts are rejected instead of silently losing the arrangement", () => {
  for (const value of [{ mode: "other", root: null }, { mode: "tiled" }, { mode: "tiled", root: { entity: "shape:x" } },
    { mode: "free", root: { direction: "horizontal", weights: [1, 0], children: [{ entity: "@a" }, { entity: "@b" }] } }]) {
    assert.throws(() => parseCanvasPresentation(JSON.stringify(value)));
  }
});

test("initial tiles include each selected content once in balanced nested splits", () => {
  assert.equal(initialTileLayout([]), null);
  assert.deepEqual(initialTileLayout(["@a"]), { entity: "@a" });
  const entities = ["app:main", "@a", "@b", "@c", "@d"];
  const root = initialTileLayout(entities)!;
  assert.deepEqual(canvasTileEntities(root), entities);
  assert.ok("direction" in root);
  assert.equal(root.direction, "horizontal");
  assert.deepEqual(root.weights, [3, 2]);
});

test("new program layouts immediately replace personal arrangements including after a reload", () => {
  const program: CanvasPresentation = { mode: "tiled", root: initialTileLayout(["app:items/main", "@coordinator"]) };
  const personal: CanvasPresentation = { mode: "tiled", root: initialTileLayout(["@coordinator", "app:items/main"]), programBasis: canvasProgramBasis(program) };
  assert.deepEqual(currentCanvasOverride(parseCanvasPresentation(JSON.stringify(personal)), program), personal);
  const withWorker: CanvasPresentation = { mode: "tiled", root: initialTileLayout(["app:items/main", "@coordinator", "app:worker/main"]) };
  assert.equal(currentCanvasOverride(personal, withWorker), null);
  assert.equal(currentCanvasOverride({ mode: personal.mode, root: personal.root }, withWorker), null);
  const resized: CanvasPresentation = { ...withWorker, programBasis: canvasProgramBasis(withWorker), root: { entity: "@coordinator" } };
  assert.equal(currentCanvasOverride(resized, withWorker), resized);
  assert.equal(currentCanvasOverride(resized, program), null);
});

const browserTest = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000 };

async function openLayoutFixture(context: TestContext) {
  const directory = await mkdtemp("/private/tmp/ragents-canvas-program-layout-");
  const source = fileURLToPath(new URL("../../../plugins/ragents.orchestration/web/", import.meta.url));
  await build({
    stdin: { contents: `
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { TiledCanvas } from './TiledCanvas';
import { canvasPresentationStorageKey, saveCanvasPresentation, useCanvasPresentation } from './tiled-view-settings';
import ${JSON.stringify(hostStylesheet)};
const runId='layout-regression';
const initial={mode:'tiled',root:{direction:'horizontal',weights:[1,1],children:[{entity:'app:items/main'},{entity:'@coordinator'}]}};
const worker={mode:'tiled',root:{direction:'horizontal',weights:[1,1],children:[{entity:'app:items/main'},{direction:'vertical',weights:[2,1],children:[{entity:'@coordinator'},{entity:'app:worker/main'}]}]}};
const runView=(layout)=>({pluginStates:[{pluginId:'ragents.orchestration',scope:{kind:'run'},state:{nodes:[],shapes:[],lines:[],...layout}}]});
const items=[{entity:'app:items/main',title:'Item auswählen',content:'Itemliste'}, {entity:'@coordinator',title:'Koordinator',content:'Auftrag klären'}, {entity:'app:worker/main',title:'Implementierer',content:'Implementierung läuft'}];
function App(){
  const [view,setView]=useState();
  const {presentation,personalLayout,programBasis}=useCanvasPresentation(runId,view);
  useEffect(()=>{setView(runView(JSON.parse(sessionStorage.getItem('program-layout')||JSON.stringify(initial))));},[]);
  window.layoutFixture={
    storageKey:canvasPresentationStorageKey(runId),
    updateUnrelated:()=>flushSync(()=>setView(previous=>structuredClone(previous))),
    startWorker:()=>{sessionStorage.setItem('program-layout',JSON.stringify(worker));flushSync(()=>setView(runView(worker)));},
  };
  if(!view)return <p>Lädt</p>;
  return <><output id="personal">{personalLayout?'Persönliche Anordnung':'Programmanordnung'}</output>
    <TiledCanvas root={presentation.root} items={items} canArrange={true}
      onChange={root=>saveCanvasPresentation(runId,{mode:presentation.mode,root,programBasis})}/></>;
}
createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: source, loader: "tsx" },
    outfile: `${directory}/fixture.js`, bundle: true, platform: "browser", format: "iife", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' }, plugins: [tailwindPlugin([source])],
  });
  const server = createServer(async (request, response) => {
    if (request.url === "/fixture.js" || request.url === "/fixture.css") {
      response.setHeader("Content-Type", request.url.endsWith("js") ? "text/javascript" : "text/css");
      response.end(await readFile(`${directory}${request.url}`));
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;font:16px system-ui}#root{height:900px;width:1600px;display:flex;flex-direction:column}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH, headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}`);
  return { page, errors, directory };
}

test("a running canvas adds a program worker despite a persisted personal resize without resetting the layout manually", browserTest, async (context) => {
  const { page, errors, directory } = await openLayoutFixture(context);
  const workerTile = page.locator('[data-tile-entity="app:worker/main"]');
  await page.getByRole("separator").waitFor();
  assert.equal(await page.locator("[data-tile-entity]").count(), 2);
  assert.equal(await workerTile.count(), 0);
  await page.getByRole("separator").press("ArrowRight");
  await page.getByText("Persönliche Anordnung", { exact: true }).waitFor();
  const personal = await page.evaluate(() => localStorage.getItem((window as any).layoutFixture.storageKey));
  assert.ok(personal);
  assert.ok(JSON.parse(personal).programBasis);
  assert.equal(await page.getByRole("separator").getAttribute("aria-valuenow"), "52");
  await page.evaluate(() => (window as any).layoutFixture.updateUnrelated());
  assert.equal(await page.evaluate(() => localStorage.getItem((window as any).layoutFixture.storageKey)), personal);
  assert.equal(await page.getByRole("separator").getAttribute("aria-valuenow"), "52");
  await page.reload();
  await page.getByText("Persönliche Anordnung", { exact: true }).waitFor();
  assert.equal(await page.getByRole("separator").getAttribute("aria-valuenow"), "52");

  await page.evaluate(() => (window as any).layoutFixture.startWorker());
  assert.equal(await workerTile.isVisible(), true, "The new worker is visible in the same rendered program update");
  assert.equal(await workerTile.getByText("Implementierung läuft", { exact: true }).isVisible(), true);
  await page.getByText("Programmanordnung", { exact: true }).waitFor();
  await page.waitForFunction(() => localStorage.getItem((window as any).layoutFixture.storageKey) === "null");
  assert.equal(await page.locator("[data-tile-entity]").count(), 3);
  await page.screenshot({ path: `${directory}/worker-visible.png` });
  await page.reload();
  await workerTile.waitFor();
  assert.equal(await page.locator("#personal").innerText(), "Programmanordnung");

  await page.evaluate((stored) => localStorage.setItem((window as any).layoutFixture.storageKey, stored), personal);
  await page.reload();
  await workerTile.waitFor();
  await page.waitForFunction(() => localStorage.getItem((window as any).layoutFixture.storageKey) === "null");
  assert.equal(await page.locator("#personal").innerText(), "Programmanordnung");
  assert.deepEqual(errors, []);
});

test("a program refresh during a divider drag keeps the pointer resize alive", browserTest, async (context) => {
  const { page, errors } = await openLayoutFixture(context);
  const separator = page.getByRole("separator");
  await separator.waitFor();
  const box = (await separator.boundingBox())!;
  const y = box.y + box.height / 2;
  const valueBecomes = (expected: string) => page.waitForFunction((value) =>
    document.querySelector('[role="separator"]')?.getAttribute("aria-valuenow") === value, expected, { timeout: 2_000 });
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, y, { steps: 4 });
  await valueBecomes("60");
  await page.evaluate(() => (window as any).layoutFixture.updateUnrelated());
  await page.mouse.move(box.x + 320, y, { steps: 4 });
  await valueBecomes("70");
  await page.mouse.up();
  await page.getByText("Persönliche Anordnung", { exact: true }).waitFor();
  assert.equal(await separator.getAttribute("aria-valuenow"), "70");
  const stored = await page.evaluate(() => localStorage.getItem((window as any).layoutFixture.storageKey));
  assert.deepEqual(JSON.parse(stored!).root.weights.map((weight: number) => Math.round(weight * 100)), [70, 30]);
  assert.deepEqual(errors, []);
});
