import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = buildSync({
  entryPoints: [fileURLToPath(new URL("../../../plugins/ragents.orchestration/web/TiledSurface.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false, external: ["react"],
});
const bundled = { exports: {} as typeof import("../../../plugins/ragents.orchestration/web/TiledSurface") };
new Function("require", "module", "exports", bundle.outputFiles[0]!.text)(createRequire(import.meta.url), bundled, bundled.exports);
const { TiledSurface } = bundled.exports;

const render = (canArrange: boolean, available = true) => renderToStaticMarkup(createElement(TiledSurface, {
  canArrange,
  root: { entity: "@helper" },
  items: available ? [{ entity: "@helper", title: "Helper", content: "Chat history" }] : [],
  onChange: () => { throw new Error("Rendering must not change the arrangement"); },
}));

test("restricted tiles retain their content without removal or drag controls", () => {
  const html = render(false);
  assert.match(html, /Chat history/);
  assert.doesNotMatch(html, /aria-label="Remove tile Helper"|draggable="true"|lucide-grip-vertical/);
});

test("arrange permission exposes removal and dragging", () => {
  const html = render(true);
  assert.match(html, /aria-label="Remove tile Helper"/);
  assert.match(html, /draggable="true"/);
  assert.match(html, /lucide-grip-vertical/);
});

test("unavailable tiles cannot be removed without arrange permission", () => {
  const html = render(false, false);
  assert.match(html, /no longer available/);
  assert.doesNotMatch(html, /aria-label="Remove tile @helper"|draggable="true"/);
});
