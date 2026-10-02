import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";

const options = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000 };
const home = new URL("../../docs/homepage/", import.meta.url);

async function withHomepage(width: number, height: number, check: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://homepage.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname.slice(1) || "index.html";
      try {
        const contentType = pathname.endsWith(".html") ? "text/html" : pathname.endsWith(".css") ? "text/css" : pathname.endsWith(".js") ? "text/javascript" : pathname.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
        await route.fulfill({ body: await readFile(fileURLToPath(new URL(pathname, home))), contentType });
      } catch { await route.fulfill({ status: 404, body: "Not found" }); }
    });
    // Keep canvas readbacks on one rasterizer; Chrome may otherwise switch GPU/CPU mid-test.
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: any, options: any) {
        return (getContext as any).call(this, kind, kind === "2d" ? { ...options, willReadFrequently: true } : options);
      } as typeof getContext;
    });
    await page.goto("http://homepage.test/");
    await page.locator('[data-chapters-list] button').first().waitFor({ state: "attached" });
    await check(page);
    assert.deepEqual(errors, [], "Scrolling and changing chapters must not throw.");
  } finally { await browser.close(); }
}

async function scroll(page: Page, y: number) {
  await page.evaluate(y => scrollTo(0, y), y);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function picture(page: Page, mobile = false) {
  return page.evaluate(mobile => {
    const scope = mobile ? document.querySelector('[data-story] [data-chapter="ui"]')! : document;
    const note = scope.querySelector(mobile ? '.note' : '[data-note]')!;
    const canvases = [...scope.querySelectorAll<HTMLCanvasElement>(mobile ? 'canvas' : 'canvas.panel')].filter(canvas => getComputedStyle(canvas).visibility !== "hidden").map(canvas => {
      const image = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (const byte of image) hash = Math.imul(hash ^ byte, 16777619);
      const style = getComputedStyle(canvas);
      return { hash: hash >>> 0, opacity: style.opacity, filter: style.filter };
    });
    const bounds = note.getBoundingClientRect();
    return { scroll: scrollY, note: { text: note.textContent, opacity: getComputedStyle(note).opacity, x: bounds.x, y: bounds.y }, canvases };
  }, mobile);
}

async function miniApps(page: Page) {
  await page.locator('[data-mode="pause"]').click();
  await page.getByRole("button", { name: "Mini-apps", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(100);
  return page.evaluate(() => scrollY);
}

test("homepage desktop notes and scene pixels follow scroll and stay still while paused", options, async () => {
  await withHomepage(1440, 1000, async page => {
    const start = await miniApps(page);
    await scroll(page, start + 600);
    const stopped = await picture(page);
    await page.waitForTimeout(1200);
    assert.deepEqual(await picture(page), stopped, "A partially drawn annotation must not finish itself while scroll is fixed.");
    await scroll(page, start + 900);
    const before = await picture(page);
    await scroll(page, start + 1500);
    await scroll(page, start + 900);
    assert.deepEqual(await picture(page), before, "Returning across the chapter boundary restores the same scene, note, and arrow pixels.");
    await scroll(page, start + 600);
    assert.deepEqual(await picture(page), stopped, "Returning to a partially drawn annotation restores it exactly.");
  });
});

test("homepage arrowhead grows with scroll and manual scrolling pauses playback until Play", options, async () => {
  await withHomepage(1440, 1000, async page => {
    const start = await miniApps(page);
    await page.evaluate(() => {
      const probe = { paths: [] as { moves: number[][]; lines: number[][] }[] };
      (window as any).__arrowProbe = probe;
      const proto = CanvasRenderingContext2D.prototype;
      const begin = proto.beginPath, move = proto.moveTo, line = proto.lineTo, stroke = proto.stroke, clear = proto.clearRect;
      proto.clearRect = function (...args) { if (this.canvas.classList.contains("wire")) probe.paths = []; return clear.apply(this, args); };
      proto.beginPath = function () { if (this.canvas.classList.contains("wire")) (this as any).__probePath = { moves: [], lines: [] }; return begin.call(this); };
      proto.moveTo = function (x, y) { if (this.canvas.classList.contains("wire")) (this as any).__probePath.moves.push([x, y]); return move.call(this, x, y); };
      proto.lineTo = function (x, y) { if (this.canvas.classList.contains("wire")) (this as any).__probePath.lines.push([x, y]); return line.call(this, x, y); };
      proto.stroke = function (...args: any[]) { if (this.canvas.classList.contains("wire")) probe.paths.push((this as any).__probePath); return (stroke as any).apply(this, args); };
    });
    const sizes: number[] = [];
    for (let offset = 600; offset <= 820; offset += 10) {
      await scroll(page, start + offset);
      sizes.push(await page.evaluate(() => {
        const path = (window as any).__arrowProbe.paths.find((path: any) => path.moves.length === 2 && path.lines.length === 2);
        return path ? Math.hypot(path.moves[0][0] - path.lines[0][0], path.moves[0][1] - path.lines[0][1]) : 0;
      }));
    }
    assert.ok(sizes.some(size => size > 0 && size < 11.9), `An intermediate arrowhead must appear: ${sizes}`);
    assert.ok(sizes.some(size => size > 11.9), `The arrowhead must finish as scrolling advances: ${sizes}`);
    for (let index = 1; index < sizes.length; index++) assert.ok(sizes[index] >= sizes[index - 1] - 1e-6, "Arrowhead growth must follow forward scroll.");

    await page.locator('[data-mode="play"]').click();
    const playingAt = await page.evaluate(() => scrollY);
    await page.waitForFunction(y => scrollY > y, playingAt);
    await page.mouse.wheel(0, 100);
    await page.waitForFunction(() => document.querySelector('[data-mode="pause"]')?.getAttribute("aria-pressed") === "true");
    await page.waitForTimeout(200);
    const paused = await picture(page);
    await page.waitForTimeout(1200);
    assert.deepEqual(await picture(page), paused, "Manual scrolling must keep playback paused after the old idle timeout.");
    await page.locator('[data-mode="play"]').click();
    await page.waitForFunction(y => scrollY > y, paused.scroll);
    assert.equal(await page.locator('[data-mode="play"]').getAttribute("aria-pressed"), "true");
  });
});

test("homepage mobile notes and scene pixels depend only on scroll position", options, async () => {
  await withHomepage(390, 844, async page => {
    await page.evaluate(() => document.fonts.ready);
    const { start, span } = await page.evaluate(() => {
      const section = document.querySelector('[data-story] [data-chapter="ui"]')!;
      const run = section.querySelector<HTMLElement>('.run')!;
      return { start: run.getBoundingClientRect().top + scrollY - section.querySelector<HTMLElement>('.pin')!.offsetHeight - document.querySelector<HTMLElement>('.top')!.offsetHeight, span: run.offsetHeight };
    });
    await scroll(page, start + span * .23);
    await page.waitForTimeout(1200);
    await scroll(page, start + span * .255);
    const stopped = await picture(page, true);
    await page.waitForTimeout(1200);
    assert.deepEqual(await picture(page, true), stopped, "The mobile annotation and canvas must stay still at a fixed scroll point.");
    await scroll(page, start + span * .35);
    await scroll(page, start + span * .255);
    assert.deepEqual(await picture(page, true), stopped, "Reverse scrolling restores the same mobile scene and note.");
  });
});
