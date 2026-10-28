import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type FrameLocator, type Locator, type Page } from "playwright-core";
import { frameHtml, panelHtml } from "../../vscode/src/webview-html";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./typography-fixture";

const buildFixture = async (directory: string) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    entryPoints: [join(root, "apps/web/tests/typography-fixture.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    outfile: join(directory, "fixture.js"), define: { "process.env.NODE_ENV": '\"production\"' },
    plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}plugins/ragents.ask/web`, `${root}plugins/ragents.documents/web`, `${root}plugins/ragents.workspace/web`, `${root}apps/web/tests`])], logLevel: "silent",
  });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><title>Reading examples</title><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  return pathToFileURL(join(directory, "index.html")).href;
};

const typography = (element: Locator) => element.evaluate((node) => {
  const style = getComputedStyle(node);
  return { fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), fontFamily: style.fontFamily };
});
const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 0.04,
  `${label}: expected ${expected}px, got ${actual}px.`);
const settle = (page: Page) => page.evaluate(async () => {
  await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined)));
});

async function assertScale(scope: Page | FrameLocator, base: number, family: string, mono: string) {
  await scope.locator("html").evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => undefined)));
  });
  const chat = scope.getByRole("region", { name: "Chat", exact: true });
  const documentView = scope.getByRole("article", { name: "Document", exact: true });
  const files = scope.getByRole("region", { name: "File preview", exact: true });
  const body = [
    chat.getByText("Please review the changes.", { exact: true }),
    chat.getByText("A shared document uses readable paragraphs, a list and code.", { exact: true }),
    chat.getByText("Review the current changes.", { exact: true }),
    chat.getByText("Which review period applies?", { exact: true }),
    chat.getByRole("button", { name: "3 days Review this week", exact: true }),
    chat.getByRole("button", { name: "14 days Review after the next update", exact: true }),
    chat.getByText("Approve the review", { exact: true }),
    chat.getByRole("textbox", { name: "Write a message ...", exact: true }),
    documentView.getByText("A shared document uses readable paragraphs, a list and code.", { exact: true }),
    files.getByText("A shared document uses readable paragraphs, a list and code.", { exact: true }),
  ];
  const small = [
    chat.locator("[data-step]").filter({ hasText: "Inspect files" }).last(),
    chat.locator("time").first(), chat.getByText("New turn", { exact: true }),
    scope.locator("header [data-slot=badge]").filter({ hasText: /^Ready$/ }),
  ];
  for (const [factor, lineHeight, elements] of [[1, 1.5, body], [0.85, 1.4, small]] as const) {
    for (const element of elements) {
      const actual = await typography(element);
      const label = await element.innerText();
      near(actual.fontSize, base * factor, `${label}, font`);
      near(actual.lineHeight, base * factor * lineHeight, `${label}, line height`);
      assert.equal(actual.fontFamily, family, `${label}, UI family`);
    }
  }
  const title = await typography(scope.locator("[data-header-title]"));
  near(title.fontSize, base * 1.15, "Run title, font");
  near(title.lineHeight, base * 1.15 * 1.3, "Run title, line height");
  assert.equal(title.fontFamily, family);
  for (const section of [chat, documentView, files]) {
    for (const [level, factor, lineHeight] of [[1, 1.3, 1.25], [2, 1.15, 1.3], [3, 1.05, 1.35], [4, 1, 1.4]] as const) {
      const actual = await typography(section.getByRole("heading", { level }));
      near(actual.fontSize, base * factor, `H${level}, font`);
      near(actual.lineHeight, base * factor * lineHeight, `H${level}, line height`);
      assert.equal(actual.fontFamily, family);
    }
    for (const code of [section.locator("p code"), section.locator("pre code")]) {
      const actual = await typography(code);
      near(actual.fontSize, base * 0.9, "Code, font");
      near(actual.lineHeight, base * 0.9 * 1.5, "Code, line height");
      assert.equal(actual.fontFamily, mono, "Code, monospace family");
    }
  }
  await scope.getByRole("button", { name: "Reading menu", exact: true }).click();
  const menu = scope.getByRole("menuitem", { name: "Open notes", exact: true });
  const style = await typography(menu);
  near(style.fontSize, base, "Menu item, font");
  near(style.lineHeight, base * 1.5, "Menu item, line height");
  assert.equal(style.fontFamily, family);
  await menu.click();
}

test("one host base reaches chat, question and action cards, menus, documents and file previews, including live VS Code font changes", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-type-scale-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await buildFixture(directory);
  const [html, script, css] = await Promise.all(["index.html", "fixture.js", "fixture.css"].map((file) => readFile(join(directory, file), "utf8")));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const shots = process.env.RAGENTS_TYPOGRAPHY_SCREENSHOTS ?? join(tmpdir(), "ragents-browser-shots");
  await mkdir(shots, { recursive: true });
  for (const host of ["browser", "vscode", "local"] as const) {
    const browserContext = await browser.newContext({ viewport: { width: 1440, height: 1200 }, reducedMotion: "reduce" });
    await browserContext.addInitScript("window.acquireVsCodeApi = () => ({ postMessage() {} });");
    const errors: string[] = [];
    await browserContext.route("http://**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: script });
      if (url.pathname === "/fixture.css") return route.fulfill({ contentType: "text/css", body: css });
      if (url.pathname === "/rpc/stream") return;
      if (url.pathname === "/rpc") {
        const packet = request.postDataJSON() as { id: number; method: string; params: { root: string } };
        const root = packet.params.root;
        const markdown = "# Review notes\n\nA shared document uses readable paragraphs, a list and code.\n\n- Review the current changes.\n- Record the result.\n\nUse `readFile` to inspect a file.\n\n~~~ts\nconst result = readFile(\"notes.md\");\n~~~\n\n## Next actions\n\n### Details\n\n#### Context\n\n> Keep the report concise.";
        const result = packet.method === "ragents.workspace.browse.list"
          ? { root, location: "/home/user/project", path: "", entries: [{ name: "notes.md", kind: "file", size: markdown.length, modifiedAt: "2026-10-28T10:00:00Z" }], truncated: false }
          : packet.method === "ragents.workspace.browse.preview" ? { root, path: "notes.md", size: markdown.length, previewable: true, content: markdown }
            : {};
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: packet.id, result }) });
      }
      if (url.pathname === "/shell" || url.pathname === "/local") {
        const shell = (url.pathname === "/local"
          ? panelHtml({ nonce: "typography", title: "Reading examples", state: { theme: "light", page: "connections", connections: [], profileSuggestions: [] }, scriptUri: "http://webview.test/fixture.js", styleUri: "http://webview.test/fixture.css", cspSource: "http://webview.test" })
          : frameHtml({ serverUrl: "http://typography.test", query: { host: "vscode", element: "scale" }, nonce: "typography", title: "Reading examples" }))
          .replace("<html ", '<html style="--vscode-chat-font-size:13px;--vscode-chat-font-family:Georgia;--vscode-editor-font-family:Courier New;--vscode-font-size:19px;--vscode-font-family:serif" ');
        return route.fulfill({ contentType: "text/html", body: shell.replace("default-src 'none';", "default-src 'none'; connect-src http://webview.test;") });
      }
      return route.fulfill({ contentType: "text/html", body: html });
    });
    const page = await browserContext.newPage();
    page.setDefaultTimeout(8000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(host === "browser" ? "http://typography.test/index.html?scale" : host === "local" ? "http://webview.test/local?host=vscode&scale" : "http://webview.test/shell");
    const scope = host === "vscode" ? page.frameLocator("#frame") : page;
    const files = scope.getByRole("region", { name: "File preview", exact: true });
    await files.getByRole("button", { name: /notes.md/ }).click();
    await files.getByText("A shared document uses readable paragraphs, a list and code.", { exact: true }).waitFor();
    const family = host !== "browser" ? "Georgia" : await scope.locator("body").evaluate((element) => getComputedStyle(element).fontFamily);
    const mono = host !== "browser" ? '\"Courier New\"' : await scope.locator("html").evaluate((element) => {
      const probe = document.createElement("code");
      probe.className = "font-mono";
      element.append(probe);
      const family = getComputedStyle(probe).fontFamily;
      probe.remove();
      return family;
    });
    await assertScale(scope, host === "browser" ? 14 : 13, family, mono);
    await scope.locator("[data-quassel-transcript]").evaluate((element) => { element.scrollTop = 0; });
    await settle(page);
    await page.screenshot({ path: join(shots, `after-${host}-${host === "browser" ? 14 : 13}-chat-document.png`) });
    if (host !== "browser") {
      const draft = scope.getByRole("textbox", { name: "Write a message ...", exact: true });
      await draft.fill("Draft survives font changes");
      const frames = page.frames();
      await page.evaluate(() => {
        document.documentElement.style.setProperty("--vscode-chat-font-size", "15px");
        document.documentElement.style.setProperty("--vscode-chat-font-family", "Arial");
        document.documentElement.style.setProperty("--vscode-editor-font-family", "monospace");
      });
      await page.frames().find((frame) => host === "local" ? frame.parentFrame() === null : frame.parentFrame() !== null)!.waitForFunction(() => parseFloat(getComputedStyle(document.body).fontSize) === 15);
      await scope.locator("html").evaluate(async () => {
        await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)));
      });
      await assertScale(scope, 15, "Arial", "monospace");
      assert.equal(await draft.inputValue(), "Draft survives font changes");
      assert.deepEqual(page.frames(), frames, "Changing font size retains the open frame.");
      await page.screenshot({ path: join(shots, `after-${host}-15-chat-document.png`) });
    }
    assert.deepEqual(errors, []);
    await browserContext.close();
  }
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
