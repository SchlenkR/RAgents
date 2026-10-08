import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { build } from "esbuild";
import { chromium, type Frame } from "playwright-core";
import { frameHtml, frameContentSecurityPolicy } from "../../../plugins/ragents.actor-programs/server/routes";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./density-frame-fixture";

const browserOnly = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000 };
const origin = "http://127.0.0.1:57123";

const openShell = async (context: TestContext, path: string) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-density-frames-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await writeFile(join(directory, "main-entry.ts"), `import ${JSON.stringify(`${root}apps/web/src/ui/tailwind.css`)}; import ${JSON.stringify(`${root}apps/web/src/main.tsx`)};`);
  await build({ entryPoints: { main: join(directory, "main-entry.ts"), panel: `${root}apps/web/src/panel.tsx`, frame: fileURLToPath(new URL("density-frame-fixture.tsx", import.meta.url)) },
    bundle: true, platform: "browser", format: "esm", jsx: "automatic", outdir: directory,
    tsconfig: `${root}apps/web/tsconfig.json`, define: { "process.env.NODE_ENV": '"production"' },
    plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}apps/web/tests`, `${root}plugins/ragents.actor-programs/web`])], logLevel: "silent" });
  const files = new Map<string, Buffer>();
  for (const name of ["main", "panel", "frame"]) {
    for (const extension of ["js", "css"]) files.set(`/${name}.${extension}`, await readFile(join(directory, `${name}.${extension}`)));
  }
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Reflect.set(window, "documentIdentity", Math.random());
    if (window.top === window) {
      localStorage.setItem("ragents.theme", "dark");
      localStorage.setItem("ragents.density", "compact");
    }
  });
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    const file = files.get(url.pathname);
    if (file) { await route.fulfill({ body: file, contentType: url.pathname.endsWith(".js") ? "text/javascript" : "text/css" }); return; }
    if (url.pathname === "/api/access") { await route.fulfill({ json: { enabled: true, user: null } }); return; }
    let html: string;
    if (url.pathname === "/shell") {
      html = `<!doctype html><html><body style="margin:0"><iframe title="RAgents host" src="${path.replaceAll("&", "&amp;")}" style="border:0;width:100vw;height:100vh"></iframe><script>window.hostMessages=[];window.addEventListener("message", event => { if(event.source===document.querySelector("iframe").contentWindow) window.hostMessages.push(event.data); });</script></body></html>`;
    } else {
      const entry = url.pathname === "/management.html" ? "panel" : url.pathname === "/mini-app-host.html" ? "frame" : "main";
      const state = entry === "panel" ? '<script type="application/json" id="state">{"theme":"dark","looks":{"density":"compact"},"page":"connections","connections":[],"profileSuggestions":[]}</script><script>window.acquireVsCodeApi=()=>({postMessage:message=>parent.postMessage(message,"*")});</script>' : "";
      html = `<!doctype html><html><head><link rel="icon" href="data:,"><link rel="stylesheet" href="/${entry}.css"></head><body style="margin:0"><div id="root"></div>${state}<script type="module" src="/${entry}.js"></script></body></html>`;
    }
    await route.fulfill({ body: html, contentType: "text/html" });
  });
  const open = async () => {
    await page.goto(`${origin}/shell`, { waitUntil: "domcontentloaded" });
    const frame = await (await page.getByTitle("RAgents host").elementHandle())!.contentFrame();
    assert.ok(frame);
    return frame;
  };
  return { page, errors, open };
};

const waitDensity = (frame: Frame, density: string) => frame.waitForFunction((value) => document.documentElement.dataset.density === value, density);
const appearance = (density: string) => ({ type: "appearance", scheme: "dark", theme: "dark", palette: "schichtwerk", codeStyle: "tint", corners: "round", density });
const settle = (frame: Frame) => frame.evaluate(async () => {
  for (let index = 0; index < 4; index++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
});

for (const layout of ["panel", "app"] as const) {
  test(`the real ${layout} entry applies frame table spacing and accepts later parent commands without reloading`, browserOnly, async (context) => {
    const query = `layout=${layout}&host=vscode&density=spacious&theme=dark${layout === "app" ? "&run=density-run&element=notes--main" : ""}`;
    const { page, errors, open } = await openShell(context, `/run-panel.html?${query}`);
    const frame = await open();
    await frame.getByRole("button", { name: "Sign in with VS Code", exact: true }).waitFor();
    await waitDensity(frame, "spacious");
    const identity = await frame.evaluate(() => Reflect.get(window, "documentIdentity"));
    await frame.evaluate((data) => window.dispatchEvent(new MessageEvent("message", { source: window, data })), appearance("compact"));
    await settle(frame);
    assert.equal(await frame.evaluate(() => document.documentElement.dataset.density), "spacious", "only the parent may change the framed entry's setting");
    for (const density of ["compact", "comfortable", "spacious"]) {
      await page.evaluate((data) => document.querySelector("iframe")!.contentWindow!.postMessage(data, location.origin), appearance(density));
      await waitDensity(frame, density);
      assert.equal(await frame.evaluate(() => localStorage.getItem("ragents.density")), density);
      assert.equal(await frame.evaluate(() => document.documentElement.dataset.theme), "dark");
      assert.equal(await frame.evaluate(() => Reflect.get(window, "documentIdentity")), identity);
    }
    assert.deepEqual(errors, []);
  });
}

test("the real local connection page takes table spacing from initial and updated PanelState", browserOnly, async (context) => {
  const { page, errors, open } = await openShell(context, "/management.html");
  const frame = await open();
  await frame.locator("main[data-page=connections]").waitFor();
  await waitDensity(frame, "compact");
  const identity = await frame.evaluate(() => Reflect.get(window, "documentIdentity"));
  for (const density of ["spacious", "comfortable", "compact"]) {
    await page.evaluate((value) => document.querySelector("iframe")!.contentWindow!.postMessage({ type: "ragents.panel.state", state: {
      theme: "dark", looks: { density: value }, page: "connections", connections: [], profileSuggestions: [],
    } }, location.origin), density);
    await waitDensity(frame, density);
    assert.equal(await frame.evaluate(() => localStorage.getItem("ragents.density")), density);
    assert.equal(await frame.evaluate(() => document.documentElement.dataset.theme), "dark");
    assert.equal(await frame.evaluate(() => Reflect.get(window, "documentIdentity")), identity);
  }
  assert.deepEqual(errors, []);
});

test("a mini-app receives the latest table spacing at connection, updates live and keeps its hidden document", browserOnly, async (context) => {
  const { page, errors, open } = await openShell(context, "/mini-app-host.html");
  const nonce = "density-fixture";
  const html = frameHtml({ html: '<!doctype html><html><head></head><body><input aria-label="Frame draft"></body></html>', styles: "",
    clientJavaScript: 'window.documentIdentity=Math.random(); window.initialDensity=document.documentElement.dataset.density;', platformVersion: 2 } as Parameters<typeof frameHtml>[0], nonce);
  let release: () => void = () => { throw new Error("The app has not been requested."); };
  let loads = 0;
  let markRequested: () => void = () => {};
  const requested = new Promise<void>((resolve) => { markRequested = resolve; });
  await page.route(`${origin}/app.html`, async (route) => {
    loads++;
    await new Promise<void>((continueLoading) => { release = continueLoading; markRequested(); });
    await route.fulfill({ body: html, contentType: "text/html", headers: { "Content-Security-Policy": frameContentSecurityPolicy(nonce) } });
  });
  const host = await open();
  const spacing = host.getByRole("group", { name: "Table spacing", exact: true });
  await spacing.waitFor().catch((cause: unknown) => { throw new Error(`${String(cause)}\nBrowser errors: ${errors.join("; ")}\n${JSON.stringify(page.frames().map((frame) => frame.url()))}`); });
  await requested;
  assert.equal(await spacing.getByRole("button", { name: "Compact", exact: true }).getAttribute("aria-pressed"), "true");
  await spacing.getByRole("button", { name: "Spacious", exact: true }).click();
  release();
  const iframe = host.locator("iframe");
  const app = await (await iframe.elementHandle())!.contentFrame();
  assert.ok(app);
  await app.waitForFunction(() => Reflect.get(window, "initialDensity") === "spacious");
  await app.getByRole("textbox", { name: "Frame draft" }).fill("Keep these notes");
  const identity = await app.evaluate(() => Reflect.get(window, "documentIdentity"));
  for (const [density, label] of [["compact", "Compact"], ["comfortable", "Comfortable"], ["spacious", "Spacious"]]) {
    await spacing.getByRole("button", { name: label, exact: true }).click();
    await waitDensity(app, density);
    assert.equal(await app.evaluate(() => document.documentElement.dataset.theme), "dark");
  }
  await host.evaluate(() => window.densityFrameFixture.setActive(false));
  await iframe.waitFor({ state: "hidden" });
  await spacing.getByRole("button", { name: "Compact", exact: true }).click();
  await host.evaluate(() => window.densityFrameFixture.setActive(true));
  await iframe.waitFor({ state: "visible" });
  await waitDensity(app, "compact");
  assert.equal(await app.getByRole("textbox", { name: "Frame draft" }).inputValue(), "Keep these notes");
  assert.equal(await app.evaluate(() => Reflect.get(window, "documentIdentity")), identity);
  assert.equal(loads, 1, "spacing and Activity changes retain the connected app document");
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, "hostMessages").filter((message: { type: string }) => message.type === "appearanceChanged")),
    ["spacious", "compact", "comfortable", "spacious", "compact"].map((density) => ({ type: "appearanceChanged", density })));
  assert.deepEqual(errors, []);
});
