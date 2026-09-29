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
const staleFiles = [{ path: "old.ts", diagnostics: [{ line: 1, character: 1, severity: "error" as const, message: "Stale diagnostic" }] }];

test("opening language server shows progress without claiming successful diagnostics", () => {
  for (const files of [[], [{ path: "main.ts", diagnostics: [] }], staleFiles]) {
    const html = one({ state: "opening", summary: "Loading workspace.", files });
    assert.match(html, /role="status"/);
    assert.match(html, /Loading language server/);
    assert.match(html, /Loading workspace/);
    assert.match(html, /\/workspace\/project/);
    assert.doesNotMatch(html, /No diagnostics|free of errors|Stale diagnostic|No language server|warnings in/);
  }
});

test("failed language server shows its concrete error instead of a closed or successful state", () => {
  const html = one({ state: "failed", summary: "Initialization aborted: file <project> is missing.\nPlease check the path.", files: staleFiles });
  assert.match(html, /failed/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Language server unavailable/);
  assert.match(html, /Initialization aborted: file &lt;project&gt; is missing/);
  assert.match(html, /Please check the path/);
  assert.match(html, /aria-label="Refresh diagnostics"/);
  assert.doesNotMatch(html, /not started|No language server|No diagnostics|free of errors|Stale diagnostic/);
});

test("ready language server distinguishes an uninspected workspace from inspected clean files", () => {
  assert.match(one(), /No file has been checked yet/);
  assert.match(one({ files: [{ path: "main.ts", diagnostics: [] }] }), /All checked files are free of errors/);
  const html = one({ files: staleFiles });
  assert.match(html, /1 error, 0 warnings in 1 file/);
  assert.match(html, /Stale diagnostic/);
  assert.doesNotMatch(html, /No diagnostics/);
});

test("a run without instances and a suspended instance keep their distinct existing states", () => {
  const empty = render({ instances: [] });
  assert.match(empty, /not started/);
  assert.match(empty, /No language server/);
  assert.match(empty, /language_open/);
  assert.doesNotMatch(empty, /No diagnostics|free of errors/);
  const suspended = one({ state: "suspended", files: staleFiles });
  assert.match(suspended, /ended after idle/);
  assert.match(suspended, /Stale diagnostic/);
});

test("every open root of the run gets its own card with root, state and diagnostics", () => {
  const html = render({
    instances: [
      instance({ root: "/workspace/one", summary: "One loaded", files: staleFiles }),
      instance({ root: "/workspace/two", state: "failed", summary: "Two is broken" }),
    ],
  });
  assert.match(html, /2 instances/);
  assert.match(html, /\/workspace\/one/);
  assert.match(html, /\/workspace\/two/);
  assert.match(html, /Stale diagnostic/);
  assert.match(html, /Two is broken/);
  assert.match(html, /1 error, 0 warnings in 1 file/);
  assert.doesNotMatch(html, /No language server/);
  assert.match(render({ instances: [instance()] }), /1 instance/);
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
  assert.match(none, /aria-label="Choose solution"/);
  assert.match(none, />None</);
  const one = withChoice({ instances: [instance({ root: "/workspace/tools/Acme.slnx" })] });
  assert.match(one, /tools\/Acme\.slnx/);
  const several = withChoice({ instances: [instance({ root: "/workspace/src/Demo.sln" }), instance({ root: "/workspace/tools/Acme.slnx" })] });
  assert.match(several, /2 instances open/);
  assert.match(withChoice({ instances: [instance({ root: "/workspace/src/Single.csproj" })] }), /Other root open/);
});

test("the solution choice is disabled without write rights, reports errors and an empty workspace", () => {
  assert.match(withChoice({ instances: [] }, { writable: false }), /Switching requires write permission/);
  assert.match(withChoice({ instances: [] }, { error: "Switching failed" }), /Switching failed/);
  assert.match(withChoice({ instances: [] }, { solutions: { source: "directory", solutions: [], opened: false } }), /No solution in the workspace/);
  assert.doesNotMatch(render({ instances: [] }), /Choose solution/);
});
