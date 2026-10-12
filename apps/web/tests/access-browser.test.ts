import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";

const fixture = `
import { createRoot } from "react-dom/client";
import { AccessGate } from "./apps/web/src/AccessContext";
import { initializeTheme } from "./apps/web/src/theme";
import { initializeAppearance } from "./apps/web/src/appearance";
import "./apps/web/src/ui/tailwind.css";
initializeTheme(window);
initializeAppearance(window);
createRoot(document.getElementById("root")).render(<AccessGate><p>Signed in</p></AccessGate>);
`;

test("sign-in preserves spacing between its heading, description, fields and button", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-access-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ stdin: { contents: fixture, resolveDir: root, sourcefile: "fixture.tsx", loader: "tsx" },
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    plugins: [tailwindPlugin([`${root}apps/web/src`])], logLevel: "silent" });
  const script = await readFile(join(directory, "fixture.js"));
  const styles = await readFile(join(directory, "fixture.css"));
  const server = createServer((request, response) => {
    const path = request.url!.split("?")[0];
    if (path === "/api/access") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ enabled: true, user: null })); }
    else if (path === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(script); }
    else if (path === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(styles); }
    else if (path === "/") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html><head><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
    else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage({ reducedMotion: "reduce" });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("ragents.theme", new URLSearchParams(location.search).get("theme")!));
  const screenshots = join(tmpdir(), "ragents-browser-shots");
  await mkdir(screenshots, { recursive: true });
  for (const theme of ["light", "dark"]) for (const width of [1200, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`http://127.0.0.1:${address.port}/?theme=${theme}`);
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    const shot = join(screenshots, `sign-in-${theme}-${width}.png`);
    await page.screenshot({ path: shot });
    context.diagnostic(shot);
    const spacing = await page.getByRole("main").evaluate(main => {
      const heading = main.querySelector("h1")!;
      const description = main.querySelector("p")!;
      const labels = [...main.querySelectorAll("label")];
      const button = main.querySelector("button")!;
      const rects = [heading, description, ...labels, button].map(element => element.getBoundingClientRect());
      return {
        heading: [getComputedStyle(heading).marginTop, getComputedStyle(heading).marginBottom].map(parseFloat),
        margins: [description, ...labels].map(element => parseFloat(getComputedStyle(element).marginBottom)),
        gaps: rects.slice(1).map((rect, index) => rect.top - rects[index]!.bottom),
      };
    });
    assert.ok(spacing.heading.every(margin => margin > 0), JSON.stringify({ theme, width, spacing }));
    assert.ok(spacing.margins.every(margin => margin > 0), JSON.stringify({ theme, width, spacing }));
    assert.ok(spacing.gaps.every(gap => gap > 0), JSON.stringify({ theme, width, spacing }));
  }
  assert.deepEqual(errors, []);
});
