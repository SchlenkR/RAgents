import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HOST_WEB_RECORD, hostWebProblem, hostWebRecordOf } from "../src/host-web.ts";
import { resolvePluginEntries } from "../src/profile/plugin-discovery.ts";
import { isBundleSourceMap, isPublicBundleFile, isWebBundlePath, webBundleFile } from "../src/web-bundles.ts";
import { compileStylesheet, createStylesheet, hostWebClasses } from "../src/web-stylesheet.ts";
import { writeBundle } from "./bundle-fixture.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const scratch = (): string => mkdtempSync(path.join(tmpdir(), "ragents-host-web-"));

const webBundle = (folder: string, classes: unknown): string => writeBundle(folder, {
  manifest: { web: { entry: "web/index.js", css: "web/index.css", classes: "web/classes.json" } },
  files: {
    "web/index.js": "export const webPlugin = { id: \"acme.probe\" };\n",
    "web/index.css": ".acme-probe { color: red; }\n",
    "web/classes.json": JSON.stringify(classes),
    "web/chunks/part.js": "export const part = 1;\n",
    "prompt.hbs": "vertraulich\n",
  },
});

test("das gebaute Web fehlt, hat keinen Quellstand oder passt nicht mehr zu seinen Quellen", () => {
  const host = scratch();
  const web = path.join(host, "apps/web/dist");
  const source = path.join(host, "apps/web/src/main.tsx");
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(source, "export {};\n");
  assert.match(hostWebProblem(web, host, false) ?? "", /Das Web des Hosts fehlt unter .*dist \(index\.html, run-panel\.html\)/);
  mkdirSync(web, { recursive: true });
  writeFileSync(path.join(web, "index.html"), "<!doctype html>\n");
  writeFileSync(path.join(web, "run-panel.html"), "<!doctype html>\n");
  assert.equal(hostWebProblem(web, host, false), undefined, "ohne Quellen zählt nur, dass es das Web gibt");
  assert.match(hostWebProblem(web, host, true) ?? "", /hat keinen Quellstand \(host-web\.json\)/);
  writeFileSync(path.join(web, HOST_WEB_RECORD), JSON.stringify(hostWebRecordOf(host, [source])));
  assert.equal(hostWebProblem(web, host, true), undefined);
  writeFileSync(source, "export const changed = 1;\n");
  assert.match(hostWebProblem(web, host, true) ?? "", /passt nicht mehr zu seinen Quellen \(geändert: apps\/web\/src\/main\.tsx\)/);
});

test("unter /plugins/<id>/web/ liefert der Host nur die Web-Hälfte der Bundles des Profils, mit ETag", async () => {
  const bundles = scratch();
  const folder = webBundle(path.join(bundles, "acme.probe"), []);
  const folders = new Map([["acme.probe", folder]]);
  const entry = await webBundleFile(folders, "/plugins/acme.probe/web/index.js", undefined);
  assert.equal(entry.status, 200);
  assert.equal(entry.headers["Content-Type"], "text/javascript");
  assert.equal(entry.headers["Cache-Control"], "no-cache");
  assert.match(entry.body!.toString(), /webPlugin/);
  assert.equal((await webBundleFile(folders, "/plugins/acme.probe/web/index.js", entry.headers.ETag)).status, 304);
  const chunk = await webBundleFile(folders, "/plugins/acme.probe/web/chunks/part.js", undefined);
  assert.equal(chunk.status, 200);
  assert.equal(chunk.headers["Cache-Control"], "public, max-age=31536000, immutable", "ein Chunk trägt seinen Hash im Namen");
  assert.equal((await webBundleFile(folders, "/plugins/acme.probe/web/index.css", undefined)).headers["Content-Type"], "text/css");
  for (const pathname of [
    "/plugins/acme.probe/server/index.js",
    "/plugins/acme.probe/prompt.hbs",
    "/plugins/acme.probe/web/..%2Fprompt.hbs",
    "/plugins/acme.probe/web/%E0%A4%A",
    "/plugins/acme.probe/web/missing.js",
    "/plugins/acme.other/web/index.js",
  ]) {
    assert.equal((await webBundleFile(folders, pathname, undefined)).status, 404, pathname);
  }
});

test("ohne Token gehen nur die ausgelieferten Dateien der Web-Hälften, keine Sourcemaps und keine anderen Pfade unter /plugins/", () => {
  const folders = new Map([["acme.probe", "/bundles/acme.probe"]]);
  assert.equal(isPublicBundleFile(folders, "/plugins/acme.probe/web/index.js"), true);
  assert.equal(isPublicBundleFile(folders, "/plugins/acme.probe/web/chunks/part-X1.js"), true);
  assert.equal(isPublicBundleFile(folders, "/plugins/acme.probe/web/index.js.map"), false, "die Sourcemap trägt den Quelltext");
  assert.equal(isBundleSourceMap(folders, "/plugins/acme.probe/web/index.js.map"), true);
  for (const pathname of ["/plugins/acme.probe/data", "/plugins/acme.probe/webhook", "/plugins/acme.other/web/index.js", "/plugins/", "/plugins/acme.probe/web/"]) {
    assert.equal(isPublicBundleFile(folders, pathname), false, pathname);
  }
  assert.equal(isWebBundlePath(folders, "/plugins/acme.probe/web/index.js"), true);
  assert.equal(isWebBundlePath(folders, "/plugins/acme.probe/api"), false, "eine Plugin-Route unter /plugins/<id>/ bleibt hinter dem Zugang");
});

test("ein Stylesheet aus den Kandidaten des Hosts und der Bundles, in der Reihenfolge von Tailwind", async () => {
  const css = (await compileStylesheet(root, ["max-md:inline", "hidden", "dark:bg-input/30", "bg-background", "p-2"], false)).css;
  assert.ok(css.indexOf(".hidden") < css.indexOf(".max-md\\:inline"), "eine Basis-Utility steht vor ihrer Variante");
  assert.ok(css.indexOf(".bg-background") < css.indexOf(".dark\\:bg-input\\/30"));
  assert.match(css, /--spacing: 0\.235rem/, "das Theme des Hosts ist dabei");
  assert.ok(hostWebClasses(root).includes("bg-background"), "die Quellen des Host-Webs liefern ihre Klassen");

  const bundles = scratch();
  const folder = webBundle(path.join(bundles, "acme.probe"), ["bg-[#123456]"]);
  const plugins = resolvePluginEntries([folder]);
  const fixed = await createStylesheet({ root, bundles: plugins, dev: false });
  const dev = await createStylesheet({ root, bundles: plugins, dev: true });
  assert.match((await fixed()).css, /#123456/);
  assert.doesNotMatch((await fixed()).css, /\n  /, "außerhalb des Dev-Modus minifiziert");
  assert.match((await dev()).css, /\n  /);
  const unchanged = await fixed();
  assert.equal(await fixed(), unchanged, "ohne neue Klassen bleibt es beim übersetzten Stylesheet");
  writeFileSync(path.join(folder, "web/classes.json"), JSON.stringify(["bg-[#654321]"]));
  const rebuilt = await fixed();
  assert.match(rebuilt.css, /#654321/, "ein neu gebautes Bundle bringt seine Klassen auch ohne Dev-Modus nach einem Neuladen mit");
  assert.doesNotMatch(rebuilt.css, /\n  /, "weiter minifiziert");
  assert.notEqual(rebuilt.etag, unchanged.etag);
  assert.match((await dev()).css, /#654321/, "im Dev-Modus je Abruf neu");

  const broken = webBundle(path.join(bundles, "acme.broken"), { classes: [] });
  await assert.rejects(createStylesheet({ root, bundles: resolvePluginEntries([broken]), dev: false }),
    /Die Klassenliste .*classes\.json des Bundles acme\.broken ist keine Liste von Texten; mit ragents plugin build <quellordner> neu bauen/);
});
