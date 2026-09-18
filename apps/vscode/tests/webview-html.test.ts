import assert from "node:assert/strict";
import test from "node:test";
import { columnPageUrl, isColumnHostMessage, isHostColumnMessage } from "../../web/src/column/host-contract";
import { frameHtml, noticeHtml } from "../src/webview-html";
import { parseServerUrl, parseThemeSetting, resolveTheme } from "../src/settings";

test("the webview hull frames column.html of the server with a strict CSP and relays messages by origin", () => {
  const html = frameHtml({ serverUrl: "http://localhost:4710", query: { run: "run-a", host: "vscode", theme: "dark", access: "t/ok" }, nonce: "n0nce", title: "RAgents" });
  assert.match(html, /frame-src http:\/\/localhost:4710;/);
  assert.match(html, /script-src 'nonce-n0nce'/);
  assert.match(html, /src="http:\/\/localhost:4710\/column.html\?run=run-a&amp;host=vscode&amp;theme=dark&amp;access=t%2Fok"/);
  assert.match(html, /const origin = "http:\/\/localhost:4710";/);
  assert.match(html, /if \(event\.origin === origin\) vscode\.postMessage\(event\.data\);/);
  assert.doesNotMatch(html, /localhost:4710\/\//);
});

test("the notice hull shows heading and lines without any frame", () => {
  const html = noticeHtml({ nonce: "n0nce", title: "RAgents", heading: "Kein Server erreichbar", lines: ["Unter http://localhost:4710 antwortet kein RAgents-Server: fetch failed", "<b>"] });
  assert.match(html, /<h1>Kein Server erreichbar<\/h1>/);
  assert.match(html, /antwortet kein RAgents-Server: fetch failed/);
  assert.match(html, /&lt;b&gt;/);
  assert.doesNotMatch(html, /iframe|frame-src|script-src/);
});

test("column urls skip undefined parameters and support the app layout", () => {
  assert.equal(columnPageUrl("http://localhost:4710/", { layout: "app", run: "r", element: "board--main", host: "vscode" }), "http://localhost:4710/column.html?layout=app&run=r&element=board--main&host=vscode");
  assert.equal(columnPageUrl("http://localhost:4710", { run: undefined }), "http://localhost:4710/column.html");
});

test("host messages are validated before they cross the bridge", () => {
  assert.equal(isColumnHostMessage({ type: "openInCenter", runId: "r", elementId: "e", title: "" }), true);
  assert.equal(isColumnHostMessage({ type: "openInCenter", runId: "r" }), false);
  assert.equal(isColumnHostMessage({ type: "runChanged", runId: null }), true);
  assert.equal(isColumnHostMessage({ type: "openPage", url: "http://localhost:5173/", title: "Teststand" }), true);
  assert.equal(isColumnHostMessage({ type: "openPage", title: "Teststand" }), false);
  assert.equal(isColumnHostMessage({ type: "evil" }), false);
  assert.equal(isHostColumnMessage({ type: "placements", runId: "r", center: ["a"] }), true);
  assert.equal(isHostColumnMessage({ type: "placements", runId: "r", center: [1] }), false);
  assert.equal(isHostColumnMessage({ type: "theme", theme: "blue" }), false);
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
