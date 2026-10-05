import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";

const landscape = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600" viewBox="0 0 2400 1600"><rect width="2400" height="1600" fill="#e8eef4"/><circle cx="1800" cy="360" r="140" fill="#e9b84f"/><path d="M0 1300 650 350 1300 1200 1800 700 2400 1300V1600H0Z" fill="#697e8f"/><path d="M0 1450 800 800 1600 1450 2150 1000 2400 1400V1600H0Z" fill="#365c67"/><text x="100" y="150" font-family="sans-serif" font-size="64" fill="#253d48">Landscape study</text></svg>`;

test("shared image previews open a modal, zoom at the pointer, pan, trap focus and close", { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 90_000 }, async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-image-viewer-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("image-viewer-fixture.tsx", import.meta.url))], outfile: path.join(directory, "fixture.js"), bundle: true, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}plugins/ragents.documents/web`])], logLevel: "silent" });
  const server = createServer(async (request, response) => {
    if (request.url === "/landscape.svg") { response.setHeader("Content-Type", "image/svg+xml"); response.end(landscape); return; }
    if (request.url === "/fixture.js" || request.url === "/fixture.css") {
      response.setHeader("Content-Type", request.url.endsWith(".js") ? "text/javascript" : "text/css");
      response.end(await readFile(path.join(directory, request.url)));
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = `http://127.0.0.1:${address.port}`;
  const shots = process.env.RAGENTS_IMAGE_SCREENSHOTS ?? path.join(tmpdir(), "ragents-browser-shots");
  await mkdir(shots, { recursive: true });
  for (const theme of ["light", "dark"]) {
    await page.goto(`${origin}/?theme=${theme}`);
    const trigger = page.getByRole("region", { name: "Preview" }).getByRole("button", { name: "Open image landscape.svg" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "landscape.svg" });
    await dialog.waitFor();
    const canvas = dialog.getByLabel("Image canvas");
    await page.waitForFunction(() => {
      const scale = Number(document.querySelector('[aria-label="Image canvas"]')?.getAttribute("data-scale"));
      return scale > 0.1 && scale < 1;
    });
    assert.equal(await page.getByRole("button", { name: "Close image viewer" }).evaluate((element) => element === document.activeElement), true);
    await page.screenshot({ path: path.join(shots, `image-viewer-${theme}.png`) });
    await dialog.getByRole("button", { name: "Show at 100 %" }).click();
    assert.equal(await canvas.getAttribute("data-scale"), "1");
    await page.keyboard.press("+");
    assert.equal(await canvas.getAttribute("data-scale"), "1.25");
    await page.keyboard.press("-");
    assert.equal(await canvas.getAttribute("data-scale"), "1");
    const bounds = await canvas.boundingBox();
    assert.ok(bounds);
    const pointer = { x: bounds.x + bounds.width * 0.6, y: bounds.y + bounds.height * 0.6 };
    const pixelsAtPointer = () => dialog.getByRole("img").evaluate((element, point) => {
      const image = element as HTMLImageElement;
      const rect = image.getBoundingClientRect();
      return { x: (point.x - rect.left) * image.naturalWidth / rect.width, y: (point.y - rect.top) * image.naturalHeight / rect.height };
    }, pointer);
    const before = await pixelsAtPointer();
    await page.mouse.move(pointer.x, pointer.y);
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(() => Number(document.querySelector('[aria-label="Image canvas"]')?.getAttribute("data-scale")) > 1);
    const after = await pixelsAtPointer();
    const diagnostic = await dialog.getByRole("img").evaluate((element) => ({ style: element.getAttribute("style"), transform: getComputedStyle(element).transform }));
    assert.ok(Math.abs(before.x - after.x) < 1 && Math.abs(before.y - after.y) < 1, `Pointer pixels: ${JSON.stringify({ before, after, diagnostic })}`);
    const image = dialog.getByRole("img");
    const start = await image.boundingBox();
    await page.mouse.down();
    await page.mouse.move(pointer.x + 80, pointer.y + 50, { steps: 5 });
    await page.mouse.up();
    const panned = await image.boundingBox();
    assert.ok(start && panned && Math.abs(panned.x - start.x - 80) < 1 && Math.abs(panned.y - start.y - 50) < 1);
    assert.equal(await dialog.count(), 1);
    if (theme === "dark") await page.screenshot({ path: path.join(shots, "image-viewer-zoomed.png") });
    const pinchStart = Number(await canvas.getAttribute("data-scale"));
    await canvas.dispatchEvent("wheel", { deltaY: -10, ctrlKey: true, clientX: pointer.x, clientY: pointer.y });
    await page.waitForFunction((previous) => Number(document.querySelector('[aria-label="Image canvas"]')?.getAttribute("data-scale")) > previous, pinchStart);
    await page.keyboard.press("0");
    assert.equal(await canvas.getAttribute("data-mode"), "fit");
    await image.dblclick();
    assert.equal(await canvas.getAttribute("data-scale"), "1");
    await image.dblclick();
    assert.equal(await canvas.getAttribute("data-mode"), "fit");
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press("Tab");
      await page.waitForFunction(() => document.querySelector('[data-slot="image-viewer"]')?.contains(document.activeElement), undefined, { timeout: 1000 });
    }
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await dialog.waitFor();
    await page.mouse.click(1, 1);
    await dialog.waitFor({ state: "detached" });
    await trigger.click();
    await dialog.waitFor();
    await page.getByRole("button", { name: "Close image viewer" }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  }
  await page.getByRole("button", { name: "Open image document.svg" }).click();
  await page.getByRole("dialog", { name: "document.svg" }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: "Large", exact: true }).count(), 0);
  for (const section of ["Markdown", "Chat attachments"]) {
    const trigger = page.getByRole("region", { name: section }).getByRole("button", { name: /^Open image/ });
    await trigger.focus();
    await page.keyboard.press("Space");
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  }
  assert.deepEqual(errors, []);
});
