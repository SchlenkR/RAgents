import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { frameContentSecurityPolicy, frameHtml } from "../../../plugins/ragents.actor-programs/server/routes.ts";
import { tailwindPlugin } from "./tailwind-plugin";

const nonce = "display-test-nonce";

/** A view that renders its state and tries a function, as an app author would write it. */
const client = `
const context = globalThis.__ragentsAppContext;
const root = document.getElementById("root");
const count = document.createElement("p");
const outcome = document.createElement("p");
const add = document.createElement("button");
add.textContent = "Add";
add.addEventListener("click", () => context.capabilities.call("add", {}).then(() => { outcome.textContent = "Called"; }, (error) => { outcome.textContent = error.message; }));
root.append(count, add, outcome);
const show = (state) => { count.textContent = "Count " + (state.count ?? 0); };
show(context.state.read());
context.state.subscribe(show);
`;

/** A frame that talks to the host bridge directly, past the SDK. */
const rawFrame = `<!doctype html><html><body><p>Raw frame</p><script>
const channel = new MessageChannel();
const pending = new Map();
let connected;
const ready = new Promise((resolve) => { connected = resolve; });
channel.port1.onmessage = ({ data }) => {
  if (data.type === "ragents.app.ready") { channel.port1.postMessage({ type: "ragents.app.connected", version: 1 }); connected(); }
  const resolve = pending.get(data.requestId);
  if (resolve) { pending.delete(data.requestId); resolve(data); }
};
channel.port1.start();
window.bridgeRequest = (request) => ready.then(() => new Promise((resolve) => { pending.set(request.requestId, resolve); channel.port1.postMessage(request); }));
parent.postMessage({ type: "ragents.app.frame-ready", version: 1, token: new URLSearchParams(location.hash.slice(1)).get("ragentsBridge") }, "*", [channel.port2]);
</script></body></html>`;

test("a display shows the app's live state in its real frame, refuses every call, and turns calm when access ends", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1",
  timeout: 60_000,
}, async (context) => {
  const scratch = path.join(tmpdir(), "ragents-app-display");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, "run-"));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    stdin: {
      contents: `
        import { createRoot } from "react-dom/client";
        import { useState } from "react";
        import { AppDisplayView } from "./plugins/ragents.actor-programs/web/AppDisplays";
        import { initializeAppearance } from "./apps/web/src/appearance";
        import { initializeTheme } from "./apps/web/src/theme";
        import "./apps/web/src/ui/tailwind.css";
        initializeTheme(window);
        initializeAppearance(window);
        const app = (count) => ({ id: "board--main", actorId: "board-actor", actorHandle: "planning.board", title: "Board", revision: "installed",
          actions: [], invocations: [], state: { version: 1, revision: count, values: { count } } });
        const ready = (count) => ({ status: "ready", title: "Board", from: 'Run "Planning"', runId: "source-run", app: app(count) });
        function Fixture() {
          const [snapshot, setSnapshot] = useState(ready(0));
          window.displayFixture = { count: (value) => setSnapshot(ready(value)), deny: () => setSnapshot({ status: "denied", title: "Board", from: null, message: "This app is not available to you." }) };
          return <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", height: "100%", width: "100%" }}>
            <section aria-label="Display" style={{ display: "flex", minHeight: 0 }}>
              <AppDisplayView api={{ frameUrl: (runId, _appId, revision) => "/frame?run=" + runId + "&revision=" + revision }} title="Board (read-only)" snapshot={snapshot}
                error={undefined} onRetry={() => undefined} onRemove={undefined} removal={{ pending: false }} />
            </section>
            <section aria-label="Raw" style={{ display: "flex", minHeight: 0 }}>
              <AppDisplayView api={{ frameUrl: () => "/raw-frame" }} title="Raw (read-only)" snapshot={ready(0)}
                error={undefined} onRetry={() => undefined} onRemove={undefined} removal={{ pending: false }} />
            </section>
          </div>;
        }
        createRoot(document.getElementById("root")).render(<Fixture />);
      `,
      resolveDir: root,
      sourcefile: "display-fixture.tsx",
      loader: "tsx",
    },
    outfile: path.join(directory, "fixture.js"), bundle: true, platform: "browser", format: "esm",
    jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent",
    plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}plugins/ragents.actor-programs/web`])],
  });
  const script = await readFile(path.join(directory, "fixture.js"));
  const styles = await readFile(path.join(directory, "fixture.css"));
  const page = frameHtml({ html: '<!doctype html><html><head></head><body><div id="root"></div></body></html>', styles: "", clientJavaScript: client, platformVersion: 2 }, nonce);
  const loads: string[] = [];
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(script); return; }
    if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(styles); return; }
    if (request.url?.startsWith("/frame")) {
      loads.push(request.url);
      response.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": frameContentSecurityPolicy(nonce) });
      response.end(page);
      return;
    }
    if (request.url === "/raw-frame") { response.setHeader("Content-Type", "text/html"); response.end(rawFrame); return; }
    if (request.url !== "/") { response.writeHead(404); response.end(); return; }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><head><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0"><div id="root" style="height:640px;display:flex"></div><script type="module" src="/fixture.js"></script></body></html>');
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
  const tab = await browser.newPage();
  tab.setDefaultTimeout(10_000);
  const errors: string[] = [];
  tab.on("pageerror", (error) => errors.push(error.message));
  await tab.goto(`http://127.0.0.1:${address.port}`, { waitUntil: "domcontentloaded" });

  const display = tab.getByRole("region", { name: "Display" });
  await display.getByText("Read-only", { exact: true }).waitFor();
  await display.getByText('From Run "Planning"', { exact: true }).waitFor();
  const frame = display.frameLocator("iframe");
  await frame.getByText("Count 0", { exact: true }).waitFor();
  assert.deepEqual(loads, ["/frame?run=source-run&revision=installed"], "the frame comes from the app's own run");

  await tab.evaluate(() => (window as unknown as { displayFixture: { count: (value: number) => void } }).displayFixture.count(2));
  await frame.getByText("Count 2", { exact: true }).waitFor();
  assert.equal(loads.length, 1, "a new state reaches the open frame without reloading it");

  await frame.getByRole("button", { name: "Add" }).click();
  await frame.getByText("This app is shown read-only; it calls no functions here.", { exact: true }).waitFor();

  const raw = await tab.getByRole("region", { name: "Raw" }).locator("iframe").elementHandle().then((element) => element!.contentFrame());
  assert.ok(raw);
  await raw.getByText("Raw frame", { exact: true }).waitFor();
  const refused = await raw.evaluate(() => (window as unknown as { bridgeRequest: (request: unknown) => Promise<{ type: string; message?: string }> })
    .bridgeRequest({ type: "ragents.app.invoke", version: 1, requestId: "past-the-sdk", actionId: "add", input: {} }));
  assert.deepEqual(refused, { type: "ragents.app.error", version: 1, requestId: "past-the-sdk", message: "This app is shown read-only; it calls no functions here." });
  assert.equal(await tab.getByText("Action failed", { exact: true }).count(), 0, "a refused call is no failure of the window");

  await tab.evaluate(() => (window as unknown as { displayFixture: { deny: () => void } }).displayFixture.deny());
  await display.getByText("This app is not available to you.", { exact: true }).waitFor();
  assert.equal(await display.locator("iframe").count(), 0);
  assert.equal(await display.getByRole("alert").count(), 0);
  assert.deepEqual(errors, []);
});
