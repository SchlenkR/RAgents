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
  await ready;
  return new Promise((resolve) => {
    pending.set(request.requestId, resolve);
    channel.port1.postMessage(request);
  });
};
parent.postMessage({ type: 'ragents.app.frame-ready', version: 1,
  token: new URLSearchParams(location.hash.slice(1)).get('ragentsBridge') }, '*', [channel.port2]);
`;

const frameHtml = `<!doctype html><html><body><p>Bridge-Fixture</p><script>${bridgeScript}</script></body></html>`;

const formNonce = "form-test-nonce";

const formFrameHtml = `<!doctype html><html><body><form id="form"><input aria-label="Suche" value="Pumpe">
<button type="submit">Senden</button></form><p id="submissions">0</p><script nonce="${formNonce}">${bridgeScript}
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
};

type FrameResponse = { html: string; headers?: Record<string, string> };

const openHostFrame = async (context: TestContext, frameResponse: FrameResponse) => {
  const scratch = path.join(tmpdir(), "ragents-frame-request-window");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, "run-"));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    stdin: {
      contents: `
        import { createRoot } from "react-dom/client";
        import { ActorViewFrame } from "./plugins/ragents.actor-programs/web/ActorViewFrame";
        import { initializeTheme } from "./apps/web/src/theme";
        initializeTheme(window);
        const app = { id: "status-view", actorId: "worker", actorHandle: "worker", title: "Statusprüfung",
          revision: "installed-revision", actions: [{ id: "status", label: "Status", confirmation: null }],
          placements: [], state: { version: 1, revision: 1, values: { phase: "working" } }, invocations: [] };
        const api = { frameUrl: () => "/frame" };
        window.invocationRequests = [];
        const invoke = async (appId, revision, actionId, requestId, input) => {
          if (appId !== app.id || revision !== app.revision || actionId !== "status") throw new Error("Wrong invocation target");
          window.invocationRequests.push(requestId);
          return { id: "invocation-" + window.invocationRequests.length, appId, actorId: app.actorId,
            actorHandle: app.actorHandle, revision, actionId, requestId, output: [], result: input,
            status: "succeeded", createdAt: "2026-09-14T10:00:00Z", startedAt: "2026-09-14T10:00:00Z", finishedAt: "2026-09-14T10:00:00Z" };
        };
        createRoot(document.getElementById("root")).render(<ActorViewFrame api={api} app={app}
          invoke={invoke} presentation="embedded" runId="frame-test" session={{ session: { id: "frame-test" } }} />);
      `,
      resolveDir: root,
      sourcefile: "frame-fixture.tsx",
      loader: "tsx",
    },
    outfile: path.join(directory, "fixture.js"), bundle: true, platform: "browser", format: "esm",
    jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent",
  });
  const script = await readFile(path.join(directory, "fixture.js"));
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(script); return; }
    if (request.url?.startsWith("/frame")) {
      response.writeHead(200, { "Content-Type": "text/html", ...frameResponse.headers });
      response.end(frameResponse.html);
      return;
    }
    if (request.url !== "/") { response.writeHead(404); response.end(); return; }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
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
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.locator("iframe").waitFor();
  context.diagnostic(`Isolierte Hostframe-Fixture: ${directory}`);
  return { page, errors, consoleErrors };
};

const contentFrame = async (page: Page) => {
  const frame = await page.locator("iframe").elementHandle().then((element) => element!.contentFrame());
  assert.ok(frame);
  return frame;
};

test("actor view keeps polling past 512 requests, rejects recent duplicates and disconnects navigation", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1",
  timeout: 30_000,
}, async (context) => {
  const { page, errors } = await openHostFrame(context, { html: frameHtml });
  await page.frameLocator("iframe").getByText("Bridge-Fixture", { exact: true }).waitFor();
  const frame = await contentFrame(page);
  assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts allow-forms allow-downloads");
  assert.equal(await page.locator("iframe").getAttribute("title"), "");
  assert.equal(await page.locator("iframe").getAttribute("aria-label"), "Statusprüfung");
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
    assert.match(duplicate.message!, /bereits verwendet/);
  }
  assert.equal(await page.evaluate(() => (window as ProbeWindow).invocationRequests.length), 600);
  assert.equal((await request("poll-0")).type, "ragents.app.invocation", "Old IDs leave the bounded history");
  assert.equal((await request("poll-88")).type, "ragents.app.invocation", "Accepting one request evicts exactly the oldest retained ID");
  assert.match((await request("poll-90")).message!, /bereits verwendet/);
  assert.match((await request("wrong-version", { version: 2 })).message!, /Bridge-Version/);
  assert.match((await request("oversized", { input: "x".repeat(65_536) })).message!, /zu groß/);
  assert.match((await request("unknown-action", { actionId: "not-installed" })).message!, /nicht installiert/);
  assert.equal((await request("still-working")).type, "ragents.app.invocation");
  assert.equal(await page.evaluate(() => (window as ProbeWindow).invocationRequests.length), 603);
  await frame.evaluate(() => { location.href = "/frame?replacement" + location.hash; });
  await page.getByText("Die App hat ihre installierte Seite verlassen und wurde getrennt.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (window as ProbeWindow).invocationRequests.length), 603);
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
  await frame.getByRole("button", { name: "Senden" }).click();
  await frame.getByText("1", { exact: true }).waitFor();
  await frame.getByRole("textbox", { name: "Suche" }).press("Enter");
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
