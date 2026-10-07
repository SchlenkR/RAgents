import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium, webkit, type Locator } from "playwright-core";
import { frameHtml, frameContentSecurityPolicy } from "../../../plugins/ragents.actor-programs/server/routes";
import { FRAME_BODY_CLASS, FRAME_DOCUMENT_CLASS, FRAME_ROOT_CLASS } from "../src/actor-programs/client-ui/frame-layout";
import { buildTailwind } from "../../server/src/plugin-support/actor-programs/tailwind";
import { frameStylesheet, tailwindPlugin } from "./tailwind-plugin";

const fixture = `
import { createRoot } from "react-dom/client";
import { DockToolsContext, DockWorkspace } from "./apps/web/src/run-panel/DockWorkspace";
import { ActorViewFrame } from "./plugins/ragents.actor-programs/web/ActorViewFrame";
import { initializePalette } from "./apps/web/src/palette";
import { initializeTheme } from "./apps/web/src/theme";
import { initializeZoom } from "./apps/web/src/zoom";
import "./apps/web/src/ui/tailwind.css";
initializeTheme(window);
initializePalette(window);
const zoom = initializeZoom(window);
window.frameZoomFixture = { setZoom: value => zoom.setZoom(value) };
const session = { session: { id: "zoom-test", title: "Zoom test", updatedAt: 0 }, connected: true,
  runView: {}, messages: [], pluginEvents: [], running: false, send: async () => {}, start: async () => {} };
const app = { id: "notes", actorId: "worker", actorHandle: "worker", title: "Notes", revision: "installed",
  actions: [{ id: "echo", label: "Echo", confirmation: null }], state: { version: 1, revision: 1, values: { phase: "ready" } }, invocations: [] };
const invoke = async (appId, revision, actionId, requestId, input) => ({ id: requestId, appId, revision, actionId,
  requestId, actorId: "worker", actorHandle: "worker", status: "succeeded", result: input, output: [], createdAt: "2026-01-01" });
const apps = [{ runId: "zoom-test", definition: { id: "notes", title: "Notes" }, Element: () =>
  <ActorViewFrame app={app} api={{ frameUrl: () => "/frame" }} invoke={invoke} runId="zoom-test" session={session} /> }];
const navigation = { activeTabId: "", openTab: () => {}, revealEntity: () => false, selectionFor: () => undefined };
createRoot(document.getElementById("root")).render(<DockToolsContext.Provider value={{ tabs: [], pendingTabIds: [] }}>
  <DockWorkspace apps={apps} chat={<textarea aria-label="Chat draft" />} navigation={navigation} session={session} />
</DockToolsContext.Provider>);
`;

test("installed mini-apps keep native scrolling and their connected document through zoom, resize and Activity", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-mini-app-zoom-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ stdin: { contents: fixture, resolveDir: root, sourcefile: "fixture.tsx", loader: "tsx" },
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}plugins/ragents.actor-programs/web`])], logLevel: "silent" });
  const script = await readFile(join(directory, "fixture.js"));
  const styles = await readFile(join(directory, "fixture.css"));
  const frameStyles = await buildTailwind([`${root}apps/web/src/actor-programs/client-ui`], frameStylesheet);
  const nonce = "zoom-fixture";
  const html = frameHtml({
    html: `<!doctype html><html class="${FRAME_DOCUMENT_CLASS}"><head><meta charset="utf-8"></head><body class="${FRAME_BODY_CLASS}"><div id="root" class="${FRAME_ROOT_CLASS}"></div></body></html>`,
    styles: `${frameStyles}\n#neutral-content{height:4000px;width:2000px}\n::-webkit-scrollbar{width:16px;height:16px}::-webkit-scrollbar-track{background:#555}::-webkit-scrollbar-thumb{background:#aaa;border-radius:8px}`,
    clientJavaScript: `
      window.documentIdentity = Math.random();
      document.getElementById("root").innerHTML = '<input aria-label="Frame draft"><button>Bridge echo</button><p role="status"></p><div id="neutral-content">Long neutral content</div>';
      document.querySelector("button").onclick = async () => document.querySelector('[role="status"]').textContent = await globalThis.__ragentsAppContext.capabilities.call("echo", "Bridge connected");
    `,
    platformVersion: 2,
  } as Parameters<typeof frameHtml>[0], nonce);
  let loads = 0;
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(script); }
    else if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(styles); }
    else if (request.url?.startsWith("/frame")) { loads++; response.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": frameContentSecurityPolicy(nonce) }); response.end(html); }
    else { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html><head><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root" class="flex"></div><script src="/fixture.js"></script></body></html>'); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  for (const engine of ["chromium", "webkit"] as const) {
    const browser = await (engine === "chromium" ? chromium.launch({ headless: true, ignoreDefaultArgs: ["--hide-scrollbars"], executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }) : webkit.launch({ headless: true }));
    try {
      const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
      page.setDefaultTimeout(10_000);
      await page.addInitScript(() => { if (window.top === window) localStorage.setItem("ragents.zoom", "150"); });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.getByRole("tab", { name: "Notes", exact: true }).click();
      const iframe = page.locator("iframe");
      const frame = await (await iframe.elementHandle())!.contentFrame();
      assert.ok(frame);
      await frame.getByRole("textbox", { name: "Frame draft" }).fill("Keep this draft");
      const identity = await frame.evaluate(() => Reflect.get(window, "documentIdentity"));
      const initialLoads = loads;
      const box = async (locator: Locator) => { const value = await locator.boundingBox(); assert.ok(value); return value; };
      const assertSizing = async () => {
        await page.waitForFunction(() => {
          const frame = document.querySelector("iframe")!.getBoundingClientRect();
          return frame.x >= 0 && frame.y >= 0 && frame.right <= innerWidth + 1 && frame.bottom <= innerHeight + 1;
        });
        await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await frame.waitForFunction(() => Math.abs(document.getElementById("root")!.offsetHeight - innerHeight) <= 1 && Math.abs(document.getElementById("root")!.offsetWidth - innerWidth) <= 1);
        const geometry = await frame.locator("#root").evaluate((element) => ({ height: element.clientHeight, width: element.offsetWidth, viewportHeight: innerHeight, viewportWidth: innerWidth, scrollHeight: element.scrollHeight }));
        assert.ok(geometry.scrollHeight > geometry.height * 2, `${engine}: content keeps its own scroll area`);
        if (engine === "webkit") {
          const host = await box(iframe);
          const inner = await box(frame.locator("#root"));
          assert.ok(Math.abs(inner.width - host.width) <= 2 && Math.abs(inner.height - host.height) <= 2, `${engine}: the frame root stays inside its viewport ${JSON.stringify({ host, inner, geometry })}`);
        }
      };
      await assertSizing();
      for (const zoom of [80, 100, 110, 150] as const) {
        await page.evaluate((value) => Reflect.get(window, "frameZoomFixture").setZoom(value), zoom);
        await assertSizing();
        await frame.locator("#root").evaluate((element) => { element.scrollTop = 0; element.scrollLeft = 0; });
        await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const viewport = await box(iframe);
        await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const x = viewport.x + viewport.width - 8 * zoom / 100;
        const y = viewport.y + 25 * zoom / 100;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y + 150 * zoom / 100, { steps: 20 });
        await page.mouse.up();
        const dragged = await frame.locator("#root").evaluate((element) => element.scrollTop);
        context.diagnostic(`${engine} at ${zoom}%: native scrollbar thumb drag scrollTop=${dragged}`);
        if (engine === "chromium") assert.ok(dragged > 0, "the exposed native scrollbar thumb can be dragged");
        if (dragged === 0) {
          context.diagnostic(JSON.stringify({ viewport, geometry: await frame.locator("#root").evaluate(element => ({ rect: element.getBoundingClientRect().toJSON(), width: element.offsetWidth, clientWidth: element.clientWidth, height: element.offsetHeight, clientHeight: element.clientHeight, innerWidth, innerHeight, documentWidth: document.documentElement.style.width, documentHeight: document.documentElement.style.height })) }));
          await page.screenshot({ path: join(tmpdir(), `ragents-mini-app-scroll-${engine}-${zoom}.png`) });
        }
        await frame.locator("#root").evaluate((element) => { element.scrollTop = 0; element.scrollLeft = 0; });
      }
      const scrollViewport = await box(iframe);
      await page.mouse.move(scrollViewport.x + scrollViewport.width / 2, scrollViewport.y + scrollViewport.height / 2);
      await page.mouse.wheel(0, 300);
      await frame.waitForFunction(() => document.getElementById("root")!.scrollTop > 0);
      const divider = await box(page.getByRole("separator", { name: "Resize areas" }));
      await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
      await page.mouse.down();
      await page.mouse.move(divider.x + divider.width / 2 - 100, divider.y + divider.height / 2, { steps: 6 });
      await page.mouse.up();
      await assertSizing();
      const notes = await box(page.getByRole("tab", { name: "Notes", exact: true }));
      const chatGroup = page.locator("[data-dock-group]").filter({ has: page.getByRole("tab", { name: "Chat", exact: true }) });
      const chat = await box(chatGroup);
      await page.mouse.move(notes.x + notes.width / 2, notes.y + notes.height / 2);
      await page.mouse.down();
      await page.mouse.move(chat.x + chat.width / 2, chat.y + chat.height / 2 + 50, { steps: 8 });
      const guide = await box(page.locator('[data-dock-guide="group-center"]'));
      await page.mouse.move(guide.x + guide.width / 2, guide.y + guide.height / 2, { steps: 4 });
      await page.locator("[data-dock-preview]").waitFor();
      await page.mouse.up();
      await page.waitForFunction(() => document.querySelectorAll("[data-dock-group]").length === 1);
      await page.getByRole("tab", { name: "Chat", exact: true }).click();
      await iframe.waitFor({ state: "hidden" });
      await page.evaluate(() => Reflect.get(window, "frameZoomFixture").setZoom(110));
      await page.getByRole("tab", { name: "Notes", exact: true }).click();
      await iframe.waitFor({ state: "visible" });
      await assertSizing();
      assert.equal(await frame.getByRole("textbox", { name: "Frame draft" }).inputValue(), "Keep this draft");
      assert.equal(await frame.evaluate(() => Reflect.get(window, "documentIdentity")), identity);
      assert.equal(loads, initialLoads, "zoom, resizing, docking and hiding keep the same frame document");
      await frame.getByRole("button", { name: "Bridge echo", exact: true }).click();
      await frame.getByRole("status").filter({ hasText: "Bridge connected" }).waitFor();
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  }
});
