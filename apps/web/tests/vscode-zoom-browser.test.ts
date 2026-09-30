import assert from "node:assert/strict";
import test from "node:test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { frameHtml, panelHtml } from "../../vscode/src/webview-html";
import { tailwindPlugin } from "./tailwind-plugin";

const state = { theme: "dark" as const, page: "start" as const, connections: [], profileSuggestions: [] };

test("VS Code hull zoom fills the viewport once across nested frames and changes without reloading", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const panel = await build({
    stdin: { contents: `import { createRoot } from "react-dom/client"; import { PanelPage } from "./apps/web/src/panel/PanelPage"; import "./apps/web/src/ui/tailwind.css";
      createRoot(document.getElementById("root")).render(<PanelPage state={${JSON.stringify(state)}} send={()=>{}}/>);`, resolveDir: root, loader: "tsx" },
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", write: false, outfile: "/tmp/zoom-panel.js",
    plugins: [tailwindPlugin([`${root}apps/web/src`])], logLevel: "silent",
  });
  const hull = "http://127.0.0.1:47930";
  const server = "http://127.0.0.1:47931";
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const context = await browser.newContext({ viewport: { width: 600, height: 800 } });
    await context.addInitScript('window.acquireVsCodeApi = () => ({ postMessage() {} }); if (location.pathname !== "/host") { window.parent = window; window.top = window; }');
    await context.route("http://127.0.0.1:*/**", (route) => {
      const url = new URL(route.request().url());
      let body: string;
      if (url.pathname === "/host") body = '<!doctype html><html><head><style>html,body{height:100%;margin:0}#host{display:block;width:100%;height:100%;border:0}</style></head><body><iframe id="host" src="' + (url.searchParams.has("local") ? "/local" : "/frame") + '"></iframe></body></html>';
      else if (url.pathname === "/panel.js") body = panel.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
      else if (url.pathname === "/panel.css") body = panel.outputFiles.find((file) => file.path.endsWith(".css"))!.text;
      else if (url.origin === hull && url.pathname === "/local") body = panelHtml({ nonce: "zoom", title: "Zoom", state, scriptUri: `${hull}/panel.js`, styleUri: `${hull}/panel.css`, cspSource: hull, zoom: 90 });
      else if (url.origin === hull) body = frameHtml({ serverUrl: server, query: { host: "vscode" }, nonce: "zoom", title: "Zoom", zoom: 90 });
      else body = '<!doctype html><html><head><style>html,body{width:100%;height:100%;margin:0}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}#marker{width:100px;height:30px;background:red}#target{position:absolute;right:0;bottom:0;width:100px;height:40px}</style></head><body>' + (url.pathname === "/run-panel.html" ? '<iframe src="/nested" sandbox="allow-scripts"></iframe>' : '<input id="draft"><div id="marker"></div><button id="target" onclick="this.textContent=\'clicked\'">Click</button>') + '</body></html>';
      return route.fulfill({ contentType: url.pathname.endsWith(".js") ? "text/javascript" : url.pathname.endsWith(".css") ? "text/css" : "text/html", body });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mkdir("/tmp/ragents-zoom-review", { recursive: true });
    await page.goto(`${hull}/host`);
    const hosted = page.frameLocator("#host");
    const leaf = hosted.frameLocator("#frame").frameLocator("iframe");
    await leaf.locator("#draft").fill("Draft stays");
    const frames = page.frames();
    for (const zoom of [90, 100, 125]) {
      await page.evaluate((zoom) => (document.getElementById("host") as HTMLIFrameElement).contentWindow!.postMessage({ type: "ragents.zoom", zoom }, location.origin), zoom);
      await page.waitForFunction((expected) => getComputedStyle((document.getElementById("host") as HTMLIFrameElement).contentDocument!.body).zoom === String(expected / 100), zoom);
      const bounds = await hosted.locator("#frame").boundingBox();
      assert.ok(bounds && Math.abs(bounds.width - 600) <= 1 && Math.abs(bounds.height - 800) <= 1, JSON.stringify({ zoom, bounds, body: await page.evaluate(() => ({ width: document.body.clientWidth, height: document.body.clientHeight, zoom: getComputedStyle(document.body).zoom })) }));
      await leaf.locator("body").evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const screenshot = await page.screenshot({ path: `/tmp/ragents-zoom-review/frames-${zoom}.png` });
      const markerWidth = await page.evaluate(async (encoded) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob());
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        let right = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 0) right = Math.max(right, (i / 4) % canvas.width + 1);
        return right;
      }, screenshot.toString("base64"));
      assert.ok(Math.abs(markerWidth - zoom) <= 1, `Nested frame scales once at ${zoom}: ${markerWidth}px`);
      await page.mouse.click(600 - zoom / 2, 800 - zoom / 5);
      await leaf.locator("#target").filter({ hasText: /^clicked$/ }).waitFor();
      assert.equal(await leaf.locator("#target").textContent(), "clicked");
      await leaf.locator("#target").evaluate((element) => { element.textContent = "Click"; });
      await page.mouse.click(30, 8);
      await page.keyboard.press("End");
      await page.keyboard.type("!");
      assert.equal(await leaf.locator("#draft").inputValue(), `Draft stays${"!".repeat([90, 100, 125].indexOf(zoom) + 1)}`);
      assert.deepEqual(page.frames(), frames, "Changing zoom retains every frame.");
    }
    await page.goto(`${hull}/host?local`);
    await hosted.locator("main").waitFor();
    await hosted.locator("main").evaluate((element) => {
      const input = document.createElement("input");
      input.id = "draft";
      input.value = "Local draft";
      element.prepend(input);
    });
    for (const zoom of [90, 100, 125]) {
      await page.evaluate((zoom) => (document.getElementById("host") as HTMLIFrameElement).contentWindow!.postMessage({ type: "ragents.zoom", zoom }, location.origin), zoom);
      await page.waitForFunction((expected) => getComputedStyle((document.getElementById("host") as HTMLIFrameElement).contentDocument!.body).zoom === String(expected / 100), zoom);
      const bounds = await hosted.locator("main").boundingBox();
      assert.ok(bounds && Math.abs(bounds.width - 600) <= 1 && Math.abs(bounds.height - 800) <= 1, JSON.stringify(bounds));
      assert.equal(await hosted.locator("#draft").inputValue(), "Local draft");
      await hosted.locator("#draft").click();
      assert.equal(await hosted.locator("#draft").evaluate((element) => element === document.activeElement), true);
      await page.screenshot({ path: `/tmp/ragents-zoom-review/local-${zoom}.png` });
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
