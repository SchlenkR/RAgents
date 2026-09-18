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
    assert.match(outputs.get(`${id}.html`)!, /Vorschau mit Beispieldaten/);
    assert.ok(outputs.get(`${id}.js`)!.includes(title));
    assert.ok(outputs.get(`${id}.js`)!.includes("Nächster Beispielschritt"));
    assert.doesNotMatch(outputs.get(`${id}.js`)!, /\/runs\/|\/chat\/[^\s"']*\/send/);
    assert.doesNotMatch(outputs.get(`${id}.html`)! + outputs.get(`${id}.css`)!, /(?:src|href)=["'](?:https?:)?\/\/|url\(["']?(?:https?:)?\/\//);
  }
});

test("Homepage-Samples verweisen auf vorhandene Startartikel und gehören zum Offline-Export", async () => {
  const outputs = await buildHomepageExport(repoRoot);
  assertHomepageLinks(outputs);
  const homepage = String(outputs.get("index.html"));
  for (const id of ["shared-actor-list", "word-game", "learning-afternoon"]) {
    assert.ok(homepage.includes(`href="reference.html#start-ragents.reference.${id}"`), id);
    assert.ok(homepage.includes(`data-start-sample="ragents.reference.${id}" hidden`), id);
  }
  for (const { id } of homepageSamples) assert.ok(homepage.includes(`src="${id}.html"`), id);
});

test("Sample-Startbuttons akzeptieren nur den eigenen Help-Host und dessen verfügbare Einstiege", async () => {
  const script = await readFile(path.join(repoRoot, "docs/homepage/site.js"), "utf8");
  const run = (embedded: boolean) => {
    const messages: unknown[] = [];
    const events = new Map<string, (event: unknown) => void>();
    const clicks = new Map<string, () => void>();
    const linkClicks = new Map<string, (event: { preventDefault(): void }) => void>();
    const buttons = ["word-game", "learning-afternoon"].map(id => ({
      hidden: true,
      dataset: { startSample: `ragents.reference.${id}` },
      addEventListener: (_name: string, callback: () => void) => clicks.set(id, callback),
    }));
    const links = ["word-game", "learning-afternoon"].map(id => ({
      hidden: false,
      dataset: { sampleLink: `ragents.reference.${id}` },
      addEventListener: (_name: string, callback: (event: { preventDefault(): void }) => void) => linkClicks.set(id, callback),
    }));
    const parent = { postMessage: (message: unknown) => messages.push(message) };
    const window = { parent: embedded ? parent : undefined, addEventListener: (name: string, callback: (event: unknown) => void) => events.set(name, callback) };
    if (!embedded) Object.assign(window, { parent: window });
    runInNewContext(script, {
      window,
      location: { protocol: "https:", origin: "https://ragents.example" },
      document: {
        documentElement: { style: { setProperty() {} } },
        querySelectorAll: (selector: string) => selector === "[data-start-sample]" ? buttons : links,
        querySelector: (selector: string) => selector === ".masthead" ? { getBoundingClientRect: () => ({ height: 80 }) } : null,
      },
      ResizeObserver: class { observe() {} },
    });
    return { messages, events, clicks, buttons, links, linkClicks, parent };
  };
  const standalone = run(false);
  assert.equal(standalone.messages.length, 0);
  assert.ok(standalone.buttons.every(button => button.hidden));
  const host = run(true);
  assert.equal(JSON.stringify(host.messages), '[{"type":"ragents:help-ready"}]');
  const data = { type: "ragents:help-context", canStartSamples: true, entries: ["ragents.reference.word-game"] };
  host.events.get("message")!({ source: {}, origin: "https://ragents.example", data });
  host.events.get("message")!({ source: host.parent, origin: "https://foreign.example", data });
  assert.ok(host.buttons.every(button => button.hidden));
  host.events.get("message")!({ source: host.parent, origin: "https://ragents.example", data });
  assert.deepEqual(host.buttons.map(button => button.hidden), [false, true]);
  host.clicks.get("learning-afternoon")!();
  assert.equal(host.messages.length, 1);
  host.clicks.get("word-game")!();
  assert.equal(JSON.stringify(host.messages[1]), '{"type":"ragents:start-sample","entry":"ragents.reference.word-game"}');
  let prevented = false;
  host.linkClicks.get("word-game")!({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(JSON.stringify(host.messages[2]), '{"type":"ragents:start-sample","entry":"ragents.reference.word-game"}');
  assert.deepEqual(host.links.map(link => link.hidden), [false, true]);
  host.events.get("message")!({ source: host.parent, origin: "https://ragents.example", data: { ...data, canStartSamples: false } });
  assert.ok(host.buttons.every(button => button.hidden));
});

test("Die lokale Mini-App bündelt Originalquellen, shadcn-Controls und Tokens ohne Netzwerkzugriffe", async () => {
  const files = await buildHomepageMiniApp(repoRoot);
  assert.deepEqual([...files.keys()], ["mini-app.html", "mini-app.js", "mini-app.css"]);
  const html = files.get("mini-app.html")!;
  const javascript = files.get("mini-app.js")!;
  const css = files.get("mini-app.css")!;
  assert.match(html, /data-ui-surface="mini-app"/);
  assert.match(html, /Lokale Mini-App-Demo\. Eingaben bleiben auf dieser Seite\./);
  assert.match(html, /id="root"/);
  for (const text of ["Gemeinsame Liste", "Neuer Eintrag", "Text eingeben", "data-slot"]) {
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
  assert.deepEqual(initial, ["Beispiel: Erste Notiz"]);
  const answer = await runtime.context.capabilities.call("append", { text: "  Eigene Notiz  " });
  assert.equal(answer.text, "Eigene Notiz");
  assert.deepEqual(Array.from(answer.entries), [...initial, "Eigene Notiz"]);
  assert.deepEqual(entries(), [...initial, "Eigene Notiz"]);
  await runtime.context.capabilities.call("append", { text: "Weitere Notiz" });
  assert.deepEqual(entries(), [...initial, "Eigene Notiz", "Weitere Notiz"]);
  await assert.rejects(runtime.context.capabilities.call("unknown", { text: "Keine Änderung" }), /kennt die Funktion/);
  assert.deepEqual(entries(), [...initial, "Eigene Notiz", "Weitere Notiz"]);
});
