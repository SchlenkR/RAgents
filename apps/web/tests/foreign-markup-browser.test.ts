import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";

test("foreign chat and Markdown markup keeps accessible descriptions without native tooltips, including portals and streamed updates", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-foreign-markup-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    stdin: { contents: `import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatInputToolbar, ChatMessages, Markdown } from "@schlenkr/quassel";
import { QuasselHost } from "./src/chat/QuasselHost";
import "./src/ui/tailwind.css";
const tool = { key: "tool", role: "tool", text: "Inspect files", tool: { id: "inspect", name: "inspect_files", arguments: "{}" } };
function App() {
  const [messages, setMessages] = useState([{ key: "thinking", role: "thinking", text: "Considering the files" }]);
  window.foreignMarkup = { stream: () => setMessages([tool]) };
  return <QuasselHost><main>
    <section aria-label="Current step" style={{ height: 140 }}><ChatMessages running detailMode="current" stepsExpandable={false} messages={messages} /></section>
    <section aria-label="Toolbar"><ChatInputToolbar onSend={() => {}} actions={[
      { label: "Check workspace", title: "Check the workspace files", onClick: () => {} },
      { label: "Details", title: "Show details", active: false, onClick: () => {} },
    ]} /></section>
    <section aria-label="Expandable step" style={{ height: 180 }}><ChatMessages running detailMode="current" messages={[tool]} /></section>
    <section aria-label="Attachments" style={{ height: 160 }}><ChatMessages messages={[{ key: "file", role: "user", text: "Read the report", attachments: [{ name: "report.pdf", mediaType: "application/pdf", url: "https://example.com/report.pdf", size: 20 }] }]} /></section>
    <Markdown text={'[Project guide](https://example.com "Read the project guide")'} />
    <span title="Secondary hint" aria-description="Authored explanation">Existing explanation</span>
    <svg role="img" aria-labelledby="diagram-title"><title id="diagram-title">Project diagram</title><circle cx="10" cy="10" r="5" /></svg>
  </main></QuasselHost>;
}
createRoot(document.getElementById("root")).render(<App />);`, resolveDir: `${root}apps/web`, loader: "tsx" },
    outfile: join(directory, "fixture.js"), bundle: true, format: "iife", platform: "browser", jsx: "automatic",
    plugins: [tailwindPlugin([`${root}apps/web/src`])], logLevel: "silent",
  });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(join(directory, "index.html")).toString());
  const current = page.getByRole("region", { name: "Current step" }).locator('[data-step="chip"]');
  await current.waitFor();
  assert.equal(await current.getAttribute("aria-description"), "Thinking");
  assert.equal(await page.getByRole("button", { name: "Check workspace", exact: true }).getAttribute("aria-description"), "Check the workspace files");
  assert.equal(await page.getByRole("button", { name: "Show details", exact: true }).getAttribute("title"), null);
  const guide = page.getByRole("link", { name: "Project guide" });
  await guide.evaluate((element) => element.setAttribute("title", "Read the project guide"));
  await page.waitForFunction(() => document.querySelector('a[href="https://example.com"]')?.getAttribute("aria-description") === "Read the project guide");
  assert.equal(await guide.getAttribute("aria-description"), "Read the project guide");
  assert.equal(await page.getByText("Existing explanation", { exact: true }).getAttribute("aria-description"), "Authored explanation");
  assert.equal(await page.locator("svg > title").textContent(), "Project diagram");
  assert.equal(await page.locator("[title]").count(), 0);

  await page.evaluate(() => (window as unknown as { foreignMarkup: { stream: () => void } }).foreignMarkup.stream());
  await page.waitForFunction(() => document.querySelector('[aria-label="Current step"] [data-step="chip"]')?.getAttribute("aria-description") === "Tool running");
  await current.evaluate((element) => element.setAttribute("title", "Updated running step"));
  await page.waitForFunction(() => document.querySelector('[aria-label="Current step"] [data-step="chip"]')?.getAttribute("aria-description") === "Updated running step");
  assert.equal(await current.getAttribute("title"), null);

  await page.getByRole("region", { name: "Expandable step" }).locator('[data-step="chip"]').click();
  const popout = page.locator("[data-quassel-popover]");
  await popout.waitFor();
  await popout.evaluate((element) => {
    element.setAttribute("title", "Tool call details");
    const detail = document.createElement("span");
    detail.textContent = "Added portal detail";
    detail.setAttribute("title", "The complete portal explanation");
    element.append(detail);
  });
  await page.waitForFunction(() => document.querySelector("[data-quassel-popover]")?.getAttribute("aria-description") === "Tool call details");
  assert.equal(await popout.getByText("Added portal detail").getAttribute("aria-description"), "The complete portal explanation");
  assert.equal(await page.locator("[title]").count(), 0);
  await popout.getByRole("button", { name: "Close", exact: true }).click();
  await popout.waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
});
