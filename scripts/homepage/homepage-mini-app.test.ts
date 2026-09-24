import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHomepageMiniAppRuntime } from "../../docs/homepage/mini-app-runtime.js";
import { buildHomepageMiniApp } from "./homepage-mini-app.js";
import { buildHomepageSamples, homepageSamples } from "./homepage-samples.js";
import { assertHomepageLinks, buildHomepageExport } from "./homepage-export.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("Sample-Vorschauen bündeln die startbaren Views und bleiben ohne Server nutzbar", async () => {
  const outputs = await buildHomepageSamples(repoRoot);
  assert.deepEqual([...outputs.keys()], homepageSamples.flatMap(({ id }) => [`${id}.html`, `${id}.js`, `${id}.css`]));
  for (const { id, title } of homepageSamples) {
    assert.match(outputs.get(`${id}.html`)!, /connect-src 'none'/);
    assert.match(outputs.get(`${id}.html`)!, /Preview with example data/);
    assert.ok(outputs.get(`${id}.js`)!.includes(title));
    assert.ok(outputs.get(`${id}.js`)!.includes("Next example step"));
    assert.doesNotMatch(outputs.get(`${id}.js`)!, /\/runs\/|\/chat\/[^\s"']*\/send/);
    assert.doesNotMatch(outputs.get(`${id}.html`)! + outputs.get(`${id}.css`)!, /(?:src|href)=["'](?:https?:)?\/\/|url\(["']?(?:https?:)?\/\//);
  }
});

test("Homepage-Samples bleiben außerhalb des öffentlichen Exports", async () => {
  const outputs = await buildHomepageExport(repoRoot);
  assertHomepageLinks(outputs);
  const homepage = String(outputs.get("index.html"));
  assert.doesNotMatch(homepage, /data-(?:start-sample|sample-link)/);
  assert.doesNotMatch(homepage, /<iframe\b/);
  for (const { id } of homepageSamples) assert.ok(!outputs.has(`${id}.html`), id);
});

test("Homepage-JavaScript enthält keine Sample-Startintegration mehr", async () => {
  const script = await readFile(path.join(repoRoot, "docs/homepage/site.js"), "utf8");
  assert.doesNotMatch(script, /start-sample|help-context|help-ready/);
});

test("Die lokale Mini-App bündelt Originalquellen, shadcn-Controls und Tokens ohne Netzwerkzugriffe", async () => {
  const files = await buildHomepageMiniApp(repoRoot);
  assert.deepEqual([...files.keys()], ["mini-app.html", "mini-app.js", "mini-app.css"]);
  const html = files.get("mini-app.html")!;
  const javascript = files.get("mini-app.js")!;
  const css = files.get("mini-app.css")!;
  assert.match(html, /data-ui-surface="mini-app"/);
  assert.match(html, /Local mini-app demo\. Input remains on this page\./);
  assert.match(html, /id="root"/);
  for (const text of ["Shared list", "New item", "Enter text", "data-slot"]) {
    assert.ok(javascript.includes(text), text);
  }
  for (const text of ["--font-sans", "--primary", ".bg-primary", "@container"]) assert.ok(css.includes(text), text);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="connect-src 'none'">/);
  assert.doesNotMatch(javascript, /\/runs\/|\/chat\/[^\s"']*\/send/);
  assert.doesNotMatch(html + css, /(?:src|href)=["'](?:https?:)?\/\/|url\(["']?(?:https?:)?\/\//);
  assert.deepEqual(await buildHomepageMiniApp(repoRoot), files);
});

test("Die lokale Mini-App ergänzt eigene Eingaben mit der originalen append-Funktion", async () => {
  const compiled = await build({
    absWorkingDir: repoRoot,
    stdin: {
      contents: 'export { default as actor } from "./plugins/ragents.reference/run-scripts/shared-actor-list/actors/shared-list/src/server.ts";',
      resolveDir: repoRoot,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "originalList",
    plugins: [{
      name: "local-actor-definition",
      setup(builder) {
        builder.onResolve({ filter: /^@ragents\/server$/ }, () => ({ path: "server", namespace: "local" }));
        builder.onLoad({ filter: /.*/, namespace: "local" }, () => ({ contents: "export const defineActor = (_contract, implementation) => implementation;" }));
      },
    }],
  });
  const original = runInNewContext(`${compiled.outputFiles[0]!.text}\noriginalList.actor.functions.append;`, { TextEncoder, TextDecoder }) as Parameters<typeof createHomepageMiniAppRuntime>[0];
  const runtime = createHomepageMiniAppRuntime(original);
  const entries = () => {
    let value: string[] = [];
    renderToStaticMarkup(createElement(() => { value = runtime.useAppState().entries ?? []; return null; }));
    return Array.from(value);
  };
  const initial = entries();
  assert.deepEqual(initial, ["Example: First note"]);
  const answer = await runtime.context.capabilities.call("append", { text: "  My note  " });
  assert.equal(answer.text, "My note");
  assert.deepEqual(Array.from(answer.entries), [...initial, "My note"]);
  assert.deepEqual(entries(), [...initial, "My note"]);
  await runtime.context.capabilities.call("append", { text: "Another note" });
  assert.deepEqual(entries(), [...initial, "My note", "Another note"]);
  await assert.rejects(runtime.context.capabilities.call("unknown", { text: "No change" }), /does not provide the unknown function/);
  assert.deepEqual(entries(), [...initial, "My note", "Another note"]);
});
