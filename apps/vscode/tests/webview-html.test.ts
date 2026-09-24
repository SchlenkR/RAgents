import assert from "node:assert/strict";
import test from "node:test";
import { runPanelPageUrl, isClipboardRunPanelMessage, isRunPanelClipboardMessage, isRunPanelHostMessage, isHostRunPanelMessage } from "../../web/src/run-panel/host-contract";
import { frameHtml, panelHtml } from "../src/webview-html";
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
  assert.match(html, /postMessage\(\{ type: "clipboardText", id, text \}, origin\)/);
  assert.match(html, /if \(event\.data && event\.data\.type === "clipboardRead"\) readClipboard\(event\.data\.id\);/);
  assert.match(html, /else vscode\.postMessage\(event\.data\);/);
});

test("clipboard messages are validated on both sides of the hull", () => {
  assert.equal(isRunPanelClipboardMessage({ type: "clipboardRead", id: "1" }), true);
  assert.equal(isRunPanelClipboardMessage({ type: "clipboardRead" }), false);
  assert.equal(isClipboardRunPanelMessage({ type: "clipboardText", id: "1", text: "" }), true);
  assert.equal(isClipboardRunPanelMessage({ type: "clipboardText", id: "1" }), false);
  assert.equal(isRunPanelHostMessage({ type: "clipboardRead", id: "1" }), false);
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
  assert.equal(isRunPanelHostMessage({ type: "openPage", url: "http://localhost:5173/", title: "Teststand" }), true);
  assert.equal(isRunPanelHostMessage({ type: "openPage", title: "Teststand" }), false);
  assert.equal(isRunPanelHostMessage({ type: "evil" }), false);
  assert.equal(isHostRunPanelMessage({ type: "placements", runId: "r", center: ["a"] }), true);
  assert.equal(isHostRunPanelMessage({ type: "placements", runId: "r", center: [1] }), false);
  assert.equal(isHostRunPanelMessage({ type: "theme", theme: "blue" }), false);
});

test("settings are parsed strictly and the theme follows the editor only on auto", () => {
  assert.equal(parseServerUrl(" http://localhost:4710/ "), "http://localhost:4710");
  assert.throws(() => parseServerUrl("localhost:4710"), /http/);
  assert.throws(() => parseServerUrl("http://localhost:4710/app"), /Pfad/);
  assert.equal(parseThemeSetting("dark"), "dark");
  assert.throws(() => parseThemeSetting("blue"), /auto, light oder dark/);
  assert.equal(resolveTheme("auto", "dark"), "dark");
  assert.equal(resolveTheme("light", "dark"), "light");
});

test("the panel page loads the built web page from the extension and embeds the state", () => {
  const state = {
    theme: "dark" as const,
    page: "start" as const,
    targets: [{ name: "core <lokal>", kind: "profile" as const, address: "/x/ragents.config.core.ts", route: { kind: "profile" as const, profile: "core" }, state: { kind: "stopped" as const }, runs: [], entries: [], canCreate: false }],
    profileSuggestions: [],
  };
  const html = panelHtml({ nonce: "n0nce", title: "RAgents", state, scriptUri: "https://file+.vscode-resource/dist/webview/panel.js", styleUri: "https://file+.vscode-resource/dist/webview/panel.css", cspSource: "https://file+.vscode-resource" });
  assert.match(html, /<html lang="de" data-theme="dark">/);
  assert.match(html, /script-src 'nonce-n0nce'/);
  assert.match(html, /style-src https:\/\/file\+\.vscode-resource/);
  assert.match(html, /<link rel="stylesheet" href="https:\/\/file\+\.vscode-resource\/dist\/webview\/panel\.css">/);
  assert.match(html, /<script type="module" nonce="n0nce" src="https:\/\/file\+\.vscode-resource\/dist\/webview\/panel\.js">/);
  assert.match(html, /<script type="application\/json" id="state">\{"theme":"dark"/);
  assert.match(html, /core \\u003clokal>/);
  assert.doesNotMatch(html, /iframe|frame-src/);
});
