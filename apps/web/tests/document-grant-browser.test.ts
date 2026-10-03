import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./document-grant-fixture";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const GRANT = "g".repeat(43);
const TOKEN = "test-access-token";
const prefix = "/api/plugins/ragents.documents/runs/run-1";

interface Seen {
  path: string;
  authorization?: string;
  referer?: string;
  cookie?: string;
  method?: string;
  params?: unknown;
}

test("an HTML document loads its images through a grant in its base where the page signs in with a token, and through the plain route with a cookie", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1",
  timeout: 120_000,
}, async (context) => {
  await mkdir("/private/tmp/ragents-document-grant", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-document-grant/check-");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    entryPoints: [fileURLToPath(new URL("document-grant-fixture.tsx", import.meta.url))],
    outfile: `${directory}/fixture.js`,
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}plugins/ragents.documents/web`])],
    logLevel: "silent",
  });
  const seen: Seen[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const body = await new Promise<string>((resolve) => {
      let text = "";
      request.on("data", (chunk) => { text += String(chunk); });
      request.on("end", () => resolve(text));
    });
    const rpc = url.pathname === "/rpc" ? JSON.parse(body || "{}") as { id?: number; method?: string; params?: unknown } : undefined;
    if (url.pathname.startsWith("/api/") || rpc) {
      seen.push({ path: request.url ?? "", authorization: request.headers.authorization, referer: request.headers.referer, cookie: request.headers.cookie, method: rpc?.method, params: rpc?.params });
    }
    if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
      response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript");
      response.end(await readFile(`${directory}${url.pathname}`));
      return;
    }
    if (url.pathname === "/rpc/stream") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write('event: hello\ndata: {"connection":"fixture"}\n\n');
      return;
    }
    if (rpc) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id ?? null, result: rpc.method === "ragents.documents.grant" ? { grant: GRANT } : null }));
      return;
    }
    if (url.pathname === `${prefix}/raw/%40documents/review/report.html`) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end('<!doctype html><html><body><h1>Review</h1><img alt="Home" src="shots/home.png"></body></html>');
      return;
    }
    if (url.pathname === `${prefix}/grant/${GRANT}/%40documents/review/shots/home.png` || url.pathname === `${prefix}/raw/%40documents/review/shots/home.png`) {
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(PNG);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><head><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  context.after(() => browser.close());

  const imageWidth = async (query: string): Promise<number> => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/${query}`);
    const image = page.frameLocator("iframe[title='report.html']").getByRole("img", { name: "Home" });
    await image.waitFor({ state: "attached" });
    await page.waitForFunction(() => {
      const frame = document.querySelector<HTMLIFrameElement>("iframe[title='report.html']");
      const element = frame?.contentDocument?.querySelector("img");
      return element?.complete === true;
    });
    const width = await image.evaluate((element) => (element as HTMLImageElement).naturalWidth);
    assert.deepEqual(errors, []);
    await page.close();
    return width;
  };

  assert.equal(await imageWidth(`?access=${TOKEN}`), 1, "with a token the image loads through the grant");
  const grantCalls = seen.filter((entry) => entry.method === "ragents.documents.grant");
  assert.deepEqual(grantCalls.map((entry) => [entry.params, entry.authorization]), [[{ runId: "run-1", root: "@documents" }, `Bearer ${TOKEN}`]]);
  const document = seen.find((entry) => entry.path.endsWith("/report.html"));
  assert.equal(document?.authorization, `Bearer ${TOKEN}`, "the document itself loads with the bearer");
  const images = seen.filter((entry) => entry.path.includes("home.png"));
  assert.deepEqual(images.map((entry) => entry.path), [`${prefix}/grant/${GRANT}/%40documents/review/shots/home.png`]);
  for (const entry of images) {
    assert.equal(entry.authorization, undefined);
    assert.equal(entry.referer, undefined, "no referrer carries the page address with its token");
  }
  assert.ok(images.every((entry) => !entry.path.includes(TOKEN) && entry.cookie === undefined), "the long-lived token is in no address of the document");

  seen.splice(0);
  assert.equal(await imageWidth(""), 1, "with a cookie the image loads through the plain route");
  assert.deepEqual(seen.filter((entry) => entry.path.includes("home.png")).map((entry) => [entry.path, entry.referer]), [[`${prefix}/raw/%40documents/review/shots/home.png`, undefined]]);
  assert.equal(seen.filter((entry) => entry.method === "ragents.documents.grant").length, 0, "without a token no grant is needed");
});
