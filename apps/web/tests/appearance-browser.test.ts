import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type Locator, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";

async function fixtureBrowser(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "ragents-appearance-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("appearance-fixture.tsx", import.meta.url))], bundle: true,
    platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    plugins: [tailwindPlugin([`${root}apps/web/src`])], logLevel: "silent" });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  return { directory, page: await browser.newPage({ viewport: { width: 1200, height: 1000 } }) };
}

test("the palette, color scheme, corners, inline code and table spacing switch live from Settings and the header, and survive a reload", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 90_000,
}, async (context) => {
  const { directory, page } = await fixtureBrowser(context);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = pathToFileURL(join(directory, "index.html")).href;
  await page.goto(fixture);
  const documentData = () => page.evaluate(() => ({ ...document.documentElement.dataset }));
  const style = (selector: string, property: string) => page.locator(selector).evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
  const pressed = (name: string, scope: Page | Locator = page) => scope.getByRole("button", { name, exact: true }).first().getAttribute("aria-pressed");

  await page.getByRole("radio", { name: /Schichtwerk/ }).first().waitFor();
  assert.deepEqual(await documentData(), { theme: "dark", palette: "schichtwerk", codeStyle: "tint", corners: "round", density: "comfortable" });
  const comfortable = (await page.locator("#cell").boundingBox())!.height;
  assert.match(await style("#inline", "box-shadow"), /^rgba\(0, 0, 0, 0\) 0px 0px 0px 1px inset$/, "tinted inline code has no edge");

  await page.getByRole("radio", { name: /Midnight/ }).first().click();
  await page.getByRole("button", { name: "Tight", exact: true }).first().click();
  await page.getByRole("button", { name: "Outlined", exact: true }).first().click();
  await page.getByRole("button", { name: "Spacious", exact: true }).first().click();
  await page.getByRole("button", { name: "Light", exact: true }).first().click();
  assert.deepEqual(await documentData(), { theme: "light", palette: "midnight", codeStyle: "outlined", corners: "tight", density: "spacious" });
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--radius")), "0.375rem");
  assert.doesNotMatch(await style("#inline", "box-shadow"), /^rgba\(0, 0, 0, 0\)/, "outlined inline code draws an edge");
  assert.ok((await page.locator("#cell").boundingBox())!.height > comfortable, "spacious rows are taller");
  assert.equal(await pressed("Tight"), "true");

  await page.reload();
  await page.getByRole("radio", { name: /Midnight/ }).first().waitFor();
  assert.deepEqual(await documentData(), { theme: "light", palette: "midnight", codeStyle: "outlined", corners: "tight", density: "spacious" }, "the browser keeps the choices");

  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const quick = page.getByRole("dialog", { name: "Appearance" });
  await quick.waitFor();
  await quick.getByRole("radio", { name: "Black" }).click();
  await quick.getByRole("button", { name: "Round", exact: true }).click();
  await quick.getByRole("button", { name: "Dark", exact: true }).click();
  assert.deepEqual(await documentData(), { theme: "dark", palette: "black", codeStyle: "outlined", corners: "round", density: "spacious" }, "the header switch changes the same stores");
  assert.equal(await pressed("Round", quick), "true");
  assert.equal(await pressed("Round"), "true", "Settings follows the header switch");
  assert.deepEqual(errors, []);
});

test("in a VS Code webview the panel takes the settings from its host, follows its messages without echo, and reports every change", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 90_000,
}, async (context) => {
  const { directory, page } = await fixtureBrowser(context);
  await writeFile(join(directory, "shell.html"), `<!doctype html><html><body style="margin:0"><iframe id="panel" style="width:1200px;height:1000px;border:0" src="index.html?host=vscode&theme=light&scheme=auto&palette=midnight&corners=tight"></iframe>
    <script>window.received = []; addEventListener("message", (event) => received.push(event.data));</script></body></html>`);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(join(directory, "shell.html")).href);
  const panel = page.frameLocator("#panel");
  const data = () => panel.locator("html").evaluate((element) => ({ ...element.dataset }));
  const received = () => page.evaluate(() => (window as unknown as { received: unknown[] }).received);
  await panel.getByRole("radio", { name: /Midnight/ }).first().waitFor();
  assert.deepEqual(await data(), { theme: "light", palette: "midnight", codeStyle: "tint", corners: "tight", density: "comfortable" }, "the address of the frame sets the look before the first paint");
  assert.equal(await panel.getByRole("button", { name: "System", exact: true }).first().getAttribute("aria-pressed"), "true", "auto is System in the panel");
  assert.deepEqual(await received(), [], "what the host sets is not reported back");

  await panel.getByRole("button", { name: "Appearance", exact: true }).click();
  const quick = panel.getByRole("dialog", { name: "Appearance" });
  await quick.getByRole("radio", { name: "Black" }).click();
  await quick.getByRole("button", { name: "Dark", exact: true }).click();
  await quick.getByRole("button", { name: "Spacious", exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { received: unknown[] }).received.length >= 3);
  assert.deepEqual(await received(), [
    { type: "appearanceChanged", palette: "black" },
    { type: "appearanceChanged", scheme: "dark" },
    { type: "appearanceChanged", density: "spacious" },
  ]);

  await page.evaluate(() => (document.getElementById("panel") as HTMLIFrameElement).contentWindow!.postMessage(
    { type: "appearance", scheme: "auto", theme: "dark", palette: "graphite", codeStyle: "outlined", corners: "round", density: "comfortable" }, "*"));
  await panel.locator("html[data-palette=graphite]").waitFor({ state: "attached" });
  assert.deepEqual(await data(), { theme: "dark", palette: "graphite", codeStyle: "outlined", corners: "round", density: "comfortable" });
  assert.equal(await quick.getByRole("button", { name: "System", exact: true }).getAttribute("aria-pressed"), "true", "the panel shows the setting, not the resolved scheme");
  await page.waitForTimeout(150);
  assert.equal((await received()).length, 3, "following the host sends nothing back");

  await page.evaluate(() => (document.getElementById("panel") as HTMLIFrameElement).contentWindow!.postMessage({ type: "appearance", scheme: "auto", theme: "light", palette: "graphite", codeStyle: "outlined", corners: "round", density: "comfortable" }, "*"));
  await panel.locator("html[data-theme=light]").waitFor({ state: "attached" });
  await page.waitForTimeout(150);
  assert.equal((await received()).length, 3, "a change of the editor's color theme under auto is not a change of the setting");
  assert.deepEqual(errors, []);
});
