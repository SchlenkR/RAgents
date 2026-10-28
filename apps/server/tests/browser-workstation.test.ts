import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import type { Browser, BrowserContext } from "playwright-core";
import {
  WorkspaceOperationExecutor,
  createUnrestrictedNetworkSandbox,
  executorMachine,
  isolatedWorkstationEnvironment,
  prepareWorkstationFolders,
  workstationAccessRule,
  workstationCacheEnvironment,
  workspaceProcessContext,
} from "@ragents/workspace-executor";
import { BROWSER_OPERATIONS, type BrowserSnapshot, type BrowserStep } from "../../../plugins/ragents.browser/executor/contract.ts";
import { browserModule } from "../../../plugins/ragents.browser/executor/module.ts";
import { assertBrowserSocketPath, browserExecutable, hostPlaywright } from "../../../plugins/ragents.browser/executor/playwright.ts";
import { hostRoot } from "../src/host-version.ts";

const supported = process.platform === "darwin" || process.platform === "linux";

test("an isolated workstation browser keeps its profile in the run, reads and writes only allowed files and reaches loopback", {
  skip: !supported ? "The workstation OS sandbox requires macOS or Linux" : process.env.RAGENTS_BROWSER_TESTS !== "1" ? "Set RAGENTS_BROWSER_TESTS=1 to run real Chromium in the workstation OS sandbox" : false,
  timeout: 90_000,
}, async (t) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-workstation-browser-")));
  const root = path.join(directory, "project");
  const data = path.join(directory, "data", "example-profile");
  const storage = path.join(data, "run-storage", "00000000-0000-0000-0000-000000000001");
  const denied = path.join(directory, "hidden.html");
  const startupHook = path.join(root, "startup.cjs");
  const escaped = path.join(directory, "preload-escaped.txt");
  await mkdir(root, { recursive: true });
  await writeFile(denied, "<!doctype html><title>Private</title><p>private-fixture-value</p>");
  await writeFile(startupHook, `require("node:fs").writeFileSync(${JSON.stringify(escaped)}, "escaped");\n`);
  await writeFile(path.join(root, "allowed.html"), "<!doctype html><title>Allowed</title><p>readable-fixture-value</p>");
  const folders = await prepareWorkstationFolders(storage);
  const machine = executorMachine("/unused");
  const playwright = await hostPlaywright(machine, hostRoot());
  await browserExecutable(playwright);
  const source = isolatedWorkstationEnvironment(process.env);
  const rule = await workstationAccessRule({ root, offered: [root], storage, data: [data], grants: [], environment: source, readable: [hostRoot()] });
  const sandbox = createUnrestrictedNetworkSandbox({ rule, temporary: folders.temporary, environment: source });
  const context = workspaceProcessContext({
    runId: "browser-run", root, cwd: root, home: { home: folders.home }, logDirectory: folders.temporary, hostRoot: hostRoot(),
    source, baseEnvironment: "inherited", accessRule: rule, sandbox, externalAgentEnvironment: process.env,
    additions: { ...workstationCacheEnvironment(folders.home, folders.temporary, source), NODE_OPTIONS: `--require ${JSON.stringify(startupHook)}` },
  });
  const executor = new WorkspaceOperationExecutor({ contextFor: async () => context, modules: [browserModule(machine, { timeoutMs: 30_000 })] });
  const server = createServer((request, response) => {
    if (request.url === "/download") {
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("Content-Disposition", 'attachment; filename="payload.txt"');
      response.end("download-fixture");
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><title>Workstation preview</title><h1>Ready</h1><a href="/download">Download</a>');
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => {
    await executor.shutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  let browser: Browser | undefined;
  let browserContext: BrowserContext | undefined;
  let temporary: string | undefined;
  let profile: string | undefined;
  const persistent = playwright.chromium.launchPersistentContext.bind(playwright.chromium);
  t.mock.method(playwright.chromium, "launchPersistentContext", async (location: string, options: Parameters<typeof persistent>[1]) => {
    assert.equal(options?.chromiumSandbox, false);
    assert.equal(options?.env?.NODE_OPTIONS, undefined);
    temporary = options?.env?.TMPDIR;
    profile = location;
    const opened = await persistent(location, options);
    browser = opened.browser() ?? undefined;
    browserContext = opened;
    return opened;
  });
  const opened = await executor.execute(context.runId, BROWSER_OPERATIONS.navigate, { url: `http://127.0.0.1:${address.port}`, viewport: { width: 800, height: 600 } }) as BrowserStep<BrowserSnapshot>;
  assert.equal(opened.result.title, "Workstation preview");
  assert.match(opened.result.snapshot, /Ready/);
  await assert.rejects(access(escaped), /ENOENT/);
  assert.ok(browser && browserContext && temporary && profile);
  assertBrowserSocketPath(path.join(temporary, "org.chromium.Chromium.XXXXXX", "SingletonSocket"));
  assert.ok(profile.startsWith(folders.temporary + path.sep));
  if (process.platform === "darwin") assert.ok((await realpath(temporary)).startsWith(folders.temporary + path.sep));
  const page = await browserContext.newPage();
  await page.goto(pathToFileURL(path.join(root, "allowed.html")).href);
  assert.match(await page.locator("body").innerText(), /readable-fixture-value/);
  await assert.rejects(page.goto(pathToFileURL(denied).href), /ERR_ACCESS_DENIED|ERR_FILE_NOT_FOUND/);
  assert.equal(await readFile(denied, "utf8"), "<!doctype html><title>Private</title><p>private-fixture-value</p>");
  await page.close();
  const downloadPage = await browserContext.newPage();
  await downloadPage.goto(`http://127.0.0.1:${address.port}`);
  const session = await browser.newBrowserCDPSession();
  const downloadTo = async (destination: string): Promise<string> => {
    await session.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: destination, eventsEnabled: true });
    const finished = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { session.off("Browser.downloadProgress", progress); reject(new Error("The browser download did not end")); }, 10_000);
      const progress = (event: { state: string }): void => {
        if (event.state === "inProgress") return;
        clearTimeout(timer);
        session.off("Browser.downloadProgress", progress);
        resolve(event.state);
      };
      session.on("Browser.downloadProgress", progress);
    });
    await downloadPage.getByRole("link", { name: "Download" }).click();
    return finished;
  };
  const downloads = path.join(root, "downloads");
  const outside = path.join(directory, "outside-downloads");
  await mkdir(outside);
  assert.equal(await downloadTo(downloads), "completed");
  assert.equal(await readFile(path.join(downloads, "payload.txt"), "utf8"), "download-fixture");
  assert.equal(await downloadTo(outside), "canceled");
  await assert.rejects(access(path.join(outside, "payload.txt")), /ENOENT/);
  await executor.stopRun(context.runId);
  assert.equal(browser.isConnected(), false);
  await assert.rejects(access(profile), /ENOENT/);
  if (process.platform === "darwin") await assert.rejects(access(temporary), /ENOENT/);
});
