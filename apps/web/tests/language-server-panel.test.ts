import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildSync } from "esbuild";
import type { LanguageServerSnapshot } from "../../server/src/plugin-support/language-server/contract";

const module = { exports: {} };
const bundle = buildSync({
  entryPoints: [fileURLToPath(new URL("../../../plugins/ragents.lsp-roslyn/web/language-server-plugin.tsx", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic",
  loader: { ".css": "empty" }, external: ["react", "react-dom"],
}).outputFiles[0].text;
vm.runInNewContext(bundle, { module, exports: module.exports, process, require: createRequire(import.meta.url) });
const { LanguageServerPanelView } = module.exports as typeof import("../../../plugins/ragents.lsp-roslyn/web/language-server-plugin");
const snapshot = (overrides: Partial<LanguageServerSnapshot> = {}): LanguageServerSnapshot => ({ state: "ready", root: "/workspace/project", summary: null, files: [], ...overrides });
const render = (state: LanguageServerSnapshot) => renderToStaticMarkup(createElement(LanguageServerPanelView, {
  settings: { label: "Language Server", openTool: "language_open" }, snapshot: state, pending: false, onRefresh: () => {},
}));
const staleFiles = [{ path: "old.ts", diagnostics: [{ line: 1, character: 1, severity: "error" as const, message: "Veraltete Diagnose" }] }];

test("opening language server shows progress without claiming successful diagnostics", () => {
  for (const files of [[], [{ path: "main.ts", diagnostics: [] }], staleFiles]) {
    const html = render(snapshot({ state: "opening", summary: "Arbeitsbereich wird geladen.", files }));
    assert.match(html, /role="status"/);
    assert.match(html, /Sprachserver wird geladen/);
    assert.match(html, /Arbeitsbereich wird geladen/);
    assert.match(html, /\/workspace\/project/);
    assert.doesNotMatch(html, /Keine Diagnosen|fehlerfrei|Veraltete Diagnose|Kein Sprachserver|Warnungen in/);
  }
});

test("failed language server shows its concrete error instead of a closed or successful state", () => {
  const html = render(snapshot({ state: "failed", summary: "Initialisierung abgebrochen: Datei <project> fehlt.\nBitte den Pfad prüfen.", files: staleFiles }));
  assert.match(html, /fehlgeschlagen/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Sprachserver nicht verfügbar/);
  assert.match(html, /Initialisierung abgebrochen: Datei &lt;project&gt; fehlt/);
  assert.match(html, /Bitte den Pfad prüfen/);
  assert.match(html, /aria-label="Diagnosen aktualisieren"/);
  assert.doesNotMatch(html, /nicht gestartet|Kein Sprachserver|Keine Diagnosen|fehlerfrei|Veraltete Diagnose/);
});

test("ready language server distinguishes an uninspected workspace from inspected clean files", () => {
  assert.match(render(snapshot()), /Bisher wurde keine Datei geprüft/);
  assert.match(render(snapshot({ files: [{ path: "main.ts", diagnostics: [] }] })), /Alle geprüften Dateien sind fehlerfrei/);
  const html = render(snapshot({ files: staleFiles }));
  assert.match(html, /1 Fehler, 0 Warnungen in 1 Datei/);
  assert.match(html, /Veraltete Diagnose/);
  assert.doesNotMatch(html, /Keine Diagnosen/);
});

test("closed and suspended language servers retain their distinct existing states", () => {
  const closed = render(snapshot({ state: "closed", root: null }));
  assert.match(closed, /nicht gestartet/);
  assert.match(closed, /Kein Sprachserver/);
  assert.match(closed, /language_open/);
  assert.doesNotMatch(closed, /Keine Diagnosen|fehlerfrei/);
  const suspended = render(snapshot({ state: "suspended", files: staleFiles }));
  assert.match(suspended, /nach Leerlauf beendet/);
  assert.match(suspended, /Veraltete Diagnose/);
});
