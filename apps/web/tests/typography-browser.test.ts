import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type Locator, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./typography-fixture";

const defaultHeadings = [
  { size: 1.5, lineHeight: 1.3 },
  { size: 1.25, lineHeight: 1.35 },
  { size: 1.1, lineHeight: 1.4 },
  { size: 0.8, lineHeight: 1.5 },
  { size: 0.8, lineHeight: 1.5 },
  { size: 0.8, lineHeight: 1.5 },
];
const changedHeadings = [
  { size: 1.75, lineHeight: 1.2 },
  { size: 1.4, lineHeight: 1.4 },
  { size: 1.2, lineHeight: 1.6 },
  { size: 0.9, lineHeight: 1.8 },
  { size: 0.9, lineHeight: 1.8 },
  { size: 0.9, lineHeight: 1.8 },
];

const buildFixture = async (directory: string) => {
  const source = fileURLToPath(new URL("../src/", import.meta.url));
  const fixtures = fileURLToPath(new URL("./", import.meta.url));
  await build({
    entryPoints: [join(fixtures, "typography-fixture.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    outfile: join(directory, "fixture.js"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [tailwindPlugin([source, fixtures])], logLevel: "silent",
  });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><title>Reading examples</title><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  return pathToFileURL(join(directory, "index.html")).href;
};

const typography = (element: Locator) => element.evaluate((node) => {
  const style = getComputedStyle(node);
  return {
    fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), fontFamily: style.fontFamily,
    fontWeight: style.fontWeight, letterSpacing: style.letterSpacing,
  };
});
const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 0.04,
  `${label}: expected ${expected}px, got ${actual}px.`);
const settle = (page: Page) => page.evaluate(async () => {
  await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined)));
});

const assertReadingRole = async (page: Page, fontSize: number, lineHeight: number, label: string) => {
  const chat = page.getByRole("region", { name: "Chat", exact: true });
  const document = page.getByRole("article", { name: "Document", exact: true });
  const readers = [
    chat.getByText("Chat reading paragraph.", { exact: true }), chat.getByText("Chat list item.", { exact: true }),
    chat.getByText("Chat quotation.", { exact: true }), chat.getByText("User reading paragraph.", { exact: true }),
    chat.getByText("Bubble reading paragraph.", { exact: true }), chat.getByRole("textbox", { name: "Write a message ...", exact: true }),
    document.getByText("Document reading paragraph.", { exact: true }), document.getByText("Document list item.", { exact: true }),
    document.getByText("Document quotation.", { exact: true }),
  ];
  const styles = await Promise.all(readers.map(typography));
  for (const [index, style] of styles.entries()) {
    near(style.fontSize, fontSize, `${label}, reading consumer ${index + 1} font`);
    near(style.lineHeight, fontSize * lineHeight, `${label}, reading consumer ${index + 1} line height`);
    assert.equal(style.fontFamily, styles[0].fontFamily, `${label} uses the shared reading font.`);
  }
};

const assertHeadingRoles = async (page: Page, fontSize: number, headings: readonly { size: number; lineHeight: number }[], label: string) => {
  const chat = page.getByRole("region", { name: "Chat", exact: true });
  const document = page.getByRole("article", { name: "Document", exact: true });
  for (const [index, role] of headings.entries()) {
    const level = index + 1;
    const styles = await Promise.all([
      typography(chat.getByRole("heading", { level, name: `Chat heading ${level}`, exact: true })),
      typography(document.getByRole("heading", { level, name: `Document heading ${level}`, exact: true })),
    ]);
    for (const style of styles) {
      near(style.fontSize, fontSize * role.size, `${label}, H${level} font`);
      near(style.lineHeight, fontSize * role.size * role.lineHeight, `${label}, H${level} line height`);
    }
    assert.deepEqual(styles[0], styles[1], `${label}, H${level} shares its typography across chat and document.`);
  }
  for (const name of ["User heading 1", "Bubble heading 1"]) {
    const style = await typography(chat.getByRole("heading", { level: 1, name, exact: true }));
    near(style.fontSize, fontSize * headings[0].size, `${label}, ${name} font`);
    near(style.lineHeight, fontSize * headings[0].size * headings[0].lineHeight, `${label}, ${name} line height`);
  }
};

const controlRoles = async (page: Page) => {
  const controls = page.getByRole("region", { name: "Controls and metadata", exact: true });
  return Promise.all([
    typography(controls.getByRole("button", { name: "Example action", exact: true })),
    typography(controls.getByText("Body control text.", { exact: true })),
    typography(controls.getByText("Metadata text.", { exact: true })),
    typography(page.getByRole("region", { name: "Chat", exact: true }).getByRole("button", { name: "Send", exact: true })),
    typography(page.getByRole("region", { name: "Chat", exact: true }).locator("time").first()),
  ]);
};

test("reading text and headings share tokens across chat and documents without changing control or metadata roles", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-typography-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const url = await buildFixture(directory);
  const screenshots = join(tmpdir(), "ragents-browser-shots");
  await mkdir(screenshots, { recursive: true });
  const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ["--hide-scrollbars"], executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const errors: string[] = [];
  for (const host of ["browser", "vscode"]) for (const theme of ["light", "dark"]) for (const rootSize of [16, 20]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(8000);
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${url}?host=${host}`);
      await page.getByRole("textbox", { name: "Write a message ...", exact: true }).waitFor();
      await page.evaluate(({ rootSize, theme }) => {
        document.documentElement.style.fontSize = `${rootSize}px`;
        document.documentElement.dataset.theme = theme;
      }, { rootSize, theme });
      await settle(page);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.host), host);
      const label = `${host}, ${theme}, root ${rootSize}px`;
      await assertReadingRole(page, rootSize * 0.8, 1.6, label);
      await assertHeadingRoles(page, rootSize * 0.8, defaultHeadings, label);
      const times = await page.locator("[data-quassel-transcript] time").evaluateAll((elements) => elements.map((element) => ({
        text: element.textContent, nowrap: getComputedStyle(element).whiteSpace === "nowrap", fits: element.scrollWidth <= element.clientWidth })));
      assert.ok(times.length > 0 && times.every((time) => time.nowrap && time.fits), `${label}: timestamps stay on one line: ${JSON.stringify(times)}`);
      const unchanged = await controlRoles(page);
      near(unchanged[0].fontSize, rootSize * 0.78, `${label}, button font`);
      near(unchanged[1].fontSize, rootSize * 0.8, `${label}, body control font`);
      near(unchanged[2].fontSize, rootSize * 0.72, `${label}, metadata font`);
      near(unchanged[1].lineHeight, rootSize * 0.8 * 1.55, `${label}, body control line height`);
      near(unchanged[2].lineHeight, rootSize * 0.72 * 1.5, `${label}, metadata line height`);
      await page.locator("[data-quassel-transcript]").hover();
      await page.mouse.wheel(0, -100_000);
      await page.waitForFunction(() => document.querySelector<HTMLElement>("[data-quassel-transcript]")!.scrollTop === 0);
      await page.screenshot({ path: join(screenshots, `typography-${host}-${theme}-${rootSize}.png`) });

      await page.evaluate(() => {
        document.documentElement.style.setProperty("--text-prose", "1rem");
        document.documentElement.style.setProperty("--text-prose--line-height", "1.8");
      });
      await assertReadingRole(page, rootSize, 1.8, `${label}, changed reading token`);
      await assertHeadingRoles(page, rootSize, defaultHeadings, `${label}, changed reading token`);
      assert.deepEqual(await controlRoles(page), unchanged, `${label}: a reading token change leaves controls and metadata unchanged.`);

      await page.evaluate((headings) => {
        for (const [index, role] of headings.slice(0, 4).entries()) {
          document.documentElement.style.setProperty(`--text-prose-h${index + 1}`, `${role.size}em`);
          document.documentElement.style.setProperty(`--text-prose-h${index + 1}--line-height`, String(role.lineHeight));
        }
      }, changedHeadings);
      await assertHeadingRoles(page, rootSize, changedHeadings, `${label}, changed heading tokens`);
      await assertReadingRole(page, rootSize, 1.8, `${label}, changed heading tokens`);
      assert.deepEqual(await controlRoles(page), unchanged, `${label}: heading token changes leave controls and metadata unchanged.`);
    } finally { await page.close(); }
  }
  assert.deepEqual(errors, []);
});

test("chat transcripts reserve a narrow visible scrollbar and keep wheel, track, thumb, and jump-to-end scrolling usable", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-chat-scrollbar-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const url = await buildFixture(directory);
  const screenshots = join(tmpdir(), "ragents-browser-shots");
  await mkdir(screenshots, { recursive: true });
  const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ["--hide-scrollbars"], executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const errors: string[] = [];
  for (const host of ["browser", "vscode"]) for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(8000);
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${url}?host=${host}`);
      const chat = page.getByRole("region", { name: "Chat", exact: true });
      const transcript = chat.locator("[data-quassel-transcript]");
      const jump = chat.getByRole("button", { name: "Jump to end", exact: true });
      await transcript.waitFor();
      await page.evaluate((theme) => {
        document.documentElement.style.fontSize = "16px";
        document.documentElement.dataset.theme = theme;
      }, theme);
      const atBottom = () => page.waitForFunction(() => {
        const node = document.querySelector<HTMLElement>("[data-quassel-transcript]");
        return node !== null && node.scrollHeight - node.clientHeight - node.scrollTop < 2;
      });
      await atBottom();
      const layout = await transcript.evaluate((node) => {
        const style = getComputedStyle(node);
        const scrollbar = getComputedStyle(node, "::-webkit-scrollbar");
        const thumb = getComputedStyle(node, "::-webkit-scrollbar-thumb");
        const probe = document.createElement("span");
        probe.style.color = "var(--border-strong)";
        document.body.append(probe);
        const expectedThumb = getComputedStyle(probe).color;
        probe.remove();
        return {
          scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
          gutter: (node as HTMLElement).offsetWidth - node.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth),
          width: style.scrollbarWidth, color: style.scrollbarColor, stable: style.scrollbarGutter,
          webkitDisplay: scrollbar.display, webkitWidth: parseFloat(scrollbar.width), thumb: thumb.backgroundColor, expectedThumb,
        };
      });
      const label = `${host}, ${theme}`;
      assert.ok(layout.scrollHeight > layout.clientHeight * 2, `${label} has enough conversation to exercise scrolling.`);
      assert.ok(layout.gutter > 0 && layout.gutter <= 16, `${label} reserves a narrow scrollbar gutter (${layout.gutter}px).`);
      assert.equal(layout.width, "thin");
      assert.equal(layout.stable, "stable");
      assert.equal(layout.color, `${layout.expectedThumb} rgba(0, 0, 0, 0)`);
      assert.equal(layout.webkitDisplay, "block", "The chat overrides the global hidden scrollbar rule.");
      near(layout.webkitWidth, 16 * 0.235 * 2, `${label}, scrollbar width token`);
      assert.equal(layout.thumb, layout.expectedThumb);
      assert.equal(await jump.count(), 0);

      const bottom = await transcript.evaluate((node) => node.scrollTop);
      await transcript.hover();
      await page.mouse.wheel(0, -600);
      await jump.waitFor();
      const reading = await transcript.evaluate((node) => node.scrollTop);
      assert.ok(reading < bottom - 200, `${label} responds to upward wheel input.`);
      await page.evaluate(() => window.typographyFixture.append());
      await chat.getByText("A newly arriving reading note.", { exact: true }).waitFor({ state: "attached" });
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      near(await transcript.evaluate((node) => node.scrollTop), reading, `${label}, reading position after a new reply`);
      await jump.click();
      await atBottom();
      await jump.waitFor({ state: "hidden" });

      const track = await transcript.boundingBox();
      assert.ok(track);
      const trackX = track.x + track.width - layout.gutter / 2;
      const beforeTrack = await transcript.evaluate((node) => node.scrollTop);
      await page.mouse.click(trackX, track.y + track.height * 0.2);
      await page.screenshot({ path: join(screenshots, `chat-scrollbar-track-${host}-${theme}.png`) });
      await page.waitForFunction((previous) => document.querySelector<HTMLElement>("[data-quassel-transcript]")!.scrollTop < previous - 20, beforeTrack);
      await jump.waitFor();
      await jump.click();
      await atBottom();
      await jump.waitFor({ state: "hidden" });

      const thumb = await transcript.evaluate((node) => ({ height: node.clientHeight, content: node.scrollHeight, top: node.scrollTop }));
      const thumbHeight = Math.max(24, thumb.height * thumb.height / thumb.content);
      // Grab the thumb near its top, because the floating composer covers the lower end of the track.
      const thumbY = track.y + thumb.height - thumbHeight + 8;
      await page.mouse.move(trackX, thumbY);
      await page.mouse.down();
      await page.mouse.move(trackX, thumbY - 180, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction((previous) => document.querySelector<HTMLElement>("[data-quassel-transcript]")!.scrollTop < previous - 100, thumb.top);
      await jump.waitFor();
      await transcript.hover();
      await page.mouse.wheel(0, -100_000);
      await page.waitForFunction(() => document.querySelector<HTMLElement>("[data-quassel-transcript]")!.scrollTop === 0);
      await jump.waitFor();
      await page.screenshot({ path: join(screenshots, `chat-scrollbar-${host}-${theme}.png`) });
      await jump.click();
      await atBottom();
      await jump.waitFor({ state: "hidden" });
    } finally { await page.close(); }
  }
  assert.deepEqual(errors, []);
});
