import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildSync } from "esbuild";
import type {
  LanguageServerInstanceSnapshot,
  LanguageServerSnapshot,
  LanguageServerSolutions,
} from "../../server/src/plugin-support/language-server/contract";

const module = { exports: {} };
const bundle = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/language-server/language-server-plugin.tsx", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic",
  loader: { ".css": "empty" }, external: ["react", "react-dom"],
}).outputFiles[0].text;
vm.runInNewContext(bundle, { module, exports: module.exports, process, require: createRequire(import.meta.url), TextDecoder, TextEncoder });
const { LanguageServerPanelView } = module.exports as typeof import("../src/language-server/language-server-plugin");
const instance = (overrides: Partial<LanguageServerInstanceSnapshot> = {}): LanguageServerInstanceSnapshot =>
  ({ state: "ready", root: "/workspace/project", summary: null, files: [], ...overrides });
const render = (state: LanguageServerSnapshot) => renderToStaticMarkup(createElement(LanguageServerPanelView, {
  settings: { label: "Language Server", openTool: "language_open" }, snapshot: state, pending: false, onRefresh: () => {},
}));
const one = (overrides: Partial<LanguageServerInstanceSnapshot> = {}) => render({ instances: [instance(overrides)] });
const staleFiles = [{ path: "old.ts", diagnostics: [{ line: 1, character: 1, severity: "error" as const, message: "Veraltete Diagnose" }] }];

test("opening language server shows progress without claiming successful diagnostics", () => {
  for (const files of [[], [{ path: "main.ts", diagnostics: [] }], staleFiles]) {
    const html = one({ state: "opening", summary: "Arbeitsbereich wird geladen.", files });
    assert.match(html, /role="status"/);
    assert.match(html, /Sprachserver wird geladen/);
    assert.match(html, /Arbeitsbereich wird geladen/);
    assert.match(html, /\/workspace\/project/);
    assert.doesNotMatch(html, /Keine Diagnosen|fehlerfrei|Veraltete Diagnose|Kein Sprachserver|Warnungen in/);
  }
});

test("failed language server shows its concrete error instead of a closed or successful state", () => {
  const html = one({ state: "failed", summary: "Initialisierung abgebrochen: Datei <project> fehlt.\nBitte den Pfad prüfen.", files: staleFiles });
  assert.match(html, /fehlgeschlagen/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Sprachserver nicht verfügbar/);
  assert.match(html, /Initialisierung abgebrochen: Datei &lt;project&gt; fehlt/);
  assert.match(html, /Bitte den Pfad prüfen/);
  assert.match(html, /aria-label="Diagnosen aktualisieren"/);
  assert.doesNotMatch(html, /nicht gestartet|Kein Sprachserver|Keine Diagnosen|fehlerfrei|Veraltete Diagnose/);
});

test("ready language server distinguishes an uninspected workspace from inspected clean files", () => {
  assert.match(one(), /Bisher wurde keine Datei geprüft/);
  assert.match(one({ files: [{ path: "main.ts", diagnostics: [] }] }), /Alle geprüften Dateien sind fehlerfrei/);
  const html = one({ files: staleFiles });
  assert.match(html, /1 Fehler, 0 Warnungen in 1 Datei/);
  assert.match(html, /Veraltete Diagnose/);
  assert.doesNotMatch(html, /Keine Diagnosen/);
});

test("a run without instances and a suspended instance keep their distinct existing states", () => {
  const empty = render({ instances: [] });
  assert.match(empty, /nicht gestartet/);
  assert.match(empty, /Kein Sprachserver/);
  assert.match(empty, /language_open/);
  assert.doesNotMatch(empty, /Keine Diagnosen|fehlerfrei/);
  const suspended = one({ state: "suspended", files: staleFiles });
  assert.match(suspended, /nach Leerlauf beendet/);
  assert.match(suspended, /Veraltete Diagnose/);
});

test("every open root of the run gets its own card with root, state and diagnostics", () => {
  const html = render({
    instances: [
      instance({ root: "/workspace/eins", summary: "Eins geladen", files: staleFiles }),
      instance({ root: "/workspace/zwei", state: "failed", summary: "Zwei ist kaputt" }),
    ],
  });
  assert.match(html, /2 Instanzen/);
  assert.match(html, /\/workspace\/eins/);
  assert.match(html, /\/workspace\/zwei/);
  assert.match(html, /Veraltete Diagnose/);
  assert.match(html, /Zwei ist kaputt/);
  assert.match(html, /1 Fehler, 0 Warnungen in 1 Datei/);
  assert.doesNotMatch(html, /Kein Sprachserver/);
  assert.match(render({ instances: [instance()] }), /1 Instanz/);
});

const solutions: LanguageServerSolutions = {
  source: "git",
  solutions: [
    { path: "src/Demo.sln", root: "/workspace/src/Demo.sln", state: null },
    { path: "tools/Acme.slnx", root: "/workspace/tools/Acme.slnx", state: null },
  ],
  opened: false,
};
const withChoice = (state: LanguageServerSnapshot, choice: Partial<import("../src/language-server/language-server-plugin").SolutionChoice> = {}) =>
  renderToStaticMarkup(createElement(LanguageServerPanelView, {
    settings: { label: "Language Server", openTool: "language_open" }, snapshot: state, pending: false, onRefresh: () => {},
    choice: { solutions, switching: false, writable: true, onSwitch: () => {}, ...choice },
  }));

test("the solution choice names the single open solution, none, or several open instances", () => {
  const none = withChoice({ instances: [] });
  assert.match(none, /aria-label="Solution wählen"/);
  assert.match(none, />Keine</);
  const one = withChoice({ instances: [instance({ root: "/workspace/tools/Acme.slnx" })] });
  assert.match(one, /tools\/Acme\.slnx/);
  const several = withChoice({ instances: [instance({ root: "/workspace/src/Demo.sln" }), instance({ root: "/workspace/tools/Acme.slnx" })] });
  assert.match(several, /2 Instanzen offen/);
  assert.match(withChoice({ instances: [instance({ root: "/workspace/src/Single.csproj" })] }), /Andere Wurzel offen/);
});

test("the solution choice is disabled without write rights, reports errors and an empty workspace", () => {
  assert.match(withChoice({ instances: [] }, { writable: false }), /Umschalten verlangt Schreibrechte/);
  assert.match(withChoice({ instances: [] }, { error: "Umschalten fehlgeschlagen" }), /Umschalten fehlgeschlagen/);
  assert.match(withChoice({ instances: [] }, { solutions: { source: "directory", solutions: [], opened: false } }), /Keine Solution im Arbeitsbereich/);
  assert.doesNotMatch(render({ instances: [] }), /Solution wählen/);
});
