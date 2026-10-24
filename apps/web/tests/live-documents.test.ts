import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { sameBytes } from "../../../plugins/ragents.documents/web/content";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./live-documents-fixture";

test("document bytes distinguish equal-sized edits and retain identical content", () => {
  assert.equal(sameBytes(undefined, new Uint8Array()), false);
  assert.equal(sameBytes(new Uint8Array(), new Uint8Array()), true);
  assert.equal(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
  assert.equal(sameBytes(new Uint8Array([1]), new Uint8Array([1, 2])), false);
});

test("open documents and file previews follow changes without replacing unchanged views", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1",
  timeout: 120_000,
}, async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-live-documents-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    entryPoints: [fileURLToPath(new URL("live-documents-fixture.tsx", import.meta.url))],
    outfile: path.join(directory, "fixture.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
    plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}apps/web/tests`, `${root}plugins/ragents.documents/web`, `${root}plugins/ragents.workspace/web`])],
  });
  const html = (heading: string) => `<!doctype html><html><body><h1>${heading}</h1>${"<p>Document paragraph</p>".repeat(80)}<script>window.executed = true</script></body></html>`;
  const svg = (width: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="1"><rect width="${width}" height="1" fill="red"/></svg>`;
  const files = new Map([
    ["report.md", "# Original report\n\n[Relative](images/example.png)\n\n" + "Paragraph\n\n".repeat(80)],
    ["second.markdown", "# Second report"], ["plain.txt", "Original text"], ["site.html", html("Original page")],
    ["image.svg", svg(1)], ["data.bin", "Original download"], ["workspace.md", "# Workspace original"],
    ["standalone.txt", "Standalone original"], ["slow.md", "# Slow original"],
  ]);
  const requests: string[] = [];
  const blocked = new Map<string, { ready: Promise<void>; release: () => void }>();
  const block = (key: string) => {
    let release = () => {};
    const ready = new Promise<void>((resolve) => { release = resolve; });
    blocked.set(key, { ready, release });
    return () => { blocked.delete(key); release(); };
  };
  const failing = new Set<string>();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
      response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript");
      response.end(await readFile(path.join(directory, url.pathname.slice(1))));
      return;
    }
    if (url.pathname === "/fixture/rpc") {
      const body = await new Promise<string>((resolve) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => resolve(Buffer.concat(chunks).toString()));
      });
      const { method, input } = JSON.parse(body) as { method: string; input: { root: string; path: string } };
      requests.push(`${method}:${input.path}`);
      if (method === "ragents.documents.files") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ groups: [], truncated: false,
          loose: [...files].map(([name, content]) => ({ path: name, size: content.length, modifiedAt: "2026-10-23" })) }));
        return;
      }
      if (method.endsWith(".list")) {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ root: input.root, location: "Example folder", path: "", truncated: false,
          entries: [...files].map(([name, content]) => ({ name, kind: "file", size: content.length, modifiedAt: "2026-10-23" })) }));
        return;
      }
      const content = files.get(input.path);
      await blocked.get(`preview:${input.path}`)?.ready;
      if (failing.has(input.path)) { response.writeHead(500).end("Preview unavailable"); return; }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ root: input.root, path: input.path, size: content?.length ?? 0, previewable: true, content }));
      return;
    }
    if (url.pathname.includes("/raw/") || url.pathname === "/standalone.txt") {
      const name = url.pathname.split("/").at(-1)!;
      const content = files.get(name);
      requests.push(`content:${name}`);
      await blocked.get(`content:${name}`)?.ready;
      if (failing.has(name)) { response.writeHead(500, { "Content-Type": "application/json" }).end('{"error":"Document unavailable"}'); return; }
      response.setHeader("Content-Type", name.endsWith("svg") ? "image/svg+xml" : "text/plain");
      response.end(content);
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(async () => {
    for (const entry of blocked.values()) entry.release();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1400, height: 1600 }, acceptDownloads: true });
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto(`http://127.0.0.1:${address.port}`);
  const report = page.getByRole("region", { name: "report.md", exact: true });
  const text = page.getByRole("region", { name: "plain.txt", exact: true });
  const site = page.getByRole("region", { name: "site.html", exact: true });
  const image = page.getByRole("region", { name: "image.svg", exact: true });
  const binary = page.getByRole("region", { name: "data.bin", exact: true });
  await report.getByRole("heading", { name: "Original report" }).waitFor();
  await site.frameLocator("iframe").getByRole("heading", { name: "Original page" }).waitFor();
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>('section[aria-label="image.svg"] img')?.naturalWidth === 1);
  const frame = await site.locator("iframe").elementHandle();
  await frame!.evaluate((element) => {
    const view = (element as HTMLIFrameElement).contentWindow!;
    view.document.documentElement.dataset.identity = "retained";
    view.scrollTo(0, 120);
  });
  assert.equal(await site.locator("iframe").getAttribute("sandbox"), "allow-same-origin");
  assert.equal(await frame!.evaluate((element) => (element as HTMLIFrameElement).contentWindow && "executed" in (element as HTMLIFrameElement).contentWindow!), false);
  const source = await image.locator("img").getAttribute("src");
  const download = await binary.locator("a[download]").getAttribute("href");
  const reportScroll = await report.getByRole("heading", { name: "Original report" }).evaluateHandle((heading) => {
    const ancestors: HTMLElement[] = [];
    for (let element = heading.parentElement; element; element = element.parentElement) ancestors.push(element);
    const scrollable = ancestors.find((element) => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === "auto")!;
    scrollable.scrollTop = 120;
    return scrollable;
  });
  const release = block("content:plain.txt");
  files.set("plain.txt", "Updated text");
  files.set("report.md", "# Updated report\n\n" + "Paragraph\n\n".repeat(80));
  await page.evaluate(() => window.emitFiles("files"));
  await text.locator('[aria-busy="true"]').waitFor();
  assert.equal(await text.getByText("Original text", { exact: true }).count(), 1, "old text remains during a reload");
  release();
  await text.getByText("Updated text", { exact: true }).waitFor();
  await report.getByRole("heading", { name: "Updated report" }).waitFor();
  await site.locator('[aria-busy="false"]').waitFor();
  assert.equal(await site.locator("iframe").evaluate((element, previous) => element === previous, frame), true);
  assert.equal(await site.locator("iframe").evaluate((element) => (element as HTMLIFrameElement).contentDocument?.documentElement.dataset.identity), "retained");
  assert.equal(await frame!.evaluate((element) => (element as HTMLIFrameElement).contentWindow!.scrollY), 120);
  assert.equal(await reportScroll.evaluate((element) => element.scrollTop), 120);
  assert.equal(await image.locator("img").getAttribute("src"), source);
  assert.equal(await binary.locator("a[download]").getAttribute("href"), download);

  files.set("site.html", html("Updated page"));
  files.set("image.svg", svg(2));
  files.set("data.bin", "Updated download");
  await page.evaluate(() => window.emitFiles("files"));
  await site.frameLocator("iframe").getByRole("heading", { name: "Updated page" }).waitFor();
  assert.equal(await site.locator("iframe").evaluate((element) => (element as HTMLIFrameElement).contentWindow!.scrollY), 120);
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>('section[aria-label="image.svg"] img')?.naturalWidth === 2);
  await binary.locator('[aria-busy="false"]').waitFor();
  const newDownload = await binary.locator("a[download]").getAttribute("href");
  assert.notEqual(newDownload, download);
  assert.equal(await page.evaluate(async (url) => (await fetch(url!)).text(), newDownload), "Updated download");

  await report.getByRole("button", { name: "Expand document" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("heading", { name: "Updated report" }).waitFor();
  files.set("report.md", "# Modal update");
  await page.evaluate(() => window.emitFiles("files"));
  await modal.getByRole("heading", { name: "Modal update" }).waitFor();
  files.set("report.md", "# Manual update");
  await modal.getByRole("button", { name: "Reload document" }).click();
  await modal.getByRole("heading", { name: "Manual update" }).waitFor();
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await report.getByRole("button", { name: "Reload document" }).click();
  await report.getByRole("heading", { name: "Manual update" }).waitFor();
  assert.equal(await page.getByRole("region", { name: "inline", exact: true }).getByRole("button", { name: "Reload document" }).count(), 0);
  files.set("workspace.md", "# Workspace changed");
  await page.evaluate(() => window.emitFiles("workspace"));
  await page.getByRole("heading", { name: "Workspace changed" }).waitFor();

  const browserA = page.getByRole("region", { name: "Files A", exact: true });
  const browserB = page.getByRole("region", { name: "Files B", exact: true });
  await browserA.getByRole("button", { name: /^report.md/ }).click();
  await browserA.getByRole("heading", { name: "Manual update" }).waitFor();
  await browserA.getByRole("button", { name: "Source", exact: true }).click();
  await browserA.getByText("# Manual update", { exact: true }).waitFor();
  await browserA.getByRole("button", { name: /^second.markdown/ }).click();
  await browserA.getByText("# Second report", { exact: true }).waitFor();
  await browserB.getByRole("button", { name: /^second.markdown/ }).click();
  await browserB.getByRole("heading", { name: "Second report" }).waitFor();
  files.set("second.markdown", "# Second report\n\n[Relative link](images/example.png)\n\n![Relative image](images/example.png)");
  await page.evaluate(() => window.emitFiles("workspace"));
  await browserB.getByRole("link", { name: "Relative link" }).waitFor();
  assert.equal(await browserB.getByRole("link", { name: "Relative link" }).getAttribute("href"), "images/example.png");
  assert.equal(await browserB.locator('img[alt="Relative image"]').getAttribute("src"), "images/example.png");
  files.set("second.markdown", "# Second report");
  await browserA.getByRole("button", { name: "File storage", exact: true }).click();
  await browserA.getByRole("button", { name: /^second.markdown/ }).click();
  await browserA.getByText("# Second report", { exact: true }).waitFor();
  await browserA.getByRole("button", { name: "Rendered", exact: true }).click();
  await browserA.getByRole("heading", { name: "Second report" }).waitFor();
  const releasePreview = block("preview:second.markdown");
  files.set("second.markdown", "# Live preview");
  await page.evaluate(() => window.emitFiles("files"));
  await browserA.locator('[aria-busy="true"]').waitFor();
  assert.equal(await browserA.getByRole("heading", { name: "Second report" }).count(), 1);
  releasePreview();
  await browserA.getByRole("heading", { name: "Live preview" }).waitFor();
  files.set("second.markdown", "# Refreshed preview");
  await browserA.getByRole("button", { name: "Refresh files" }).click();
  await browserA.getByRole("heading", { name: "Refreshed preview" }).waitFor();
  await browserA.getByRole("button", { name: /^plain.txt/ }).click();
  await browserA.getByText("Updated text", { exact: true }).waitFor();
  assert.equal(await browserA.getByRole("group", { name: "Markdown view" }).count(), 0);
  const releaseSlow = block("preview:slow.md");
  await browserA.getByRole("button", { name: /^slow.md/ }).click();
  await browserA.getByRole("button", { name: /^plain.txt/ }).click();
  releaseSlow();
  await browserA.getByText("Updated text", { exact: true }).waitFor();
  assert.equal(await browserA.getByRole("heading", { name: "Slow original" }).count(), 0);

  failing.add("plain.txt");
  await text.getByRole("button", { name: "Reload document" }).click();
  await text.getByRole("alert").getByText("Document unavailable", { exact: true }).waitFor();
  assert.equal(await text.getByText("Updated text", { exact: true }).count(), 1);
  failing.delete("plain.txt");
  files.set("plain.txt", "Recovered text");
  await page.evaluate(() => window.reconnect());
  await text.getByText("Recovered text", { exact: true }).waitFor();
  await page.evaluate(() => window.setVisible(false));
  const count = requests.length;
  files.set("plain.txt", "Visible again");
  await page.evaluate(() => { window.emitFiles("files"); window.emitFiles("workspace"); });
  assert.equal(requests.length, count, "hidden pages do not read on file changes");
  await page.evaluate(() => window.setVisible(true));
  await text.getByText("Visible again", { exact: true }).waitFor();
  files.set("standalone.txt", "Standalone changed");
  await page.clock.runFor(30000);
  await page.getByText("Standalone changed", { exact: true }).waitFor();
  const store = page.getByRole("region", { name: "Document store", exact: true });
  files.set("new-report.md", "# Newly created");
  await page.evaluate(() => window.emitFiles("files"));
  await store.getByText("new-report.md", { exact: true }).waitFor();
  assert.equal(await page.locator("[title]").count(), 0);
  assert.deepEqual(errors, []);
});
