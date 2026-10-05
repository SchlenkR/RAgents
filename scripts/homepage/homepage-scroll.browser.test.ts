import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";

const options = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000 };
const home = new URL("../../docs/homepage/", import.meta.url);

async function withHomepage(width: number, height: number, check: (page: Page) => Promise<void>, reducedMotion: "reduce" | "no-preference" = "no-preference") {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://homepage.test/**", async route => {
      const pathname = new URL(route.request().url()).pathname.slice(1) || "index.html";
      try {
        const contentType = pathname.endsWith(".html") ? "text/html" : pathname.endsWith(".css") ? "text/css" : pathname.endsWith(".js") ? "text/javascript" : pathname.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
        await route.fulfill({ body: await readFile(fileURLToPath(new URL(pathname, home))), contentType });
      } catch { await route.fulfill({ status: 404, body: "Not found" }); }
    });
    // Keep canvas readbacks on one rasterizer during comparisons.
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: any, options: any) {
        return (getContext as any).call(this, kind, kind === "2d" ? { ...options, willReadFrequently: true } : options);
      } as typeof getContext;
    });
    await page.goto("http://homepage.test/");
    await page.locator('[data-chapters-list] button').first().waitFor({ state: "attached" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      document.documentElement.style.scrollBehavior = "auto";
    });
    await check(page);
    assert.deepEqual(errors, [], "Scrolling and changing chapters must not throw.");
  } finally { await browser.close(); }
}

async function scroll(page: Page, y: number) {
  await page.evaluate(y => scrollTo(0, y), y);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function center(page: Page, chapter: string) {
  const y = await page.evaluate(chapter => {
    const article = document.querySelector(`[data-story] article[data-chapter="${chapter}"]`)!;
    const bounds = article.getBoundingClientRect();
    const top = document.querySelector('.top')!.getBoundingClientRect().bottom;
    return scrollY + bounds.top + bounds.height / 2 - (top + innerHeight) / 2;
  }, chapter);
  await scroll(page, y);
  return page.evaluate(() => scrollY);
}

async function textPosition(page: Page, chapter: string) {
  return page.evaluate(chapter => {
    const article = document.querySelector(`[data-story] article[data-chapter="${chapter}"]`)!;
    const heading = article.querySelector('h2')!;
    return {
      scroll: scrollY,
      top: heading.getBoundingClientRect().top,
      text: heading.textContent,
      styles: [article, ...article.querySelectorAll('h2, p, ul')].map(node => {
        const style = getComputedStyle(node);
        return { opacity: style.opacity, transform: style.transform, visibility: style.visibility, clipPath: style.clipPath };
      }),
    };
  }, chapter);
}

async function scene(page: Page, chapter = "ui") {
  return page.evaluate(chapter => {
    const state = (window as any).__state();
    const articles = [...document.querySelectorAll('[data-story] article[data-chapter]')];
    const index = articles.findIndex(article => (article as HTMLElement).dataset.chapter === chapter);
    const scope = state.mobile ? articles[index] : document.querySelector('.hero')!;
    const hashes = [...scope.querySelectorAll<HTMLCanvasElement>('canvas')].filter(canvas => {
      const style = getComputedStyle(canvas);
      return style.visibility !== "hidden" && style.display !== "none" && canvas.width > 0 && canvas.height > 0;
    }).map(canvas => {
      const image = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (const byte of image) hash = Math.imul(hash ^ byte, 16777619);
      return hash >>> 0;
    });
    return { scroll: scrollY, time: state.mobile ? state.sections[index].t : state.t, opacity: state.sections[index].opacity, hashes };
  }, chapter);
}

test("homepage text scrolls naturally while diagrams fade between centered chapters", options, async () => {
  await withHomepage(1440, 1000, async page => {
    await page.locator('[data-mode="pause"]').click();
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-story] article[data-chapter]')].slice(0, 3).map(article => article.dataset.chapter)), ["workspace", "distributed", "agents"]);
    assert.deepEqual((await page.locator('[data-chapters-list] button').allTextContents()).slice(0, 4), ["Intro", "Setups", "Distributed", "Talk"]);
    let baseline: { delta: number; height: number }[] | undefined;
    for (const height of [1000, 500, 400]) {
      await page.setViewportSize({ width: 1440, height });
      await scroll(page, 0);
      const spacing = await page.evaluate(() => {
        const articles = [...document.querySelectorAll('[data-story] article[data-chapter]')].map(article => article.getBoundingClientRect());
        return articles.slice(1).map((article, index) => ({ delta: article.top - articles[index].top, height: articles[index].height }));
      });
      for (const section of spacing) assert.ok(Math.abs(section.delta - section.height) < 1, `Chapters must follow each other directly: ${JSON.stringify(section)}`);
      if (baseline) assert.deepEqual(spacing, baseline, "Chapter heights and spacing must remain fixed when the viewport becomes shorter.");
      else baseline = spacing;
      const layouts = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-story] article[data-chapter]')].map(article => {
        const body = article.querySelector('.reading-copy')!.getBoundingClientRect();
        const stage = article.querySelector('.stage')!.getBoundingClientRect();
        return { chapter: article.dataset.chapter, textCenter: body.left + body.width / 2, stageCenter: stage.left + stage.width / 2, apart: stage.right <= body.left || stage.left >= body.right, inside: stage.top >= article.getBoundingClientRect().top - 1 && stage.bottom <= article.getBoundingClientRect().bottom + 1 };
      }));
      for (const [index, layout] of layouts.entries()) {
        assert.ok(layout.apart, `A chapter's diagram must stay beside its text: ${JSON.stringify(layout)}`);
        assert.ok(layout.inside, `A chapter's diagram must stay inside its chapter: ${JSON.stringify(layout)}`);
        assert.ok(index % 2 === 0 ? layout.textCenter > 720 && layout.stageCenter < 720 : layout.textCenter < 720 && layout.stageCenter > 720, `Text and diagram must alternate sides: ${JSON.stringify(layout)}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await scroll(page, 0);
    const start = await center(page, "ui");
    const before = await textPosition(page, "ui");
    assert.ok((await scene(page)).opacity > .9, "The centered chapter's diagram must be visible.");
    await scroll(page, start + 120);
    const moved = await textPosition(page, "ui");
    assert.ok(Math.abs((before.top - moved.top) - (moved.scroll - before.scroll)) < 1, "Text must move by the document scroll delta.");
    assert.equal(moved.text, before.text);
    for (const style of moved.styles) {
      assert.equal(style.opacity, "1", "Article text must remain fully visible.");
      assert.equal(style.transform, "none", "Article text must not be translated by the diagram animation.");
      assert.equal(style.visibility, "visible");
      assert.equal(style.clipPath, "none");
    }

    const next = await center(page, "typescript");
    const fades: number[] = [];
    for (let step = 0; step <= 10; step++) {
      await scroll(page, start + (next - start) * step / 10);
      fades.push(await page.evaluate(() => Math.max(...(window as any).__state().sections.map((section: any) => section.opacity))));
    }
    assert.ok(Math.min(...fades) > .5, `A diagram must stay visible between neighboring chapters: ${fades}`);
    assert.ok((await scene(page, "typescript")).opacity > .9, "The next centered diagram must fade in.");

    await page.getByRole("button", { name: "Mini-apps", exact: true }).click();
    await page.waitForFunction(() => {
      const article = document.querySelector('[data-story] article[data-chapter="ui"]')!;
      const bounds = article.getBoundingClientRect();
      const top = document.querySelector('.top')!.getBoundingClientRect().bottom;
      return Math.abs(bounds.top + bounds.height / 2 - (top + innerHeight) / 2) < 3;
    });
    assert.equal(await page.getByRole("button", { name: "Mini-apps", exact: true }).getAttribute("aria-current"), "step");
  });
});

test("homepage autoplay advances only the diagram clock and wheel input preserves playback", options, async () => {
  await withHomepage(1440, 1000, async page => {
    await center(page, "ui");
    const before = await scene(page);
    await page.waitForTimeout(900);
    const playing = await scene(page);
    assert.equal(playing.scroll, before.scroll, "Autoplay must not move the page.");
    assert.ok(playing.time > before.time + .3, "The centered diagram must advance while scrolling is stationary.");
    assert.notDeepEqual(playing.hashes, before.hashes, "The advancing clock must animate the diagram.");

    await page.mouse.wheel(0, 80);
    await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-mode="fast"]').getAttribute("aria-pressed"), "true", "Diagrams must start in Fast and wheel input must preserve it.");
    const wheeled = await scene(page);
    await page.waitForTimeout(900);
    const resumed = await scene(page);
    assert.equal(resumed.scroll, wheeled.scroll);
    assert.ok(resumed.time > wheeled.time + .3, "The diagram must keep animating after a wheel gesture.");

    await page.locator('[data-mode="pause"]').click();
    const paused = await scene(page);
    await page.waitForTimeout(900);
    assert.deepEqual(await scene(page), paused, "Pause must freeze the diagram clock and pixels.");
    await scroll(page, paused.scroll + 40);
    assert.equal((await scene(page)).time, paused.time, "Scrolling while paused must not scrub the diagram clock.");
    await page.locator('[data-mode="play"]').click();
    const normal = await scene(page);
    await page.waitForTimeout(900);
    const normalAdvanced = await scene(page);
    await page.locator('[data-mode="fast"]').click();
    const fast = await scene(page);
    await page.waitForTimeout(900);
    const advanced = await scene(page);
    assert.equal(advanced.scroll, fast.scroll, "Fast forward must not move the page.");
    assert.ok(advanced.time - fast.time > (normalAdvanced.time - normal.time) * 1.15, "Fast forward must accelerate the diagram clock.");
  });
});

test("homepage mobile keeps chapter text visible and animates without scroll scrubbing", options, async () => {
  await withHomepage(390, 844, async page => {
    const start = await center(page, "ui");
    const before = await textPosition(page, "ui");
    assert.ok(before.styles.every(style => style.opacity === "1" && style.transform === "none" && style.clipPath === "none"), "Mobile chapter text must remain regular visible content.");
    const gaps = await page.evaluate(() => {
      const articles = [...document.querySelectorAll('[data-story] article[data-chapter]')].map(article => article.getBoundingClientRect());
      return articles.slice(1).map((article, index) => article.top - articles[index].bottom);
    });
    assert.ok(gaps.every(gap => gap >= -1), "The configured desktop overlap must not overlap mobile chapters.");
    const first = await scene(page);
    assert.ok(first.hashes.length > 0, "The mobile chapter must have its own diagram.");
    await page.waitForTimeout(900);
    const playing = await scene(page);
    assert.equal(playing.scroll, first.scroll);
    assert.ok(playing.time > first.time + .3, "Mobile diagrams must autoplay at a fixed scroll position.");
    assert.notDeepEqual(playing.hashes, first.hashes);
    await scroll(page, start + 80);
    const moved = await textPosition(page, "ui");
    assert.ok(Math.abs((before.top - moved.top) - (moved.scroll - before.scroll)) < 1, "Mobile headings must scroll with their text section.");
    const afterScroll = await scene(page);
    assert.ok(Math.abs(afterScroll.time - playing.time) < .3, "A scroll gesture must not seek the mobile animation.");
    await page.waitForTimeout(900);
    assert.ok((await scene(page)).time > afterScroll.time + .3);
  });
});

test("homepage reduced motion presents a static completed diagram", options, async () => {
  await withHomepage(1440, 1000, async page => {
    await center(page, "ui");
    const still = await scene(page);
    assert.ok(still.time > 1, "Reduced motion must show a completed scene rather than its empty opening.");
    assert.ok(still.opacity > .9);
    assert.ok(still.hashes.length > 0);
    await page.waitForTimeout(900);
    assert.deepEqual(await scene(page), still, "Reduced motion must keep the scene static.");
    await page.locator('[data-mode="play"]').click();
    await page.waitForTimeout(400);
    assert.deepEqual(await scene(page), still, "Play must respect reduced motion.");
  }, "reduce");
});
