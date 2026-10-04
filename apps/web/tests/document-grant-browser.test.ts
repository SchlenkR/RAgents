import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./document-grant-fixture";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const GRANTS: Record<string, string> = { "@documents": "g".repeat(43), "": "p".repeat(43) };
const TOKEN = "test-access-token";
const prefix = "/api/plugins/ragents.documents/runs/run-1";
const artifact = "/files/runs/run-1/artifacts/plan";
const images = ["%40documents/review/shots/home.png", "src/logo.png", "@documents/browser/x.png", "assets/logo.png"];
const IMAGE_COUNT = 7;

interface Seen {
  path: string;
  authorization?: string;
  referer?: string;
  origin?: string;
  cookie?: string;
  method?: string;
  params?: unknown;
}

const grantFor = (reference: string): string => GRANTS[reference.startsWith("%40documents") || reference.startsWith("@documents") ? "@documents" : ""]!;

test("document addresses carry grants instead of the access token where the page signs in with a token, and the plain route with a cookie", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1",
  timeout: 120_000,
}, async (context) => {
  await mkdir("/private/tmp/ragents-document-grant", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-document-grant/check-");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const referrerPolicy = /<meta name="referrer"[^>]*>/.exec(await readFile(`${root}apps/web/index.html`, "utf8"))?.[0];
  assert.ok(referrerPolicy, "the shared web entry declares a referrer policy");
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
    const rpc = url.pathname === "/rpc" ? JSON.parse(body || "{}") as { id?: number; method?: string; params?: { root?: string } } : undefined;
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/files/") || rpc) {
      seen.push({ path: request.url ?? "", authorization: request.headers.authorization, referer: request.headers.referer, origin: request.headers.origin, cookie: request.headers.cookie, method: rpc?.method, params: rpc?.params });
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
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id ?? null, result: rpc.method === "ragents.documents.grant" ? { grant: GRANTS[rpc.params?.root ?? ""] } : null }));
      return;
    }
    if (url.pathname === `${prefix}/raw/%40documents/review/report.html`) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end('<!doctype html><html><body><h1>Review</h1><img alt="Home" src="shots/home.png"></body></html>');
      return;
    }
    if (url.pathname === `${prefix}/raw/%40documents/review/notes.md`) {
      response.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
      response.end("# Notes\n\n![Notes shot](shots/home.png) and ![Source](../../src/logo.png)\n");
      return;
    }
    const served = images.find((reference) => url.pathname === `${prefix}/raw/${reference}` || url.pathname === `${prefix}/grant/${grantFor(reference)}/${reference}`);
    if (served !== undefined || url.pathname === artifact) {
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(PNG);
      return;
    }
    if (url.pathname === `${prefix}/raw/%40documents/review/data.zip` || url.pathname === `${prefix}/grant/${GRANTS["@documents"]}/%40documents/review/data.zip`) {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end("zip");
      return;
    }
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/files/")) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html><head><meta charset="utf-8">${referrerPolicy}<link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
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
  const origin = `http://127.0.0.1:${address.port}`;
  const browser: Browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  context.after(() => browser.close());

  /** Opens the fixture, waits until every image of the documents and the chat has loaded, and returns the address the download link leads to. */
  const visit = async (query: string): Promise<{ download: string; sources: string[] }> => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1600 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/${query}`);
    await page.frameLocator("iframe[title='report.html']").getByRole("img", { name: "Home" }).waitFor({ state: "attached" });
    await page.waitForFunction((count) => {
      const frame = document.querySelector<HTMLIFrameElement>("iframe[title='report.html']");
      const all = [...document.images, ...frame?.contentDocument?.images ?? []];
      return all.filter((image) => image.complete && image.naturalWidth === 1).length === count;
    }, IMAGE_COUNT);
    const sources = await page.locator("img").evaluateAll((elements) => elements.map((element) => (element as HTMLImageElement).src));
    const link = page.locator("a[download]");
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    const target = download.url();
    await download.cancel();
    assert.deepEqual(errors, []);
    await page.close();
    return { download: target, sources };
  };

  const tokenPage = await visit(`?access=${TOKEN}`);
  const grantCalls = seen.filter((entry) => entry.method === "ragents.documents.grant");
  assert.deepEqual(grantCalls.map((entry) => entry.params).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    [{ runId: "run-1", root: "" }, { runId: "run-1", root: "@documents" }], "one grant per root for the documents and the chat together");
  for (const call of grantCalls) {
    assert.equal(call.authorization, `Bearer ${TOKEN}`);
    assert.equal(call.origin, origin, "a request that changes something still names its origin, which the server's same-site check reads");
  }
  const loads = seen.filter((entry) => entry.method === undefined);
  assert.ok(loads.length > 0);
  for (const entry of loads) {
    assert.ok(!entry.path.includes(TOKEN) && !entry.path.includes("access="), `${entry.path} carries no access token`);
    assert.ok(entry.referer === undefined || entry.referer === `${origin}/`, `${entry.path} sends at most the origin as referrer, not ${entry.referer}`);
  }
  const imagePaths = new Set(loads.filter((entry) => /\.png$/.test(entry.path)).map((entry) => entry.path));
  assert.deepEqual([...imagePaths].sort(), images.map((reference) => `${prefix}/grant/${grantFor(reference)}/${reference}`).sort(),
    "every image of a document and of the chat loads through the grant of its root");
  assert.ok(loads.filter((entry) => /\.png$/.test(entry.path)).every((entry) => entry.authorization === undefined && entry.cookie === undefined));
  const frameImage = loads.find((entry) => entry.path.endsWith("/review/shots/home.png") && entry.referer === undefined);
  assert.ok(frameImage, "the frame of the HTML document sends no referrer at all");
  const result = loads.filter((entry) => entry.path === artifact);
  assert.deepEqual(result.map((entry) => entry.authorization), [`Bearer ${TOKEN}`], "a result outside the content route loads once with the bearer");
  assert.ok(tokenPage.sources.some((source) => source.startsWith("blob:")), "and shows under a blob address");
  assert.equal(tokenPage.download, `${origin}${prefix}/grant/${GRANTS["@documents"]}/%40documents/review/data.zip`, "a download leads to the grant address");
  assert.ok(tokenPage.sources.every((source) => !source.includes(TOKEN)));

  seen.splice(0);
  const cookiePage = await visit("");
  assert.equal(seen.filter((entry) => entry.method === "ragents.documents.grant").length, 0, "without a token no grant is needed");
  assert.deepEqual([...new Set(seen.filter((entry) => /\.png$/.test(entry.path)).map((entry) => entry.path))].sort(), images.map((reference) => `${prefix}/raw/${reference}`).sort(),
    "with a cookie every image loads through the plain route");
  assert.ok(cookiePage.sources.includes(`${origin}${artifact}`), "a result loads from its own route");
  assert.equal(cookiePage.download, `${origin}${prefix}/raw/%40documents/review/data.zip`);
});
