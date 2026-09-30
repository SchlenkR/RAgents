import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { runPanelPageUrl, isClipboardRunPanelMessage, isRunPanelClipboardMessage, isRunPanelHostMessage, isHostRunPanelMessage } from "../../web/src/run-panel/host-contract";
import { errorHtml, frameHtml, panelHtml } from "../src/webview-html";
import { parseServerUrl, parseThemeSetting, resolveTheme } from "../src/settings";

test("the webview hull frames run-panel.html of the server with a strict CSP and relays messages by origin", () => {
  const html = frameHtml({ serverUrl: "http://localhost:4710", query: { run: "run-a", host: "vscode", theme: "dark", access: "t/ok" }, nonce: "n0nce", title: "RAgents" });
  assert.match(html, /frame-src http:\/\/localhost:4710;/);
  assert.match(html, /script-src 'nonce-n0nce'/);
  assert.match(html, /src="http:\/\/localhost:4710\/run-panel.html\?run=run-a&amp;host=vscode&amp;theme=dark&amp;access=t%2Fok"/);
  assert.match(html, /const origin = "http:\/\/localhost:4710";/);
  assert.match(html, /if \(event\.origin !== origin\) return;/);
  assert.doesNotMatch(html, /localhost:4710\/\//);
});

test("the hull reads the clipboard for the framed run panel and keeps that message away from the extension", () => {
  const html = frameHtml({ serverUrl: "http://localhost:4710", query: { host: "vscode" }, nonce: "n0nce", title: "RAgents" });
  assert.match(html, /document\.execCommand\("paste"\)/);
  assert.match(html, /postMessage\(\{ type: "clipboardContent", id, text, files \}, origin\)/);
  assert.match(html, /if \(event\.data && event\.data\.type === "clipboardRead"\) readClipboard\(event\.data\.id\);/);
  assert.match(html, /else vscode\.postMessage\(event\.data\);/);
});

test("clipboard messages are validated on both sides of the hull", () => {
  assert.equal(isRunPanelClipboardMessage({ type: "clipboardRead", id: "1" }), true);
  assert.equal(isRunPanelClipboardMessage({ type: "clipboardRead" }), false);
  assert.equal(isClipboardRunPanelMessage({ type: "clipboardContent", id: "1", text: "", files: [] }), true);
  assert.equal(isClipboardRunPanelMessage({ type: "clipboardContent", id: "1" }), false);
  assert.equal(isClipboardRunPanelMessage({ type: "clipboardContent", id: "1", text: "", files: [new File(["image"], "image.png", { type: "image/png" })] }), true);
  assert.equal(isClipboardRunPanelMessage({ type: "clipboardContent", id: "1", text: "", files: [{}] }), false);
  assert.equal(isRunPanelHostMessage({ type: "clipboardRead", id: "1" }), false);
});

test("clipboard replies restore frame focus before returning text, including an empty clipboard", () => {
  const origin = "http://localhost:4710";
  const html = frameHtml({ serverUrl: origin, query: { host: "vscode" }, nonce: "test", title: "Clipboard" });
  for (const text of ["Pasted text", ""]) {
    const listeners: Array<(event: unknown) => void> = [];
    let focused: unknown;
    const replies: unknown[] = [];
    const field = { value: "", style: {}, addEventListener() {}, setAttribute() {}, focus() { focused = field; }, remove() { focused = undefined; } };
    const frame = {
      focus() { focused = frame; },
      contentWindow: { postMessage(message: unknown, target: string) {
        assert.equal(focused, frame);
        assert.equal(target, origin);
        replies.push(message);
      } },
    };
    const browser = { origin: "vscode-webview://test", addEventListener(_type: string, listener: (event: unknown) => void) { listeners.push(listener); } };
    const document = {
      getElementById: () => frame,
      createElement: () => field,
      body: { appendChild() {} },
      execCommand(command: string) { assert.equal(command, "paste"); assert.equal(focused, field); field.value = text; },
    };
    for (const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
      runInNewContext(script[1], { window: browser, document, acquireVsCodeApi: () => ({ postMessage() { assert.fail("Clipboard requests must stay in the shell."); } }) });
    }
    for (const listener of listeners) listener({ source: frame.contentWindow, origin, data: { type: "clipboardRead", id: "paste" } });
    assert.equal(JSON.stringify(replies), JSON.stringify([{ type: "clipboardContent", id: "paste", text, files: [] }]));
  }
});

test("run panel urls skip undefined parameters and support the app layout", () => {
  assert.equal(runPanelPageUrl("http://localhost:4710/", { layout: "app", run: "r", element: "board--main", host: "vscode" }), "http://localhost:4710/run-panel.html?layout=app&run=r&element=board--main&host=vscode");
  assert.equal(runPanelPageUrl("http://localhost:4710", { run: undefined }), "http://localhost:4710/run-panel.html");
});

test("host messages are validated before they cross the bridge", () => {
  assert.equal(isHostRunPanelMessage({ type: "newRun", entryId: "ragents.reference.board" }), true);
  assert.equal(isHostRunPanelMessage({ type: "newRun", entryId: 3 }), false);
  assert.equal(isRunPanelHostMessage({ type: "openInCenter", runId: "r", elementId: "e", title: "" }), true);
  assert.equal(isRunPanelHostMessage({ type: "openInCenter", runId: "r" }), false);
  assert.equal(isRunPanelHostMessage({ type: "runChanged", runId: null }), true);
  assert.equal(isRunPanelHostMessage({ type: "openPage", url: "http://localhost:5173/", title: "Test bench" }), true);
  assert.equal(isRunPanelHostMessage({ type: "openPage", title: "Test bench" }), false);
  assert.equal(isRunPanelHostMessage({ type: "evil" }), false);
  assert.equal(isHostRunPanelMessage({ type: "theme", theme: "blue" }), false);
});

test("settings are parsed strictly and the theme follows the editor only on auto", () => {
  assert.equal(parseServerUrl(" http://localhost:4710/ "), "http://localhost:4710");
  assert.throws(() => parseServerUrl("localhost:4710"), /http/);
  assert.throws(() => parseServerUrl("http://localhost:4710/app"), /path/);
  assert.equal(parseThemeSetting("dark"), "dark");
  assert.throws(() => parseThemeSetting("blue"), /auto, light, or dark/);
  assert.equal(resolveTheme("auto", "dark"), "dark");
  assert.equal(resolveTheme("light", "dark"), "light");
});

test("the panel page loads the built web page from the extension and embeds the state", () => {
  const state = {
    theme: "dark" as const,
    page: "start" as const,
    connections: [{ name: "core <local>", kind: "profile" as const, address: "/x/ragents.config.core.ts", route: { kind: "profile" as const, profile: "core" }, state: { kind: "stopped" as const }, runs: [], entries: [], canCreate: false }],
    profileSuggestions: [],
  };
  const html = panelHtml({ nonce: "n0nce", title: "RAgents", state, scriptUri: "https://file+.vscode-resource/dist/webview/panel.js", styleUri: "https://file+.vscode-resource/dist/webview/panel.css", cspSource: "https://file+.vscode-resource" });
  assert.match(html, /<html lang="en" data-theme="dark">/);
  assert.match(html, /script-src 'nonce-n0nce'/);
  assert.match(html, /style-src https:\/\/file\+\.vscode-resource/);
  assert.match(html, /<link rel="stylesheet" href="https:\/\/file\+\.vscode-resource\/dist\/webview\/panel\.css">/);
  assert.match(html, /<script type="module" nonce="n0nce" src="https:\/\/file\+\.vscode-resource\/dist\/webview\/panel\.js">/);
  assert.match(html, /<script type="application\/json" id="state">\{"theme":"dark"/);
  assert.match(html, /core \\u003clocal>/);
  assert.doesNotMatch(html, /iframe|frame-src/);
});

test("zoom is applied only by the outer hull and validates the initial setting", () => {
  const options = { serverUrl: "http://localhost:4710", query: { host: "vscode" as const }, nonce: "zoom", title: "RAgents", zoom: 125 };
  const html = frameHtml(options);
  assert.match(html, /--ragents-zoom:1\.25/);
  assert.match(html, /zoom:var\(--ragents-zoom\)/);
  assert.match(html, /height:100%;width:100%/);
  assert.match(html, /event\.data\?\.type !== "ragents.zoom"/);
  assert.throws(() => frameHtml({ ...options, zoom: 0 }), /ragents\.zoom/);
});

test("an invalid setting shows its error instead of an empty view", () => {
  const html = errorHtml({ nonce: "n0nce", title: "RAgents", message: "ragents.zoom must be between 50 and 200 percent, not 300 <b>" });
  assert.match(html, /RAgents: ragents\.zoom must be between 50 and 200 percent, not 300 &lt;b&gt;/);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /<script|<iframe/);
});
