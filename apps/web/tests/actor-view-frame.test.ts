import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { build } from "esbuild";
import { chromium, type Page } from "playwright-core";
import { frameContentSecurityPolicy } from "../../../plugins/ragents.actor-programs/server/routes.ts";
import { tailwindPlugin } from "./tailwind-plugin";

const bridgeScript = `
const channel = new MessageChannel();
const pending = new Map();
let connected;
const ready = new Promise((resolve) => { connected = resolve; });
channel.port1.onmessage = ({ data }) => {
  if (data.type === 'ragents.app.ready') {
    channel.port1.postMessage({ type: 'ragents.app.connected', version: 1 });
    connected();
  }
  const resolve = pending.get(data.requestId);
  if (resolve) { pending.delete(data.requestId); resolve(data); }
};
channel.port1.start();
window.bridgeRequest = async (request) => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Bridge response timed out: ' + request.requestId)), 3000);
    ready.then(() => {
      pending.set(request.requestId, value => { clearTimeout(timeout); resolve(value); });
      channel.port1.postMessage(request);
    });
  });
};
parent.postMessage({ type: 'ragents.app.frame-ready', version: 1,
  token: new URLSearchParams(location.hash.slice(1)).get('ragentsBridge') }, '*', [channel.port2]);
`;

const frameHtml = `<!doctype html><html><body><p>Bridge-Fixture</p><input aria-label="Frame draft"><script>window.documentIdentity = Math.random();${bridgeScript}</script></body></html>`;

const formNonce = "form-test-nonce";

const formFrameHtml = `<!doctype html><html><body><form id="form"><input aria-label="Search" value="Pump">
<button type="submit">Send</button></form><p id="submissions">0</p><script nonce="${formNonce}">${bridgeScript}
document.getElementById('form').addEventListener('submit', (event) => {
  event.preventDefault();
  const counter = document.getElementById('submissions');
  counter.textContent = String(Number(counter.textContent) + 1);
});
</script></body></html>`;

type BridgeResponse = { type: string; message?: string; invocation?: { result: unknown } };
type ProbeWindow = Window & {
  bridgeRequest: (request: Record<string, unknown>) => Promise<BridgeResponse>;
  invocationRequests: string[];
  invokeDelayMs: number;
  hostBridgeCloseCount: number;
  frameFixture: {
    setActive: (active: boolean) => void;
    setRevision: (revision: string) => void;
    changeInvoke: () => void;
    unmount: () => void;
  };
};

type FrameResponse = { html: string; headers?: Record<string, string>; delayMs?: number };

const openHostFrame = async (context: TestContext, frameResponse: FrameResponse) => {
  const scratch = path.join(tmpdir(), "ragents-frame-request-window");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, "run-"));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    stdin: {
      contents: `
        import { createRoot } from "react-dom/client";
        import { useState } from "react";
        import { PanelActivity } from "./apps/web/src/run-panel/PanelActivity";
        import { ActorViewFrame } from "./plugins/ragents.actor-programs/web/ActorViewFrame";
        import { initializePalette } from "./apps/web/src/palette";
        import { initializeTheme } from "./apps/web/src/theme";
        import "./apps/web/src/ui/tailwind.css";
        initializeTheme(window);
        initializePalette(window);
        const app = { id: "status-view", actorId: "worker", actorHandle: "worker", title: "Status check",
          revision: "installed-revision", actions: [{ id: "status", label: "Status", confirmation: null }],
          state: { version: 1, revision: 1, values: { phase: "working" } }, invocations: [] };
        const api = { frameUrl: (_runId, _appId, revision) => "/frame?revision=" + revision };
        window.invocationRequests = [];
        window.invokeDelayMs = 0;
        window.hostBridgeCloseCount = 0;
        const closePort = MessagePort.prototype.close;
        MessagePort.prototype.close = function () { window.hostBridgeCloseCount += 1; return closePort.call(this); };
        const invoke = async (appId, revision, actionId, requestId, input) => {
          if (appId !== app.id || revision !== window.frameRevision || actionId !== "status") throw new Error("Wrong invocation target");
          window.invocationRequests.push(requestId);
          if (window.invokeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, window.invokeDelayMs));
          return { id: "invocation-" + window.invocationRequests.length, appId, actorId: app.actorId,
            actorHandle: app.actorHandle, revision, actionId, requestId, output: [], result: input,
            status: "succeeded", createdAt: "2026-09-14T10:00:00Z", startedAt: "2026-09-14T10:00:00Z", finishedAt: "2026-09-14T10:00:00Z" };
        };
        const root = createRoot(document.getElementById("root"));
        function Fixture() {
          const [active, setActive] = useState(true);
          const [revision, setRevision] = useState(app.revision);
          const [invokeVersion, setInvokeVersion] = useState(0);
          window.frameRevision = revision;
          window.frameFixture = { setActive, setRevision, changeInvoke: () => setInvokeVersion(value => value + 1), unmount: () => root.unmount() };
          const currentInvoke = invokeVersion === 0 ? invoke : async (...args) => ({ ...(await invoke(...args)), result: "updated callback" });
          return <PanelActivity active={active}><ActorViewFrame api={api} app={{ ...app, revision }}
            invoke={currentInvoke} runId="frame-test" session={{ session: { id: "frame-test" } }} /></PanelActivity>;
        }
        root.render(<Fixture />);
      `,
      resolveDir: root,
      sourcefile: "frame-fixture.tsx",
      loader: "tsx",
    },
    outfile: path.join(directory, "fixture.js"), bundle: true, platform: "browser", format: "esm",
    jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent",
    plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}plugins/ragents.actor-programs/web`])],
  });
  const script = await readFile(path.join(directory, "fixture.js"));
  const styles = await readFile(path.join(directory, "fixture.css"));
  let frameLoads = 0;
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(script); return; }
    if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(styles); return; }
    if (request.url?.startsWith("/frame")) {
      frameLoads += 1;
      const respond = () => {
        response.writeHead(200, { "Content-Type": "text/html", ...frameResponse.headers });
        response.end(frameResponse.html);
      };
      if (frameResponse.delayMs) setTimeout(respond, frameResponse.delayMs);
      else respond();
      return;
    }
    if (request.url !== "/") { response.writeHead(404); response.end(); return; }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><head><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0"><div id="root" style="height:400px;display:flex"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
  context.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: "domcontentloaded" });
  await page.locator("iframe").waitFor();
  context.diagnostic(`Isolated host frame fixture: ${directory}`);
  return { page, errors, consoleErrors, frameLoads: () => frameLoads };
};

const contentFrame = async (page: Page) => {
  const frame = await page.locator("iframe").elementHandle().then((element) => element!.contentFrame());
  assert.ok(frame);
  return frame;
};

test("actor view retains its connected document, draft and current callbacks across Activity hiding", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1",
  timeout: 30_000,
}, async (context) => {
  const { page, errors, frameLoads } = await openHostFrame(context, { html: frameHtml });
  const frame = await contentFrame(page);
  await frame.getByRole("textbox", { name: "Frame draft" }).fill("Keep this draft");
  await frame.evaluate(() => (window as ProbeWindow).bridgeRequest({ type: "ragents.app.get-state", version: 1, requestId: "before-hide" }));
  const identity = await frame.evaluate(() => Reflect.get(window, "documentIdentity"));
  await page.evaluate(() => (window as ProbeWindow).frameFixture.setActive(false));
  await page.locator("iframe").waitFor({ state: "hidden" });
  await page.evaluate(() => (window as ProbeWindow).frameFixture.setActive(true));
  await page.locator("iframe").waitFor({ state: "visible" });
  assert.equal(await frame.getByRole("textbox", { name: "Frame draft" }).inputValue(), "Keep this draft");
  assert.equal(await frame.evaluate(() => Reflect.get(window, "documentIdentity")), identity);
  assert.equal(frameLoads(), 1, "Revealing must not reload the document");
  const resumed = await frame.evaluate(() => (window as ProbeWindow).bridgeRequest({ type: "ragents.app.get-state", version: 1, requestId: "after-hide" }));
  assert.equal(resumed.type, "ragents.app.state");
  await page.evaluate(() => (window as ProbeWindow).frameFixture.changeInvoke());
  const result = await frame.evaluate(() => (window as ProbeWindow).bridgeRequest({ type: "ragents.app.invoke", version: 1, requestId: "current-invoke", actionId: "status", input: null }));
  assert.equal(result.invocation?.result, "updated callback");
  assert.equal(frameLoads(), 1, "Replacing a callback must not reload the document");
  await page.evaluate(() => { (window as ProbeWindow).invokeDelayMs = 300; });
  const pending = frame.evaluate(() => (window as ProbeWindow).bridgeRequest({ type: "ragents.app.invoke", version: 1, requestId: "pending-hide", actionId: "status", input: null }));
  await page.waitForFunction(() => (window as ProbeWindow).invocationRequests.includes("pending-hide"));
  await page.evaluate(() => (window as ProbeWindow).frameFixture.setActive(false));
  await page.locator("iframe").waitFor({ state: "hidden" });
  assert.equal((await pending).invocation?.result, "updated callback", "An in-flight invocation can finish while hidden");
  await page.evaluate(() => (window as ProbeWindow).frameFixture.setActive(true));
  await page.locator("iframe").waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => (window as ProbeWindow).hostBridgeCloseCount), 0);
  await page.evaluate(() => (window as ProbeWindow).frameFixture.setRevision("new-revision"));
  await page.waitForFunction(() => (window as ProbeWindow).hostBridgeCloseCount === 1);
  await frame.getByRole("textbox", { name: "Frame draft" }).waitFor();
  await frame.evaluate(() => (window as ProbeWindow).bridgeRequest({ type: "ragents.app.get-state", version: 1, requestId: "new-revision-state" }));
  assert.equal(frameLoads(), 2, "A changed installed revision loads a fresh document");
  assert.notEqual(await frame.evaluate(() => Reflect.get(window, "documentIdentity")), identity);
  await page.evaluate(() => (window as ProbeWindow).frameFixture.setActive(false));
  await page.locator("iframe").waitFor({ state: "hidden" });
  await page.evaluate(() => (window as ProbeWindow).frameFixture.unmount());
  await page.waitForFunction(() => (window as ProbeWindow).hostBridgeCloseCount === 2);
  assert.equal(await page.locator("iframe").count(), 0);
  assert.deepEqual(errors, []);
});

test("actor view finishes its first bridge while hidden and permits slow document loading", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1",
  timeout: 30_000,
}, async (context) => {
  const { page, errors, frameLoads } = await openHostFrame(context, { html: frameHtml, delayMs: 5_500 });
  await page.evaluate(() => (window as ProbeWindow).frameFixture.setActive(false));
  await page.locator("iframe").waitFor({ state: "hidden" });
  const frame = await contentFrame(page);
  await frame.getByText("Bridge-Fixture", { exact: true }).waitFor({ state: "attached", timeout: 10_000 });
  const result = await frame.evaluate(() => (window as ProbeWindow).bridgeRequest({ type: "ragents.app.get-state", version: 1, requestId: "hidden-state" }));
  assert.equal(result.type, "ragents.app.state");
  await page.evaluate(() => (window as ProbeWindow).frameFixture.setActive(true));
  await page.locator("iframe").waitFor({ state: "visible" });
  assert.equal(await page.getByText("App disconnected", { exact: true }).count(), 0);
  assert.equal(frameLoads(), 1);
  assert.deepEqual(errors, []);
});

test("actor view waits for a slow document before its bridge deadline", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1",
  timeout: 30_000,
}, async (context) => {
  const { page, errors } = await openHostFrame(context, { html: frameHtml, delayMs: 6_000 });
  await page.waitForTimeout(5_200);
  assert.equal(await page.getByText("App disconnected", { exact: true }).count(), 0);
  const frame = await contentFrame(page);
  await frame.getByText("Bridge-Fixture", { exact: true }).waitFor();
  const result = await frame.evaluate(() => (window as ProbeWindow).bridgeRequest({ type: "ragents.app.get-state", version: 1, requestId: "slow-state" }));
  assert.equal(result.type, "ragents.app.state");
  assert.deepEqual(errors, []);
});

test("actor view reports a loaded document without a bridge", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1",
  timeout: 30_000,
}, async (context) => {
  const { page, errors } = await openHostFrame(context, { html: "<!doctype html><p>Missing bridge</p>" });
  await page.getByText("The app did not open a valid host bridge.", { exact: true }).waitFor({ timeout: 10_000 });
  assert.deepEqual(errors, []);
});

test("actor view keeps polling past 512 requests, rejects recent duplicates and disconnects navigation", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1",
  timeout: 30_000,
}, async (context) => {
  const { page, errors } = await openHostFrame(context, { html: frameHtml });
  await page.frameLocator("iframe").getByText("Bridge-Fixture", { exact: true }).waitFor();
  const frame = await contentFrame(page);
  assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts allow-forms allow-downloads");
  assert.equal(await page.locator("iframe").getAttribute("title"), "");
  assert.equal(await page.locator("iframe").getAttribute("aria-label"), "Status check");
  const completed = await frame.evaluate(async () => {
    const probe = window as ProbeWindow;
    for (let index = 0; index < 600; index++) {
      const response = await probe.bridgeRequest({ type: "ragents.app.invoke", version: 1,
        requestId: `poll-${index}`, actionId: "status", input: { index } });
      if (response.type !== "ragents.app.invocation"
        || (response.invocation?.result as { index: number })?.index !== index) {
        throw new Error(`Poll ${index} failed: ${JSON.stringify(response)}`);
      }
    }
    return 600;
  });
  assert.equal(completed, 600);
  const request = (requestId: string, extra: Record<string, unknown> = {}) => frame.evaluate(
    (value) => (window as ProbeWindow).bridgeRequest(value),
    { type: "ragents.app.invoke", version: 1, requestId, actionId: "status", input: null, ...extra },
  );
  for (const id of ["poll-88", "poll-599"]) {
    const duplicate = await request(id);
    assert.equal(duplicate.type, "ragents.app.error");
    assert.match(duplicate.message!, /already been used/);
  }
  assert.equal(await page.evaluate(() => (window as ProbeWindow).invocationRequests.length), 600);
  assert.equal((await request("poll-0")).type, "ragents.app.invocation", "Old IDs leave the bounded history");
  assert.equal((await request("poll-88")).type, "ragents.app.invocation", "Accepting one request evicts exactly the oldest retained ID");
  assert.match((await request("poll-90")).message!, /already been used/);
  assert.match((await request("wrong-version", { version: 2 })).message!, /bridge version/);
  assert.match((await request("oversized", { input: "x".repeat(65_536) })).message!, /too large/);
  assert.match((await request("unknown-action", { actionId: "not-installed" })).message!, /not installed/);
  assert.equal((await request("still-working")).type, "ragents.app.invocation");
  assert.equal(await page.evaluate(() => (window as ProbeWindow).invocationRequests.length), 603);
  await frame.evaluate(() => { location.href = "/frame?replacement" + location.hash; });
  await page.getByText("The app left its installed page and was disconnected.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (window as ProbeWindow).invocationRequests.length), 603);
  assert.deepEqual(errors, []);
});

test("a running action floats over the app after a delay and never resizes it", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1",
  timeout: 30_000,
}, async (context) => {
  const { page, errors } = await openHostFrame(context, { html: frameHtml });
  await page.frameLocator("iframe").getByText("Bridge-Fixture", { exact: true }).waitFor();
  const frame = await contentFrame(page);
  const boxOfFrame = () => page.locator("iframe").boundingBox();
  const before = await boxOfFrame();
  assert.ok(before);
  await page.evaluate(() => {
    const probe = window as ProbeWindow & { chipSeen: boolean };
    probe.chipSeen = false;
    new MutationObserver(() => { probe.chipSeen ||= document.body.textContent?.includes("Starting action") ?? false; })
      .observe(document.body, { childList: true, subtree: true, characterData: true });
    probe.invokeDelayMs = 100;
  });
  await frame.evaluate(() => (window as ProbeWindow).bridgeRequest({ type: "ragents.app.invoke", version: 1, requestId: "short", actionId: "status", input: null }));
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => (window as ProbeWindow & { chipSeen: boolean }).chipSeen), false, "A short action shows no chip");
  await page.evaluate(() => { (window as ProbeWindow).invokeDelayMs = 2000; });
  const long = frame.evaluate(() => (window as ProbeWindow).bridgeRequest({ type: "ragents.app.invoke", version: 1, requestId: "long", actionId: "status", input: null }));
  const chip = page.getByText("Starting action", { exact: true });
  await chip.waitFor();
  assert.deepEqual(await boxOfFrame(), before, "The chip does not change the size of the app");
  assert.equal((await chip.evaluate((element) => getComputedStyle(element.closest("[role=status]")!).pointerEvents)), "none");
  assert.equal((await long).type, "ragents.app.invocation");
  await chip.waitFor({ state: "detached" });
  assert.deepEqual(await boxOfFrame(), before);
  assert.deepEqual(errors, []);
});

test("a form in the host frame submits under the frame sandbox and CSP while native submission stays blocked", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1",
  timeout: 30_000,
}, async (context) => {
  const { page, errors, consoleErrors } = await openHostFrame(context, {
    html: formFrameHtml,
    headers: { "Content-Security-Policy": frameContentSecurityPolicy(formNonce) },
  });
  const frame = page.frameLocator("iframe");
  await frame.getByRole("button", { name: "Send" }).click();
  await frame.getByText("1", { exact: true }).waitFor();
  await frame.getByRole("textbox", { name: "Search" }).press("Enter");
  await frame.getByText("2", { exact: true }).waitFor();
  assert.deepEqual([...errors, ...consoleErrors], []);
  const blocked = page.waitForEvent("console", (message) => message.text().includes("form-action"));
  await (await contentFrame(page)).evaluate(() => {
    const native = Object.assign(document.createElement("form"), { action: "/elsewhere", method: "post" });
    document.body.append(native);
    native.submit();
  });
  await blocked;
  assert.equal(new URL((await contentFrame(page)).url()).pathname, "/frame");
});
