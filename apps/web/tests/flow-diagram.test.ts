import assert from "node:assert/strict";
import test from "node:test";
import { tailwindPlugin } from "./tailwind-plugin";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { FlowDiagram } from "../../../apps/web/src/actor-programs/client-ui/index";
import { starLayout, type CardNode, type Link } from "../../../apps/web/src/actor-programs/client-ui/FlowDiagram";

const card = (id: string, height = 160): CardNode => ({ id, type: "card", position: { x: 0, y: 0 }, width: 320, height,
  data: { id, label: id, labelLines: id, itemLines: [], direction: "right", detailLevel: "summary" } });
const link = (source: string, target: string, status?: Link["status"]): Link => ({ id: `${source}>${target}`, source, target, ...(status ? { status } : {}) });
const box = (node: CardNode) => ({ left: node.position.x, top: node.position.y, right: node.position.x + node.width!, bottom: node.position.y + node.height! });
const numbers = (path: string) => path.match(/-?[\d.]+/g)!.map(Number);

test("star layout centers the first node, splits the rest into two columns and keeps cards apart", () => {
  for (const count of [1, 2, 3, 5, 9, 12]) {
    const cards = [card("hub", 220), ...Array.from({ length: count }, (_, index) => card(`n${index}`, 150 + index * 10))];
    const { nodes, bounds } = starLayout(cards, cards.slice(1).flatMap((spoke) => [link(spoke.id, "hub"), link("hub", spoke.id)]));
    const hub = nodes[0]!;
    assert.deepEqual(hub.position, { x: -160, y: -110 });
    const right = nodes.slice(1).filter((node) => node.position.x > 0);
    const left = nodes.slice(1).filter((node) => node.position.x + node.width! < 0);
    assert.equal(right.length, Math.ceil(count / 2));
    assert.equal(left.length, Math.floor(count / 2));
    for (const [index, node] of nodes.entries()) {
      for (const other of nodes.slice(index + 1)) {
        const a = box(node);
        const b = box(other);
        assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `${count} spokes: ${node.id} overlaps ${other.id}`);
      }
      assert.ok(box(node).left >= bounds.x && box(node).right <= bounds.x + bounds.width && box(node).top >= bounds.y && box(node).bottom <= bounds.y + bounds.height);
    }
  }
});

test("star layout draws both directions between hub and spoke side by side and keeps edge status", () => {
  const cards = [card("hub"), card("a"), card("b")];
  const { edges } = starLayout(cards, [link("a", "hub", "done"), link("hub", "a", "active"), link("b", "hub"), link("a", "b", "blocked")]);
  const [inbound, outbound, single, cross] = edges.map((edge) => ({ ...edge.data!, points: numbers(edge.data!.path) }));
  assert.equal(inbound!.status, "done");
  assert.equal(outbound!.status, "active");
  assert.equal(inbound!.points[6], 160, "The inbound arrow ends at the hub's right side");
  assert.equal(outbound!.points[0], 160, "The outbound arrow starts at the hub's right side");
  assert.equal(inbound!.points[0], outbound!.points[6], "Both directions meet the same spoke side");
  assert.equal(Math.abs(inbound!.points[1]! - outbound!.points[7]!), 16, "Opposite directions stay separated at the spoke");
  assert.equal(Math.abs(inbound!.points[7]! - outbound!.points[1]!), 16, "Opposite directions stay separated at the hub");
  assert.equal(single!.points[1], single!.points[7], "A lone edge runs through the middle of its spoke");
  assert.match(single!.path, /^M .* C /);
  assert.match(cross!.path, /^M .* L /);
  assert.equal(cross!.status, "blocked");
});

test("FlowDiagram is SSR-safe and rejects invalid graphs without stale content", () => {
  const html = renderToStaticMarkup(createElement(FlowDiagram, { nodes: [{id: "a", label: "A"}], edges: [], label: "Ablauf" }));
  assert.match(html, /aria-label="Ablauf"/);
  assert.match(html, /Diagramm wird geladen/);
  for (const props of [
    { nodes: [{ id: "a", label: "A" }, { id: "a", label: "B" }], edges: [] },
    { nodes: [{ id: "a", label: "A" }], edges: [{source:"a", target:"missing"}] },
    { nodes: [{ id: "", label: "A" }], edges: [] },
  ]) assert.match(renderToStaticMarkup(createElement(FlowDiagram, { ...props, label: "Fehler" })), /role="alert"/);
  assert.match(renderToStaticMarkup(createElement(FlowDiagram, { nodes: [], edges: [], label: "Leer" })), /Keine Knoten/);
});

test("FlowDiagram renders offline, routes edges and preserves layout and viewport on status updates", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  const directory = await mkdtemp("/private/tmp/ragents-flow-");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    stdin: { resolveDir: root, loader: "tsx", contents: `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { FlowDiagram } from "./apps/web/src/actor-programs/client-ui/index";
import "./apps/web/src/ui/frame.css";
import "./apps/web/src/actor-programs/client-ui/flow-diagram.css";
function App() {
  const [nodes, setNodes] = useState([{id:'a',label:'Auswahl',status:'pending'}, {id:'b',label:'Prüfen',detail:'Änderungen kontrollieren',status:'active'}]);
  const [visible, setVisible] = useState(true);
  const [fitWidth, setFitWidth] = useState(440);
  const [itemStatus, setItemStatus] = useState("active");
  const [summaryDetail, setSummaryDetail] = useState("Langer Bericht mit konkreten Befunden. ".repeat(40));
  const [summaryStatus, setSummaryStatus] = useState("active");
  const [summaryRunning, setSummaryRunning] = useState(true);
  window.diagramFixture = { setNodes, setVisible, setFitWidth, setItemStatus, setSummaryDetail, setSummaryStatus, setSummaryRunning };
  return <main style={{maxWidth:760,padding:12}}>{visible && <FlowDiagram detailLevel="full" nodes={nodes} edges={[{source:'a',target:'b',label:'Start'}]} label="Auftragsablauf" />}<FlowDiagram detailLevel="full" nodes={[{id:'a',label:'Kommunikation'}]} edges={[]} label="Parallel" /><div id="outer-scroll" style={{height:300,width:fitWidth,overflowY:'auto',overflowX:'hidden'}}><FlowDiagram detailLevel="full" viewport="fit-width" direction="down" label="Automatischer Ablauf" nodes={[0,1,2,3].map(i=>({id:String(i),label:'Phase '+i,items:[{label:'Reviewregel prüfen',status:itemStatus,detail:'Ergebnis der Regelprüfung'},{label:'Weitere Regel',status:'skipped'}]}))} edges={[...[0,1,2].map(i=>({source:String(i),target:String(i+1),label:'Weiter zur nächsten Phase'})),{source:'3',target:'1',label:'Korrektur und erneute Prüfung',kind:'return'}]} /></div><div id="star-box" style={{width:520,height:320}}><FlowDiagram layout="star" viewport="fit" label="Sternansicht" nodes={[{id:'hub',label:'main',status:'active',actions:[{id:'push',label:'Pushen',primary:true},{id:'builds',label:'Buildschritte',disabled:true}]},{id:'a',label:'Alpha',items:[{label:'Nach main: fertig',status:'done'}],actions:[{id:'push',label:'Pushen'}]},{id:'b',label:'Beta'},{id:'c',label:'Gamma'}]} edges={[{source:'a',target:'hub',status:'done'},{source:'hub',target:'a',status:'active'},{source:'b',target:'hub',status:'pending'},{source:'hub',target:'c',status:'blocked'}]} onAction={(node,action)=>{window.starActions=(window.starActions||[]).concat(node+':'+action);}} /></div><FlowDiagram label="Kompakte Regeln" viewport="fit-width" nodes={[{id:'summary',label:'Regelreview mit einer sehr langen Phasenüberschrift, die auf höchstens zwei Zeilen begrenzt bleiben soll',detail:summaryDetail,status:summaryStatus,running:summaryRunning,items:Array.from({length:8},(_,index)=>({label:'Regel '+index+': Diese ausführliche Regelbeschreibung darf nur eine sichtbare Zeile belegen',status:summaryStatus==='active'?['pending','done','active','blocked','skipped'][index%5]:summaryStatus,detail:summaryDetail}))}]} edges={[]} /></main>;
}
createRoot(document.getElementById('root')).render(<App />);` },
    outfile: `${directory}/fixture.js`, bundle: true, platform: "browser", format: "iife", jsx: "automatic", plugins: [tailwindPlugin([])], logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' }, minify: true,
  });
  const server = createServer(async (request, response) => {
    if (request.url === "/fixture.js" || request.url === "/fixture.css") {
      response.setHeader("Content-Type", request.url.endsWith("js") ? "text/javascript" : "text/css");
      response.end(await readFile(`${directory}${request.url}`));
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:; font-src 'self'");
    response.end('<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><link rel="icon" href="data:,"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const zoomExtension = process.env.RAGENTS_BROWSER_ZOOM_TESTS === "1";
  const extension = `${directory}/zoom-extension`;
  if (zoomExtension) {
    await mkdir(extension);
    await writeFile(`${extension}/manifest.json`, JSON.stringify({ manifest_version: 3, name: "Diagram zoom regression", version: "1.0", permissions: ["tabs"], background: {service_worker: "worker.js"} }));
    await writeFile(`${extension}/worker.js`, "chrome.runtime.onInstalled.addListener(() => {});");
  }
  const browser = zoomExtension ? await chromium.launchPersistentContext(`${directory}/profile`, {
    channel: "chromium", headless: true, viewport: {width: 820, height: 850},
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  }) : await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH, headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewportSize({ width: 820, height: 850 });
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (!request.url().startsWith(`http://127.0.0.1:${address.port}`)) externalRequests.push(request.url()); });
  await page.goto(`http://127.0.0.1:${address.port}`);
  const flow = page.getByRole("region", { name: "Auftragsablauf", exact: true });
  const parallel = page.getByRole("region", { name: "Parallel", exact: true });
  await flow.locator('[data-running]').nth(1).waitFor();
  await parallel.locator('[data-running]').waitFor();
  await flow.locator('.react-flow__edge-path').first().waitFor({ state: "attached" });
  assert.equal(await flow.locator('.react-flow__edge-path').count(), 1);
  assert.match(await flow.locator('.react-flow__edge-path').getAttribute('marker-end') ?? '', /url/);
  assert.equal(await flow.getByRole('button', {name: 'Zoom vergrößern'}).count(), 1);
  await page.waitForFunction(() => document.querySelector('[aria-label="Auftragsablauf"] .react-flow__viewport')!.getAttribute('style')!.includes('scale(0.8)'));
  assert.ok(await flow.locator('.react-flow__node').first().evaluate(element => Math.abs(element.getBoundingClientRect().width - (element as HTMLElement).offsetWidth * 0.8) < 0.01), 'Interactive cards initially display at 80 percent of natural width');
  await flow.getByRole('button', {name: 'Zoom vergrößern'}).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Auftragsablauf"] .react-flow__viewport')!.getAttribute('style')!.includes('scale(0.8)'));
  await flow.getByRole('button', {name: 'Ansicht zentrieren'}).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Auftragsablauf"] .react-flow__viewport')!.getAttribute('style')!.includes('scale(0.8)'));
  assert.ok(await flow.locator('.react-flow__node').first().evaluate(element => Math.abs(element.getBoundingClientRect().width - (element as HTMLElement).offsetWidth * 0.8) < 0.01), 'Centering restores cards to 80 percent of natural width');
  assert.match(await flow.locator('.react-flow__edge-path').getAttribute('d') ?? '', /^M .*L /);
  assert.equal(await flow.locator('[data-running]').first().evaluate(el => getComputedStyle(el).fontSize), '16px');
  const placement = () => flow.locator('.react-flow__node').evaluateAll(els => els.map(el => el.getAttribute('style')));
  const before = await placement();
  const viewport = await flow.locator('.react-flow__viewport').getAttribute('style');
  await page.evaluate(() => (window as any).diagramFixture.setNodes([{id:'a',label:'Auswahl',status:'done'}, {id:'b',label:'Prüfen',detail:'Änderungen kontrollieren',status:'blocked'}]));
  await flow.locator('[data-running][data-status="blocked"]').waitFor();
  assert.deepEqual(await placement(), before);
  assert.equal(await flow.locator('.react-flow__viewport').getAttribute('style'), viewport);
  await page.evaluate(() => (window as any).diagramFixture.setNodes([{id:'a',label:'Fertig',status:'done'}, {id:'b',label:'Ende',detail:'Ergebnis',status:'active'}]));
  await flow.getByRole('heading', {name:'Fertig', exact:true}).waitFor();
  assert.doesNotMatch(await flow.textContent() ?? '', /Auswahl/);
  await page.evaluate(() => (window as any).diagramFixture.setNodes([{id:'a',label:'Kaputt'}]));
  await flow.getByRole('alert').waitFor();
  assert.equal(await flow.locator('.react-flow').count(), 0);
  assert.equal(await parallel.locator('[data-running]').count(), 1);
  await page.evaluate(() => { (window as any).diagramFixture.setNodes([{id:'a',label:'Veraltet'}, {id:'b',label:'Ende'}]); });
  await page.evaluate(() => (window as any).diagramFixture.setVisible(false));
  await flow.waitFor({state:'detached'});
  await page.evaluate(() => { (window as any).diagramFixture.setNodes([{id:'a',label:'Aktuell'}, {id:'b',label:'Ende'}]); (window as any).diagramFixture.setVisible(true); });
  await flow.getByText('Aktuell', {exact:true}).waitFor();
  assert.doesNotMatch(await flow.textContent() ?? '', /Veraltet/);
  const fitted = page.getByRole('region', {name:'Automatischer Ablauf'});
  await fitted.locator('[data-running]').nth(3).waitFor();
  assert.equal(await fitted.locator('.react-flow__controls').count(), 0);
  const ordered = await fitted.locator('.react-flow__node').evaluateAll(elements => elements.map(element => ({id:element.getAttribute('data-id'), top:element.getBoundingClientRect().top})).sort((a,b)=>a.top-b.top).map(element=>element.id));
  assert.deepEqual(ordered, ['0','1','2','3'], 'Return edge leaves semantic forward phase order intact');
  const route = fitted.locator('.react-flow__edge').filter({hasText:'Korrektur und erneute Prüfung'});
  assert.match(await route.locator('.react-flow__edge-path').getAttribute('d') ?? '', /^M .*L .*L .*L /);
  assert.match(await route.locator('.react-flow__edge-path').getAttribute('marker-end') ?? '', /url/);
  assert.match(await route.locator('g[data-kind="return"]').getAttribute('transform') ?? '', /rotate\(-90\)/);
  assert.equal(await fitted.getByText('Übersprungen', {exact:true}).count(), 4);
  const fitMetrics = () => fitted.evaluate(element => ({width: element.clientWidth, height: element.clientHeight, cardWidth: element.querySelector(".react-flow__node")!.getBoundingClientRect().width, transform: element.querySelector('.react-flow__viewport')?.getAttribute('style')}));
  const wide = await fitMetrics();
  assert.ok(wide.height > 300, 'Graph supplies natural content height beyond outer scrolling area');
  await page.evaluate(() => (window as any).diagramFixture.setFitWidth(320));
  await page.waitForFunction(previous => document.querySelector('[aria-label="Automatischer Ablauf"]')!.clientHeight < previous, wide.height);
  const narrow = await fitMetrics();
  assert.ok(Math.abs(narrow.height / wide.height - narrow.cardWidth / wide.cardWidth) < 0.02, 'Natural graph height tracks available width');
  const bounds = await fitted.evaluate(element => {
    const parent = element.getBoundingClientRect();
    return [...element.querySelectorAll('.react-flow__node, .react-flow__edge-textwrapper, g[data-kind="return"]')].every(child => { const box = child.getBoundingClientRect(); return box.left >= parent.left && box.right <= parent.right && box.top >= parent.top && box.bottom <= parent.bottom; });
  });
  assert.ok(bounds, 'Node cards and edge labels remain inside fitted bounds');
  await page.evaluate(() => (window as any).diagramFixture.setItemStatus('done'));
  await fitted.getByText('Fertig', {exact:true}).first().waitFor();
  assert.deepEqual(await fitMetrics(), narrow, 'Item status updates preserve placement and fitted height');
  const outer = page.locator('#outer-scroll');
  await outer.scrollIntoViewIfNeeded();
  await outer.hover();
  await page.mouse.wheel(0, 220);
  await page.waitForFunction(() => document.getElementById('outer-scroll')!.scrollTop > 0);
  assert.equal((await fitMetrics()).transform, narrow.transform, 'Wheel scroll belongs to outer container, not graph zoom');
  assert.equal(await outer.evaluate(element => element.scrollWidth === element.clientWidth), true);
  const area = await outer.boundingBox();
  assert.ok(area);
  await page.mouse.move(area.x + 100, area.y + 100);
  await page.mouse.down();
  await page.mouse.move(area.x + 160, area.y + 150);
  await page.mouse.up();
  await page.mouse.dblclick(area.x + 100, area.y + 100);
  assert.equal((await fitMetrics()).transform, narrow.transform, 'Dragging and double clicking cannot move or zoom fitted graph');
  assert.equal(await fitted.locator('[data-running]').evaluateAll(elements => elements.every(element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth)), true, 'Measured card heights contain all structured points');
  await page.evaluate(() => (window as any).diagramFixture.setFitWidth(720));
  await page.waitForFunction(() => document.getElementById('outer-scroll')!.clientWidth === 720);
  await page.waitForFunction(() => document.querySelector('[aria-label="Automatischer Ablauf"] .react-flow__viewport')!.getAttribute('style')!.includes('scale(0.8)'));
  assert.ok(Math.abs((await fitMetrics()).cardWidth - 192) < 0.01, 'Wide containers display cards at 80 percent of natural width');
  const summary = page.getByRole('region', {name:'Kompakte Regeln'});
  await summary.locator('li').nth(7).waitFor();
  assert.equal(await summary.getByText(/Langer Bericht mit konkreten Befunden/).count(), 0, 'Summary omits detail paragraphs');
  assert.equal(await summary.getByText('Aktiv', {exact:true}).count(), 1, 'Summary keeps only the card badge, no separate status rows');
  const summaryGeometry = () => summary.evaluate(element => ({height:element.clientHeight, viewport:element.querySelector('.react-flow__viewport')!.getAttribute('style'), nodes:[...element.querySelectorAll('.react-flow__node')].map(node=>node.getAttribute('style'))}));
  const compact = await summaryGeometry();
  const title = summary.getByRole('heading');
  assert.ok((await title.textContent() ?? '').split('\n').length <= 2);
  assert.match(await title.getAttribute('title') ?? '', /höchstens zwei Zeilen begrenzt bleiben soll/);
  assert.match(await title.getAttribute('title') ?? '', /Langer Bericht mit konkreten Befunden/);
  const rows = summary.locator('li');
  assert.equal(await rows.count(), 8, 'Every review rule has its own row');
  assert.equal(await rows.evaluateAll(elements=>elements.every(element=>Math.abs(element.getBoundingClientRect().height - (12 + element.querySelector('span')!.textContent!.split('\n').length * 24) * 0.8) < 0.01)), true, 'Each row height matches all wrapped label lines at 100 percent scale');
  assert.equal(await rows.evaluateAll(elements=>elements.every(element=>element.textContent!.replace(/\s+/g,' ').includes('darf nur eine sichtbare Zeile belegen'))), true, 'Long rule labels remain complete instead of being truncated');
  assert.ok(await rows.first().evaluate(element=>element.getBoundingClientRect().height > 28), 'Long rules wrap to multiple lines');
  for (const [status,label] of Object.entries({pending:'Ausstehend',done:'Fertig',active:'Aktiv',blocked:'Blockiert',skipped:'Übersprungen'})) {
    const icon = rows.locator(`[role="img"][data-status="${status}"]`).first();
    assert.equal(await icon.getAttribute('aria-label'), label);
    assert.equal(await icon.getAttribute('role'), 'img');
    assert.ok(await icon.locator('path,circle').count() > 0);
  }
  assert.equal(await rows.locator('[data-status="pending"] circle').count(), 2);
  assert.match(await rows.locator('[data-status="done"] path').first().getAttribute('d') ?? '', /L8 14 L16 5/);
  assert.match(await rows.locator('[data-status="skipped"] path').getAttribute('d') ?? '', /M4 10 H16/);
  assert.notEqual(await summary.locator('[data-running]').evaluate(element=>getComputedStyle(element).animationName), 'none');
  await page.evaluate(() => (window as any).diagramFixture.setSummaryRunning(false));
  await summary.locator('[data-running="false"]').waitFor();
  assert.equal(await summary.locator('[data-running]').evaluate(element=>getComputedStyle(element).animationName), 'none');
  assert.equal(await rows.locator('[role="img"][data-status="active"]').first().evaluate(element=>getComputedStyle(element).animationName), 'none');
  assert.deepEqual(await summaryGeometry(), compact, 'Stopped activity leaves reported status and geometry intact');
  await page.evaluate(() => (window as any).diagramFixture.setSummaryRunning(true));
  await summary.locator('[data-running="true"]').waitFor();
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await summary.locator('[data-running]').evaluate(element=>getComputedStyle(element).animationName), 'none');
  assert.equal(await rows.locator('[role="img"][data-status="active"]').first().evaluate(element=>getComputedStyle(element).animationName), 'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert.match(await rows.first().getAttribute('title') ?? '', /darf nur eine sichtbare Zeile belegen/);
  assert.match(await rows.first().getAttribute('title') ?? '', /Langer Bericht mit konkreten Befunden/);
  await page.evaluate(() => { (window as any).diagramFixture.setSummaryStatus('done'); (window as any).diagramFixture.setSummaryDetail('Aktualisierter umfangreicher Bericht. '.repeat(400)); });
  await summary.locator('li [role="img"][aria-label="Fertig"]').nth(7).waitFor();
  assert.match(await rows.first().getAttribute('title') ?? '', /Aktualisierter umfangreicher Bericht/);
  assert.deepEqual(await summaryGeometry(), compact, 'Status changes and growing detail reports preserve compact geometry');
  assert.equal(await summary.locator('[data-running], li').evaluateAll(elements=>elements.every(element=>element.scrollWidth<=element.clientWidth && element.scrollHeight<=element.clientHeight+1)), true, 'Compact cards and individual rows do not overflow');
  if (zoomExtension) {
    await page.evaluate(() => { document.querySelector('main')!.style.maxWidth = 'none'; document.getElementById('outer-scroll')!.style.width = '100%'; });
    const workers = 'serviceWorkers' in browser ? browser.serviceWorkers() : [];
    const worker = workers[0] ?? await (browser as import("playwright-core").BrowserContext).waitForEvent('serviceworker');
    const url = page.url();
    const zoom = async (factor: number) => worker.evaluate(async ({url, factor}) => {
      const api = (globalThis as any).chrome;
      const tabs = await api.tabs.query({});
      const tab = tabs.find((tab: {url:string}) => tab.url === url);
      if (!tab) throw new Error('Testtab fehlt');
      await api.tabs.setZoom(tab.id, factor);
      return api.tabs.getZoom(tab.id);
    }, {url, factor});
    const baseline = await fitted.locator('.react-flow__node').first().evaluate(element => ({physicalWidth: element.getBoundingClientRect().width * window.devicePixelRatio, dpr: window.devicePixelRatio, innerWidth, containerWidth: document.getElementById("outer-scroll")!.clientWidth}));
    assert.equal(await zoom(0.8), 0.8);
    await page.waitForFunction(dpr => window.devicePixelRatio < dpr, baseline.dpr);
    const reduced = await fitted.locator('.react-flow__node').first().evaluate(element => ({physicalWidth: element.getBoundingClientRect().width * window.devicePixelRatio, dpr: window.devicePixelRatio, innerWidth, containerWidth: document.getElementById("outer-scroll")!.clientWidth}));
    assert.ok(reduced.innerWidth > baseline.innerWidth, 'Actual browser zoom changes layout viewport');
    assert.ok(reduced.containerWidth > baseline.containerWidth, 'Responsive container grows in CSS pixels when browser zoom decreases');
    assert.ok(reduced.physicalWidth < baseline.physicalWidth * 0.85, 'Browser minus visibly shrinks natural-sized diagram cards');
    assert.equal(await fitted.locator('.react-flow__controls').count(), 0);
    assert.equal(await outer.evaluate(element => element.scrollWidth === element.clientWidth), true);
    assert.equal(await zoom(1), 1);
    context.diagnostic(`Actual chrome.tabs.setZoom: ${JSON.stringify({baseline,reduced})}`);
  }
  await page.evaluate(() => (window as any).diagramFixture.setNodes([
    {id:'a',label:'Ausstehend',status:'pending'}, {id:'b',label:'In Arbeit',status:'active',running:false},
    {id:'c',label:'Erledigt',status:'done'}, {id:'d',label:'Blockiert',status:'blocked'},
  ]));
  await page.locator('[aria-label="Auftragsablauf"] [data-running][data-status="blocked"]').waitFor();
  const colors = await page.locator('[aria-label="Auftragsablauf"] [data-running]').evaluateAll(cards => cards.map(card => ({
    status:card.getAttribute('data-status'),color:getComputedStyle(card.querySelector('span')!).color,
    background:getComputedStyle(card.querySelector('span')!).backgroundColor,
    animation:getComputedStyle(card).animationName,
  })));
  assert.equal(new Set(colors.map(card=>card.color)).size,4,'Every phase status has its own badge color');
  assert.equal(new Set(colors.map(card=>card.background)).size,4,'Badge fills carry the same distinct status colors');
  assert.ok(colors.every(card=>card.animation==='none'),'Saved active status alone does not animate');
  const star = page.getByRole('region', {name:'Sternansicht'});
  await star.locator('[data-running]').nth(3).waitFor();
  await star.locator('.react-flow__edge-path').nth(3).waitFor({state:'attached'});
  assert.equal(await star.locator('.react-flow__controls').count(), 0);
  assert.equal(await star.evaluate(element => element.clientHeight), 320, 'Fitted diagram takes the height of its box');
  const starBoxes = await star.evaluate(element => {
    const parent = element.getBoundingClientRect();
    const nodes = [...element.querySelectorAll('.react-flow__node')].map(node => ({id: node.getAttribute('data-id'), box: node.getBoundingClientRect()}));
    return { parent: {left: parent.left, right: parent.right, top: parent.top, bottom: parent.bottom, center: (parent.left + parent.right) / 2, middle: (parent.top + parent.bottom) / 2}, nodes: nodes.map(({id, box}) => ({id, left: box.left, right: box.right, top: box.top, bottom: box.bottom})) };
  });
  assert.ok(starBoxes.nodes.every(node => node.left >= starBoxes.parent.left - .5 && node.right <= starBoxes.parent.right + .5 && node.top >= starBoxes.parent.top - .5 && node.bottom <= starBoxes.parent.bottom + .5), 'Fitted star keeps every card inside the box on both axes');
  const hub = starBoxes.nodes.find(node => node.id === 'hub')!;
  assert.ok(Math.abs((hub.left + hub.right) / 2 - starBoxes.parent.center) < 1 && Math.abs((hub.top + hub.bottom) / 2 - starBoxes.parent.middle) < 1, 'The hub sits in the middle of the box');
  assert.ok(starBoxes.nodes.filter(node => node.id !== 'hub').some(node => node.left > hub.right) && starBoxes.nodes.some(node => node.right < hub.left), 'Spokes surround the hub on both sides');
  for (const [status, count] of [['done', 1], ['active', 1], ['pending', 1], ['blocked', 1]] as const) assert.equal(await star.locator(`.react-flow__edge-path[data-status="${status}"]`).count(), count);
  const strokes = await star.locator('.react-flow__edge-path').evaluateAll(paths => paths.map(path => ({stroke: getComputedStyle(path).stroke, dash: getComputedStyle(path).strokeDasharray})));
  assert.equal(new Set(strokes.map(path => path.stroke)).size, 4, 'Every edge status has its own color');
  assert.equal(strokes.filter(path => path.dash !== 'none').length, 2, 'Pending and active edges are dashed');
  assert.equal(await star.locator('.react-flow__edge-path').evaluateAll(paths => paths.every(path => /url/.test(path.getAttribute('marker-end') ?? ''))), true);
  await star.locator('.react-flow__node[data-id="hub"]').getByRole('button', {name:'Pushen'}).click();
  await star.locator('.react-flow__node[data-id="a"]').getByRole('button', {name:'Pushen'}).click();
  assert.ok(await star.locator('.react-flow__node[data-id="hub"]').getByRole('button', {name:'Buildschritte'}).isDisabled());
  assert.deepEqual(await page.evaluate(() => (window as any).starActions), ['hub:push', 'a:push']);
  assert.equal(await star.locator('[data-running]').evaluateAll(elements => elements.every(element => element.scrollHeight <= element.clientHeight + 1)), true, 'Card heights include the action row');
  await mkdir('/private/tmp/ragents-flow-status',{recursive:true});
  await star.screenshot({path:'/private/tmp/ragents-flow-status/star-fit.png'});
  await page.locator('[aria-label="Auftragsablauf"]').screenshot({path:'/private/tmp/ragents-flow-status/status-colors.png'});
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
});
