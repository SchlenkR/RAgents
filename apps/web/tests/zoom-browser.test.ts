import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type Locator } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";

const percent = 130;
const zoom = percent / 100;

test("the browser zoom scales the whole page while popups stay at their anchor and docking follows the pointer", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 90_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-zoom-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("zoom-fixture.tsx", import.meta.url))], bundle: true,
    platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    plugins: [tailwindPlugin([`${root}apps/web/src`])], logLevel: "silent" });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(`localStorage.setItem("ragents.zoom", "${percent}")`);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = pathToFileURL(join(directory, "index.html")).href;
  await page.goto(fixture);
  const box = async (locator: Locator) => { const rect = await locator.boundingBox(); assert.ok(rect); return rect; };
  const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) <= 1.5, `${label}: ${actual} instead of ${expected}`);
  const settled = async (locator: Locator) => {
    await locator.waitFor();
    await locator.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    return box(locator);
  };
  const tab = (name: string) => page.getByRole("tab", { name, exact: true });
  const groups = page.locator("[data-dock-group]");
  await tab("Chat").waitFor();

  assert.equal(await page.evaluate(() => document.documentElement.style.zoom), String(zoom));
  const rootBox = await box(page.locator("#root"));
  near(rootBox.width, 1400, "the zoomed page fills the window width");
  near(rootBox.height, 900, "the zoomed page fills the window height");

  const popoverTrigger = await box(page.getByRole("button", { name: "Open popover" }));
  await page.getByRole("button", { name: "Open popover" }).click();
  const popover = await settled(page.getByRole("dialog"));
  near(popover.y - popoverTrigger.y - popoverTrigger.height, 8 * zoom, "the popover keeps its zoomed distance below the trigger");
  near(popover.x + popover.width / 2, popoverTrigger.x + popoverTrigger.width / 2, "the popover is centered on the trigger");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });

  const menuTrigger = await box(page.getByRole("button", { name: "Open menu" }));
  await page.getByRole("button", { name: "Open menu" }).click();
  const menu = await settled(page.getByRole("menu"));
  near(menu.y - menuTrigger.y - menuTrigger.height, 4 * zoom, "the menu keeps its zoomed distance below the trigger");
  near(menu.x, menuTrigger.x, "the menu starts at the trigger");
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "hidden" });

  await page.waitForFunction(() => document.querySelectorAll("[data-dock-group]").length === 2);
  const chatGroup = groups.filter({ has: tab("Chat") });
  const divider = await box(page.getByRole("separator", { name: "Resize areas" }));
  const before = await box(chatGroup);
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
  await page.mouse.down();
  await page.mouse.move(divider.x + divider.width / 2 - 130, divider.y + divider.height / 2, { steps: 6 });
  await page.mouse.up();
  near((await box(chatGroup)).width, before.width - 130, "the divider follows the pointer");

  const notes = await box(tab("Notes"));
  const chat = await box(chatGroup);
  await page.mouse.move(notes.x + notes.width / 2, notes.y + notes.height / 2);
  await page.mouse.down();
  await page.mouse.move(chat.x + chat.width / 2, chat.y + chat.height / 2 + 100, { steps: 6 });
  const center = await box(page.locator('[data-dock-guide="group-center"]'));
  await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2, { steps: 3 });
  await page.locator("[data-dock-preview]").waitFor();
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll("[data-dock-group]").length === 1);
  assert.equal(await groups.first().getByRole("tab").count(), 2, "dropping on the guide under the pointer merges both areas");

  await page.goto(`${fixture}?page=settings`);
  const steps = page.getByRole("group", { name: "Zoom" });
  await steps.waitFor();
  assert.deepEqual(await steps.getByRole("button").allTextContents(), ["80%", "90%", "100%", "110%", "120%", "130%", "150%"]);
  assert.equal(await steps.getByRole("button", { name: "130%" }).getAttribute("aria-pressed"), "true");
  const shots = join(tmpdir(), "ragents-browser-shots");
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: join(shots, "zoom-settings-130.png") });
  await steps.getByRole("button", { name: "100%" }).click();
  assert.deepEqual(await page.evaluate(() => [document.documentElement.style.zoom, localStorage.getItem("ragents.zoom")]), ["", "100"], "100 percent clears the zoom and is saved");
  await steps.getByRole("button", { name: "150%" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.style.zoom), "1.5");
  await page.goto(`${fixture}?page=vscode-settings`);
  await page.getByText("In VS Code, the setting ragents.zoom scales the interface.").waitFor();
  assert.equal(await page.getByRole("group", { name: "Zoom" }).count(), 0, "VS Code keeps its own zoom setting");
  assert.deepEqual(errors, []);
});
