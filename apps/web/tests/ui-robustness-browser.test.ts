import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const fixture = `
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceTabPanel } from "./apps/web/src/run-panel/WorkspaceTabPanel";
import { PluginSessionProviders } from "./apps/web/src/PluginRegistry";
import { PanelActivity } from "./apps/web/src/run-panel/PanelActivity";
import { FileBrowserPanel } from "./plugins/ragents.workspace/web/FileBrowser";
window.probe = { requests: [] };
const navigation = { activeTabId: "files", openTab: () => {}, revealEntity: () => false, selectionFor: () => undefined };
function Panel({ selection }) {
  useEffect(() => { if (selection === "effect") throw Error("Neutral panel effect failed"); }, [selection]);
  if (selection === "render") throw Error("Neutral panel render failed");
  return <p>Healthy panel</p>;
}
function Provider({ children, session }) {
  if (session.runView.fail) throw Error("Neutral provider render failed");
  return children;
}
const registry = { activePlugins: [{ id: "acme.probe", SessionProvider: Provider }], presenterFor: () => undefined, actionViewFor: () => undefined };
function Fixture() {
  const [failure, setFailure] = useState("");
  const [run, setRun] = useState("run-a");
  const [active, setActive] = useState(true);
  const [count, setCount] = useState(0);
  window.probe.setFailure = setFailure;
  window.probe.setRun = setRun;
  window.probe.setActive = setActive;
  const session = { session: { id: run }, runView: { fail: failure }, messages: [] };
  const kind = new URLSearchParams(location.search).get("kind");
  return <><button onClick={() => setCount(value => value + 1)}>Independent shell {count}</button>
    {kind === "provider" ? <PluginSessionProviders registry={registry} navigation={navigation} session={session}><p>Chat composer</p></PluginSessionProviders> : kind === "files" ?
      <PanelActivity active={active}><FileBrowserPanel active={active} session={session} navigation={navigation} /></PanelActivity> :
      <><p>Chat composer</p><WorkspaceTabPanel Panel={Panel} active session={session} navigation={navigation} selection={failure} /></>}
  </>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
`;

type PreviewRequest = { signal: AbortSignal; runId: string; root: string; path: string; resolve: (value: unknown) => void; reject: (error: Error) => void };
type ProbeWindow = Window & { probe: {
  requests: PreviewRequest[];
  setFailure: (failure: string) => void;
  setRun: (run: string) => void;
  setActive: (active: boolean) => void;
} };

const request = (runId: string, root: string, file: string, content: string) => ({ runId, root, path: file, content });

test("plugin render failures stay local and stale file previews cannot replace the current selection", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-ui-robustness-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ stdin: { contents: fixture, resolveDir: root, sourcefile: "fixture.tsx", loader: "tsx" },
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"), logLevel: "silent",
    plugins: [{ name: "deferred-workspace", setup(builder) {
      builder.onResolve({ filter: /^\.\/api$/ }, (args) => args.importer.endsWith("/FileBrowser.tsx") ? { path: "api", namespace: "fixture-api" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture-api" }, () => ({ loader: "js", contents: `
        export const fetchBrowseListing = async (runId, root, path) => ({ root, path, location: "Example workspace", truncated: false,
          entries: ["a.txt", "b.txt", "c.txt"].map(name => ({ name, kind: "file", size: 1, modifiedAt: "2026-01-01" })) });
        export const fetchBrowsePreview = (runId, root, path, signal) => new Promise((resolve, reject) => window.probe.requests.push({ runId, root, path, signal, resolve, reject }));
      ` }));
      builder.onResolve({ filter: /^@ragents\/web\/rpc$/ }, () => ({ path: "rpc", namespace: "fixture-rpc" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture-rpc" }, () => ({ loader: "js", contents: "export const rpc = { subscribe: () => () => {}, call: async () => ({}) };" }));
    } }],
  });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const url = pathToFileURL(join(directory, "index.html")).href;

  for (const failure of ["render", "effect"]) {
    await page.goto(`${url}?kind=panel`);
    await page.getByText("Healthy panel", { exact: true }).waitFor();
    await page.evaluate((failure) => (window as ProbeWindow).probe.setFailure(failure), failure);
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").innerText(), /Neutral panel (render|effect) failed/);
    await page.getByText("Chat composer", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Independent shell 0", exact: true }).click();
    await page.getByRole("button", { name: "Independent shell 1", exact: true }).waitFor();
    await page.evaluate(() => (window as ProbeWindow).probe.setFailure(""));
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.getByText("Healthy panel", { exact: true }).waitFor();
    await page.evaluate(() => (window as ProbeWindow).probe.setFailure("render"));
    await page.getByRole("alert").waitFor();
    await page.evaluate(() => { (window as ProbeWindow).probe.setFailure(""); (window as ProbeWindow).probe.setRun("run-b"); });
    await page.getByText("Healthy panel", { exact: true }).waitFor();
  }
  await page.goto(`${url}?kind=provider`);
  await page.getByText("Chat composer", { exact: true }).waitFor();
  await page.evaluate(() => (window as ProbeWindow).probe.setFailure("render"));
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /Neutral provider render failed/);
  assert.equal(await page.getByText("Chat composer", { exact: true }).count(), 0, "a broken required provider is not bypassed");
  await page.getByRole("button", { name: "Independent shell 0", exact: true }).click();
  await page.getByRole("button", { name: "Independent shell 1", exact: true }).waitFor();
  await page.evaluate(() => { (window as ProbeWindow).probe.setFailure(""); (window as ProbeWindow).probe.setRun("run-c"); });
  await page.getByText("Chat composer", { exact: true }).waitFor();

  await page.goto(`${url}?kind=files`);
  const click = (file: string) => page.getByRole("button", { name: new RegExp(`^${file.replace(".", "\\.")}`) }).click();
  const resolve = (value: ReturnType<typeof request>) => page.evaluate((value) => {
    for (const pending of (window as ProbeWindow).probe.requests.filter((pending) => pending.runId === value.runId && pending.root === value.root && pending.path === value.path)) {
      pending.resolve({ root: value.root, path: value.path, size: 1, previewable: true, content: value.content });
    }
  }, value);
  await click("a.txt");
  await click("b.txt");
  assert.deepEqual(await page.evaluate(() => (window as ProbeWindow).probe.requests.map((request) => request.path)), ["a.txt", "b.txt"], "one request owns each selected preview");
  assert.deepEqual(await page.evaluate(() => (window as ProbeWindow).probe.requests.map((request) => request.signal.aborted)), [true, false], "selection cancels its obsolete request");
  await resolve(request("run-a", "workspace", "b.txt", "Current B content"));
  await page.getByText("Current B content", { exact: true }).waitFor();
  assert.equal(await page.getByText("Loading preview...", { exact: true }).count(), 0);
  await resolve(request("run-a", "workspace", "a.txt", "Stale A content"));
  assert.equal(await page.getByText("Stale A content", { exact: true }).count(), 0);
  await page.evaluate(() => (window as ProbeWindow).probe.setActive(false));
  await page.getByRole("button", { name: /^b\.txt/ }).waitFor({ state: "hidden" });
  await page.evaluate(() => (window as ProbeWindow).probe.setActive(true));
  await page.getByText("Current B content", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (window as ProbeWindow).probe.requests.length), 2, "hide/reveal retains the loaded preview");

  await click("c.txt");
  await page.getByText("Loading preview...", { exact: true }).waitFor();
  await page.evaluate(() => (window as ProbeWindow).probe.requests.at(-1)!.reject(new Error("Neutral preview failed")));
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("alert").innerText(), "Neutral preview failed");
  assert.equal(await page.getByText("Loading preview...", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Refresh files", exact: true }).click();
  await page.waitForFunction(() => (window as ProbeWindow).probe.requests.length === 4);
  await page.evaluate(() => (window as ProbeWindow).probe.setRun("run-b"));
  await click("a.txt");
  await resolve(request("run-a", "workspace", "c.txt", "Old run content"));
  assert.equal(await page.getByText("Old run content", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "File storage", exact: true }).click();
  await click("b.txt");
  await resolve(request("run-b", "workspace", "a.txt", "Old root content"));
  await resolve(request("run-b", "files", "b.txt", "Current file storage content"));
  await page.getByText("Current file storage content", { exact: true }).waitFor();
  assert.equal(await page.getByText("Old root content", { exact: true }).count(), 0);
  await click("c.txt");
  const beforeHide = await page.evaluate(() => (window as ProbeWindow).probe.requests.length);
  await page.evaluate(() => (window as ProbeWindow).probe.setActive(false));
  await page.getByRole("button", { name: /^c\.txt/ }).waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => (window as ProbeWindow).probe.requests.at(-1)!.signal.aborted), true, "Activity hiding cancels in-flight preview work");
  await resolve(request("run-b", "files", "c.txt", "Hidden stale content"));
  await page.evaluate(() => (window as ProbeWindow).probe.setActive(true));
  await page.waitForFunction((count) => (window as ProbeWindow).probe.requests.length === count + 1, beforeHide);
  await resolve(request("run-b", "files", "c.txt", "Current revealed content"));
  await page.getByText("Current revealed content", { exact: true }).waitFor();
  assert.equal(await page.getByText("Hidden stale content", { exact: true }).count(), 0);
  assert.deepEqual(errors, [], "caught lifecycle errors do not reach the browser error event");
});
