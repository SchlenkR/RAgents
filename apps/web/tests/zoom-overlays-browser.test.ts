import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium, webkit, type Locator } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";

test("zoomed settings dialogs and header dropdowns fit the viewport and remain anchored in both browsers", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 90_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-zoom-overlays-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("zoom-fixture.tsx", import.meta.url))], bundle: true,
    platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    plugins: [tailwindPlugin([`${root}apps/web/src`])], logLevel: "silent" });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  for (const engine of ["chromium", "webkit"] as const) {
    const browser = await (engine === "chromium" ? chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }) : webkit.launch({ headless: true }));
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      page.setDefaultTimeout(5000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${pathToFileURL(join(directory, "index.html")).href}?page=overlays`);
      const box = async (locator: Locator) => { await locator.waitFor(); await locator.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished))); const value = await locator.boundingBox(); assert.ok(value); return value; };
      const fits = async (locator: Locator) => {
        const rectangle = await box(locator);
        assert.ok(rectangle.x >= -1 && rectangle.y >= -1 && rectangle.x + rectangle.width <= 1401 && rectangle.y + rectangle.height <= 901, `${engine}: ${JSON.stringify(rectangle)} must fit the viewport`);
        return rectangle;
      };
      for (const zoom of [80, 100, 110, 150] as const) {
        await page.evaluate((value) => Reflect.get(window, "overlayZoom")(value), zoom);
        const rootBox = await box(page.locator("#root"));
        assert.ok(Math.abs(rootBox.width - 1400) <= 1 && Math.abs(rootBox.height - 900) <= 1);
        const trigger = page.getByRole("button", { name: "Open records", exact: true });
        const anchor = await box(trigger);
        await trigger.click();
        const popup = await fits(page.getByRole("dialog", { name: "Records", exact: true }));
        assert.ok(Math.abs(popup.y - anchor.y - anchor.height - 8 * zoom / 100) <= 2, `${engine}: dropdown stays at its header`);
        await page.getByRole("button", { name: "Close records", exact: true }).click();
        await page.getByRole("dialog", { name: "Records", exact: true }).waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "Open settings", exact: true }).click();
        await fits(page.getByRole("dialog", { name: "Settings", exact: true }));
        await page.getByRole("dialog", { name: "Settings", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
        await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor({ state: "hidden" });
      }
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  }
});
